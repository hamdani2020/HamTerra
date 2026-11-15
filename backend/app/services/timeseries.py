"""NDVI time series from stored observations only (Requirements 7.x, 23.3).

AgroMonitoring is never called here. Weather context, when requested, comes from the weather
service and never changes the NDVI values or the summary.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.db.models.areas import Area
from app.db.models.observations import Observation
from app.domain.constants import WarningCode
from app.domain.quality import QualityResult
from app.domain.timeseries import Series, SeriesInput, build_series
from app.integrations.weather.base import WeatherProvider
from app.services import settings as settings_service
from app.services.observations import QualityLimits, view_of
from app.services.weather import weather_for_periods


@dataclass(frozen=True)
class TimeSeriesResult:
    area_id: uuid.UUID
    source: str
    series: Series[tuple[Observation, QualityResult]]
    warnings: list[WarningCode]
    weather: list[dict[str, Any] | None]


async def build_area_series(
    session: AsyncSession,
    area_id: uuid.UUID,
    *,
    source: str,
    date_from: date | None,
    date_to: date | None,
    max_cloud_coverage: float | None,
    include_weather: bool,
    weather_provider: WeatherProvider,
) -> TimeSeriesResult:
    if await session.scalar(select(Area.id).where(Area.id == area_id)) is None:
        raise NotFound("The monitoring area was not found.", details={"area_id": str(area_id)})

    stmt = select(Observation).where(Observation.area_id == area_id, Observation.source == source)
    if date_from is not None:
        stmt = stmt.where(Observation.acquired_on >= date_from)
    if date_to is not None:
        stmt = stmt.where(Observation.acquired_on <= date_to)
    rows = (await session.scalars(stmt.order_by(Observation.acquired_on))).all()

    values = await settings_service.current_values(session)
    limits = QualityLimits(
        cloud_limit=float(values["cloud_limit_pct"]),
        data_min=float(values["data_coverage_min_pct"]),
    )
    inputs = [
        SeriesInput(
            acquired_on=o.acquired_on,
            ndvi_mean=float(o.ndvi_mean),
            cloud_coverage=None if o.cloud_coverage is None else float(o.cloud_coverage),
            ref=(o, view_of(o, limits).quality),
        )
        for o in rows
    ]
    series = build_series(
        inputs, max_cloud=max_cloud_coverage, gap_threshold_days=int(values["gap_threshold_days"])
    )
    warnings = list(series.warnings)
    weather: list[dict[str, Any] | None] = [None] * len(series.points)
    if include_weather:
        days = [(p.item.acquired_on, p.item.acquired_on) for p in series.points]
        outcome = await weather_for_periods(session, weather_provider, area_id, days)
        weather = outcome.contexts
        warnings.extend(outcome.warnings)
    return TimeSeriesResult(
        area_id=area_id, source=source, series=series, warnings=warnings, weather=weather
    )
