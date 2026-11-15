"""Observation reads, refresh and the preview image proxy."""

from __future__ import annotations

import uuid
from datetime import date as Date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    Pagination,
    get_agro_client,
    get_session,
    get_settings,
    guard,
    pagination_params,
)
from app.api.schemas.observations import (
    NdviStatsOut,
    ObservationMeta,
    ObservationOut,
    ObservationPage,
    PreviewOut,
    QualityOut,
    RefreshOut,
    RefreshRequest,
    Source,
    WarningOut,
)
from app.core.config import Settings
from app.core.errors import ValidationFailed
from app.core.permissions import Permission
from app.core.security import Principal
from app.domain.constants import PREVIEW_NOTE, WARNING_MESSAGES
from app.integrations.agro.models import AgroClient
from app.services import observations as observation_service
from app.services import refresh as refresh_service
from app.services.observations import ObservationFilters, ObservationView

router = APIRouter(tags=["observations"])

Session = Annotated[AsyncSession, Depends(get_session)]
Config = Annotated[Settings, Depends(get_settings)]


def observation_out(view: ObservationView) -> ObservationOut:
    obs = view.observation
    quality = view.quality

    def num(value: Any) -> float | None:
        return None if value is None else float(value)

    return ObservationOut(
        id=obs.id,
        area_id=obs.area_id,
        date=obs.acquired_on,
        source=obs.source,
        ndvi=NdviStatsOut(
            mean=float(obs.ndvi_mean),
            min=num(obs.ndvi_min),
            max=num(obs.ndvi_max),
            std=num(obs.ndvi_std),
            median=num(obs.ndvi_median),
        ),
        quality=QualityOut(
            level=quality.level,
            cloud_coverage_pct=quality.cloud_coverage_pct,
            data_coverage_pct=quality.data_coverage_pct,
            warnings=[
                WarningOut(code=w.value, message=WARNING_MESSAGES[w]) for w in quality.warnings
            ],
        ),
        preview=PreviewOut(
            url=f"/api/v1/observations/{obs.id}/preview" if obs.preview_ref else None,
            width_px=obs.preview_width_px,
            height_px=obs.preview_height_px,
            note=PREVIEW_NOTE,
        ),
        geometry_status=obs.geometry_status,
    )


def observation_filters(
    source: Annotated[Source | None, Query()] = None,
    date_from: Annotated[Date | None, Query()] = None,
    date_to: Annotated[Date | None, Query()] = None,
    max_cloud_coverage: Annotated[float | None, Query(ge=0, le=100)] = None,
    min_data_coverage: Annotated[float | None, Query(ge=0, le=100)] = None,
) -> ObservationFilters:
    if date_from is not None and date_to is not None and date_from > date_to:
        raise ValidationFailed(
            details={
                "fields": [{"field": "date_from", "reason": "date_from must not be after date_to"}]
            }
        )
    return ObservationFilters(source, date_from, date_to, max_cloud_coverage, min_data_coverage)


@router.get("/areas/{area_id}/observations", response_model=ObservationPage)
async def list_observations(
    area_id: uuid.UUID,
    _: Annotated[Principal, Depends(guard(Permission.OBSERVATIONS_READ))],
    session: Session,
    settings: Config,
    page: Annotated[Pagination, Depends(pagination_params)],
    filters: Annotated[ObservationFilters, Depends(observation_filters)],
) -> ObservationPage:
    listing = await observation_service.list_observations(
        session, area_id, filters, limit=page.limit, offset=page.offset
    )
    classes = observation_service.resolution_classes(settings)
    return ObservationPage(
        items=[observation_out(v) for v in listing.views],
        total=listing.total,
        limit=page.limit,
        offset=page.offset,
        meta=ObservationMeta(
            resolution_class={s: classes[s] for s in listing.counts_by_source},
            counts_by_source=listing.counts_by_source,
        ),
    )


@router.get("/observations/{observation_id}", response_model=ObservationOut)
async def read_observation(
    observation_id: uuid.UUID,
    _: Annotated[Principal, Depends(guard(Permission.OBSERVATIONS_READ))],
    session: Session,
) -> ObservationOut:
    return observation_out(await observation_service.get_observation(session, observation_id))


@router.get("/observations/{observation_id}/preview")
async def read_preview(
    observation_id: uuid.UUID,
    _: Annotated[Principal, Depends(guard(Permission.OBSERVATIONS_READ))],
    session: Session,
    agro: Annotated[AgroClient, Depends(get_agro_client)],
) -> Response:
    # The guard runs first, so a denied request never reaches the provider.
    image = await observation_service.fetch_preview(session, agro, observation_id)
    return Response(
        content=image.content,
        media_type=image.content_type,
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.post("/areas/{area_id}/observations/refresh", response_model=RefreshOut)
async def refresh_observations(
    area_id: uuid.UUID,
    body: RefreshRequest,
    actor: Annotated[Principal, Depends(guard(Permission.OBSERVATIONS_REFRESH))],
    session: Session,
    agro: Annotated[AgroClient, Depends(get_agro_client)],
    settings: Config,
) -> RefreshOut:
    result = await refresh_service.refresh_area(
        session,
        agro,
        settings,
        actor,
        area_id,
        date_from=body.date_from,
        date_to=body.date_to,
        sources=body.sources,
    )
    return RefreshOut(
        retrieval_id=result.retrieval_id,
        status=result.status,
        new=result.new,
        updated=result.updated,
        skipped=result.skipped,
        warnings=[WarningOut(code=w.code, message=w.message) for w in result.warnings],
    )
