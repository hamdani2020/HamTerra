"""Response and request models for observations and refresh."""

from __future__ import annotations

from datetime import date as Date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.api.schemas.common import Page

Source = Literal["sentinel-2", "landsat-8"]


class WarningOut(BaseModel):
    code: str
    message: str


class QualityOut(BaseModel):
    level: Literal["good", "limited", "poor"]
    cloud_coverage_pct: float | None
    data_coverage_pct: float | None
    warnings: list[WarningOut]


class NdviStatsOut(BaseModel):
    mean: float
    min: float | None
    max: float | None
    std: float | None
    median: float | None


class PreviewOut(BaseModel):
    url: str | None
    width_px: int | None
    height_px: int | None
    note: str


class ObservationOut(BaseModel):
    id: UUID
    area_id: UUID
    date: Date
    source: Source
    ndvi: NdviStatsOut
    quality: QualityOut
    preview: PreviewOut
    geometry_status: Literal["current", "stale_geometry"]


class ObservationMeta(BaseModel):
    """Resolution class and counts for each source present, never merged across sources."""

    resolution_class: dict[str, str]
    counts_by_source: dict[str, int]


class ObservationPage(Page[ObservationOut]):
    meta: ObservationMeta


class RefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date_from: Date
    date_to: Date
    sources: list[Source] | None = Field(default=None, min_length=1, max_length=2)


class RefreshOut(BaseModel):
    retrieval_id: UUID
    status: Literal["success", "partial", "empty"]
    new: int
    updated: int
    skipped: int
    warnings: list[WarningOut]
