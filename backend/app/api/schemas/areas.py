"""Request and response models for monitoring areas."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

AreaName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
AreaDescription = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


class AreaCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: AreaName
    description: AreaDescription | None = None
    geometry: dict[str, Any]


class AreaUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: AreaName | None = None
    description: AreaDescription | None = None
    geometry: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _something_to_change(self) -> AreaUpdate:
        if not self.model_fields_set:
            raise ValueError("at least one of name, description or geometry is required")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be null")
        if "geometry" in self.model_fields_set and self.geometry is None:
            raise ValueError("geometry cannot be null")
        return self


class AreaOut(BaseModel):
    """Area. ``geometry`` is left unset (and so omitted) unless it was requested."""

    id: UUID
    name: str
    description: str | None
    status: Literal["active", "archived"]
    area_ha: float
    geometry: dict[str, Any] | None = Field(default=None)
    external_polygon_id: str | None
    latest_observation_date: date | None
    created_at: datetime
    updated_at: datetime
