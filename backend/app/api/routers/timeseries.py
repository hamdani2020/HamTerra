"""``GET /areas/{area_id}/ndvi/timeseries`` (stored data only)."""

from __future__ import annotations

import uuid
from datetime import date as Date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session, get_settings, get_weather_provider, guard
from app.api.schemas.observations import Source
from app.api.schemas.timeseries import (
    TimeSeriesMeta,
    TimeSeriesOut,
    TimeSeriesPointOut,
    TimeSeriesSummaryOut,
)
from app.api.serializers import quality_out, warnings_out
from app.core.config import Settings
from app.core.errors import ValidationFailed
from app.core.permissions import Permission
from app.core.security import Principal
from app.domain.constants import LIMITATIONS
from app.integrations.weather.base import WeatherProvider
from app.services import timeseries as timeseries_service
from app.services.observations import resolution_classes

router = APIRouter(tags=["timeseries"])

MAX_SPAN_DAYS = 3660


def _range_error(reason: str) -> ValidationFailed:
    return ValidationFailed(details={"fields": [{"field": "date_range", "reason": reason}]})


@router.get("/areas/{area_id}/ndvi/timeseries", response_model=TimeSeriesOut)
async def read_timeseries(
    area_id: uuid.UUID,
    _: Annotated[Principal, Depends(guard(Permission.TIMESERIES_READ))],
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    weather_provider: Annotated[WeatherProvider, Depends(get_weather_provider)],
    source: Annotated[Source, Query()],
    date_from: Annotated[Date | None, Query()] = None,
    date_to: Annotated[Date | None, Query()] = None,
    max_cloud_coverage: Annotated[float | None, Query(ge=0, le=100)] = None,
    include_weather: bool = False,
) -> TimeSeriesOut:
    if date_from is not None and date_to is not None:
        if date_to < date_from:
            raise _range_error("date_to must not be before date_from")
        if (date_to - date_from).days > MAX_SPAN_DAYS:
            raise _range_error(f"the range must not span more than {MAX_SPAN_DAYS} days")

    result = await timeseries_service.build_area_series(
        session,
        area_id,
        source=source,
        date_from=date_from,
        date_to=date_to,
        max_cloud_coverage=max_cloud_coverage,
        include_weather=include_weather,
        weather_provider=weather_provider,
    )
    series = result.series
    points = []
    for point, weather in zip(series.points, result.weather, strict=True):
        obs, quality = point.item.ref
        points.append(
            TimeSeriesPointOut(
                date=obs.acquired_on,
                ndvi_mean=float(obs.ndvi_mean),
                cloud_coverage_pct=quality.cloud_coverage_pct,
                data_coverage_pct=quality.data_coverage_pct,
                quality=quality_out(quality),
                gap_days_from_previous=point.gap_days_from_previous,
                weather=weather,
            )
        )
    s = series.summary
    return TimeSeriesOut(
        area_id=area_id,
        source=source,
        points=points,
        summary=TimeSeriesSummaryOut(
            count=s.count,
            first_date=s.first_date,
            last_date=s.last_date,
            min=s.min,
            max=s.max,
            mean_of_means=s.mean_of_means,
            trend_per_30d=s.trend_per_30d,
        ),
        meta=TimeSeriesMeta(
            excluded_by_cloud=series.excluded_by_cloud,
            resolution_class=resolution_classes(settings)[source],
        ),
        warnings=warnings_out(result.warnings),
        limitations=list(LIMITATIONS),
    )
