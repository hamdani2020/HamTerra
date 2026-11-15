"""Request and response models for application settings."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class ResearcherSettings(BaseModel):
    ndvi_diff_threshold: float
    cloud_limit_pct: float
    data_coverage_min_pct: float
    gap_threshold_days: int
    default_page_size: int


class SettingOut(BaseModel):
    key: str
    value: bool | int | float
    type: Literal["integer", "decimal", "boolean"]
    default: bool | int | float
    min: int | float | None
    max: int | float | None
    updated_by: str | None
    updated_at: datetime | None


class SettingList(BaseModel):
    items: list[SettingOut]


class SettingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: Any
