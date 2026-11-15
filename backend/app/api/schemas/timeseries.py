"""Time-series response model."""

from __future__ import annotations

from datetime import date as Date
from typing import Any
from uuid import UUID

from pydantic import BaseModel

from app.api.schemas.observations import QualityOut, Source, WarningOut


class TimeSeriesPointOut(BaseModel):
    date: Date
    ndvi_mean: float
    cloud_coverage_pct: float | None
    data_coverage_pct: float | None
    quality: QualityOut
    gap_days_from_previous: int | None
    weather: dict[str, Any] | None


class TimeSeriesSummaryOut(BaseModel):
    count: int
    first_date: Date | None
    last_date: Date | None
    min: float | None
    max: float | None
    mean_of_means: float | None
    trend_per_30d: float | None


class TimeSeriesMeta(BaseModel):
    excluded_by_cloud: int
    resolution_class: str


class TimeSeriesOut(BaseModel):
    area_id: UUID
    source: Source
    points: list[TimeSeriesPointOut]
    summary: TimeSeriesSummaryOut
    meta: TimeSeriesMeta
    warnings: list[WarningOut]
    limitations: list[str]
