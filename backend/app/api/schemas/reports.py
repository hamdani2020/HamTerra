"""Request and response models for reports."""

from __future__ import annotations

from datetime import date as Date
from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.api.schemas.comparisons import ComparisonOut, ThresholdsApplied
from app.api.schemas.observations import QualityOut, Source, WarningOut
from app.api.schemas.timeseries import TimeSeriesSummaryOut

MAX_REPORT_COMPARISONS = 10


class ComparisonPair(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date_a: Date
    date_b: Date


class ReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    area_id: UUID
    source: Source
    date_from: Date
    date_to: Date
    title: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
        | None
    ) = None
    comparisons: list[ComparisonPair] = Field(
        default_factory=list, max_length=MAX_REPORT_COMPARISONS
    )
    include_weather: bool = False


class ReportAuthor(BaseModel):
    sub: str
    username: str


class ReportArea(BaseModel):
    id: UUID
    name: str
    area_ha: float
    geometry: dict[str, Any]


class ReportPeriod(BaseModel):
    from_: Date = Field(alias="from")
    to: Date

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class ReportObservation(BaseModel):
    date: Date
    ndvi_mean: float
    cloud_coverage_pct: float | None
    data_coverage_pct: float | None
    quality: QualityOut


class ReportOut(BaseModel):
    id: UUID
    title: str
    created_at: datetime
    created_by: ReportAuthor
    area: ReportArea
    period: ReportPeriod
    source: Source
    observations: list[ReportObservation]
    summary: TimeSeriesSummaryOut
    comparisons: list[ComparisonOut]
    thresholds_applied: ThresholdsApplied
    weather: dict[str, Any] | None
    warnings: list[WarningOut]
    caveats: list[str]
    limitations: list[str]


class ReportSummaryOut(BaseModel):
    id: UUID
    title: str
    area_id: UUID
    area_name: str
    period: ReportPeriod
    source: Source
    created_at: datetime
    created_by: ReportAuthor
