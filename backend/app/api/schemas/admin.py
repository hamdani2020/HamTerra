"""Response and request models for admin endpoints."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

RoleName = Literal["admin", "researcher"]


class UserOut(BaseModel):
    sub: str
    username: str
    email: str | None
    roles: list[str]
    status: str
    last_seen_at: datetime


class RoleChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    roles: list[RoleName] = Field(max_length=2)


class RoleChangeOut(BaseModel):
    sub: str
    roles: list[str]
    effective_after_next_login: Literal[True] = True
    message: str


class RequestedRange(BaseModel):
    from_: date | None = Field(alias="from")
    to: date | None

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class RetrievalError(BaseModel):
    code: str | None
    message: str | None


class RetrievalOut(BaseModel):
    id: UUID
    provider: str
    kind: str
    area_id: UUID | None
    requested_range: RequestedRange | None
    status: str
    item_count: int
    duration_ms: int | None
    started_at: datetime
    error: RetrievalError | None


class ProbeOut(BaseModel):
    ok: bool
    latency_ms: int
    outcome: Literal["success", "failure", "timeout"]


class IntegrationOut(BaseModel):
    configured: bool
    enabled: bool
    last_success_at: datetime | None
    last_failure_at: datetime | None
    last_error: str | None
    failures_24h: int
    probe: ProbeOut | None


class IntegrationsOut(BaseModel):
    agromonitoring: IntegrationOut
    weather: IntegrationOut


class AuditEventOut(BaseModel):
    id: UUID
    occurred_at: datetime
    actor_sub: str | None
    action: str
    target_type: str
    target_id: str | None
    request_id: str
    outcome: str
    details: dict[str, Any]


class DashboardOut(BaseModel):
    areas_active: int
    observations_total: int
    reports_total: int
    users_by_role: dict[str, int]
    retrievals_7d_by_status: dict[str, int]
