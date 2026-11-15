"""Request and response models for comparisons."""

from __future__ import annotations

from datetime import date as Date
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.api.schemas.observations import ObservationOut, QualityOut, Source, WarningOut

StrictNumber = Annotated[float | None, Field(default=None, strict=True)]


class ThresholdOverrides(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ndvi_diff: StrictNumber = None
    max_cloud: StrictNumber = None
    min_data_coverage: StrictNumber = None


class ComparisonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Source
    date_a: Date
    date_b: Date
    thresholds: ThresholdOverrides | None = None
    include_weather: bool = False


class ThresholdsApplied(BaseModel):
    ndvi_diff: float
    max_cloud: float
    min_data_coverage: float


class ComparisonWeather(BaseModel):
    a: dict[str, Any] | None
    b: dict[str, Any] | None
    between: dict[str, Any] | None


class ComparisonOut(BaseModel):
    area_id: UUID
    source: Source
    a: ObservationOut
    b: ObservationOut
    ndvi_diff: float
    ndvi_diff_pct: float | None
    interval_days: int
    flag: Literal["flagged", "not_flagged"]
    thresholds_applied: ThresholdsApplied
    quality: QualityOut
    spatial_analysis_available: Literal[False]
    summary_text: str
    weather: ComparisonWeather | None
    warnings: list[WarningOut]
    limitations: list[str]
