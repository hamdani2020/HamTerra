"""Observation reads (Requirements 6.6 to 6.11, 9.x). Reads never call the provider."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import NotFound
from app.db.models.areas import Area
from app.db.models.observations import Observation
from app.domain.quality import QualityResult, observation_quality
from app.integrations.agro.errors import AgroUpstreamError, InvalidProviderRef
from app.integrations.agro.models import AgroClient
from app.services import settings as settings_service


@dataclass(frozen=True)
class QualityLimits:
    cloud_limit: float
    data_min: float


@dataclass(frozen=True)
class ObservationFilters:
    source: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    max_cloud_coverage: float | None = None
    min_data_coverage: float | None = None


@dataclass(frozen=True)
class ObservationView:
    observation: Observation
    quality: QualityResult


@dataclass(frozen=True)
class ObservationListing:
    views: list[ObservationView]
    total: int
    counts_by_source: dict[str, int]


def _num(value: Any) -> float | None:
    return None if value is None else float(value)


async def quality_limits(session: AsyncSession) -> QualityLimits:
    """Current thresholds from the settings table, so a change applies to old data."""
    values = await settings_service.current_values(session)
    return QualityLimits(
        cloud_limit=float(values["cloud_limit_pct"]),
        data_min=float(values["data_coverage_min_pct"]),
    )


def view_of(obs: Observation, limits: QualityLimits) -> ObservationView:
    quality = observation_quality(
        _num(obs.cloud_coverage), _num(obs.data_coverage), limits.cloud_limit, limits.data_min
    )
    return ObservationView(obs, quality)


def resolution_classes(settings: Settings) -> dict[str, str]:
    return {
        "sentinel-2": settings.resolution_class_sentinel_2,
        "landsat-8": settings.resolution_class_landsat_8,
    }


async def _require_area(session: AsyncSession, area_id: uuid.UUID) -> None:
    if await session.scalar(select(Area.id).where(Area.id == area_id)) is None:
        raise NotFound("The monitoring area was not found.")


async def list_observations(
    session: AsyncSession,
    area_id: uuid.UUID,
    filters: ObservationFilters,
    *,
    limit: int,
    offset: int,
) -> ObservationListing:
    await _require_area(session, area_id)
    conditions: list[Any] = [Observation.area_id == area_id]
    if filters.source is not None:
        conditions.append(Observation.source == filters.source)
    if filters.date_from is not None:
        conditions.append(Observation.acquired_on >= filters.date_from)
    if filters.date_to is not None:
        conditions.append(Observation.acquired_on <= filters.date_to)
    if filters.max_cloud_coverage is not None:
        conditions.append(Observation.cloud_coverage <= filters.max_cloud_coverage)
    if filters.min_data_coverage is not None:
        # A null data coverage never satisfies the minimum filter.
        conditions.append(Observation.data_coverage >= filters.min_data_coverage)

    grouped = (
        await session.execute(
            select(Observation.source, func.count()).where(*conditions).group_by(Observation.source)
        )
    ).all()
    counts = {source: int(n) for source, n in grouped}
    rows = (
        await session.scalars(
            select(Observation)
            .where(*conditions)
            .order_by(Observation.acquired_on.desc(), Observation.source, Observation.id)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    limits = await quality_limits(session)
    return ObservationListing(
        views=[view_of(o, limits) for o in rows],
        total=sum(counts.values()),
        counts_by_source=counts,
    )


async def get_observation(session: AsyncSession, observation_id: uuid.UUID) -> ObservationView:
    obs = await session.get(Observation, observation_id)
    if obs is None:
        raise NotFound("The observation was not found.")
    return view_of(obs, await quality_limits(session))


_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def png_dimensions(content: bytes) -> tuple[int, int] | None:
    """Width and height from the PNG IHDR chunk, or None when ``content`` is not a PNG."""
    if len(content) < 24 or not content.startswith(_PNG_SIGNATURE) or content[12:16] != b"IHDR":
        return None
    width = int.from_bytes(content[16:20], "big")
    height = int.from_bytes(content[20:24], "big")
    return (width, height) if width > 0 and height > 0 else None


@dataclass(frozen=True)
class PreviewImage:
    content: bytes
    content_type: str


async def fetch_preview(
    session: AsyncSession, agro: AgroClient, observation_id: uuid.UUID
) -> PreviewImage:
    """Fetch the preview through the provider client, keeping the key server-side.

    Stores the pixel size the first time the image is fetched.
    """
    obs = await session.get(Observation, observation_id)
    if obs is None or not obs.preview_ref:
        raise NotFound("No preview is available for this observation.")
    try:
        image = await agro.fetch_image(obs.preview_ref)
    except InvalidProviderRef:
        raise AgroUpstreamError("The stored preview reference is not usable.") from None
    size = png_dimensions(image.content)
    if size is None:
        raise AgroUpstreamError("The provider returned an unexpected image response.")
    if obs.preview_width_px is None or obs.preview_height_px is None:
        obs.preview_width_px, obs.preview_height_px = size
        await session.commit()
    return PreviewImage(image.content, "image/png")
