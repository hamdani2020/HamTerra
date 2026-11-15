"""Admin operations: retrievals, integration status, activity and dashboard."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    Pagination,
    admin_page_params,
    get_agro_client,
    get_session,
    get_weather_provider,
    guard,
)
from app.api.schemas.admin import (
    AuditEventOut,
    DashboardOut,
    IntegrationOut,
    IntegrationsOut,
    ProbeOut,
    RequestedRange,
    RetrievalError,
    RetrievalOut,
)
from app.api.schemas.common import Page
from app.core.permissions import Permission
from app.core.security import Principal
from app.db.models.retrievals import RetrievalRecord
from app.integrations.agro.models import AgroClient
from app.integrations.weather.base import WeatherProvider
from app.services import admin_ops
from app.services.admin_ops import IntegrationStatus

router = APIRouter(prefix="/admin", tags=["admin-ops"])

Ops = Annotated[Principal, Depends(guard(Permission.OPS_READ))]
Session = Annotated[AsyncSession, Depends(get_session)]
OpsPage = Annotated[Pagination, Depends(admin_page_params(default=25, maximum=100))]


def retrieval_out(r: RetrievalRecord) -> RetrievalOut:
    has_range = r.requested_from is not None or r.requested_to is not None
    has_error = r.error_code is not None or r.error_message is not None
    return RetrievalOut(
        id=r.id,
        provider=r.provider,
        kind=r.kind,
        area_id=r.area_id,
        requested_range=RequestedRange(from_=r.requested_from, to=r.requested_to)
        if has_range
        else None,
        status=r.status,
        item_count=r.item_count,
        duration_ms=r.duration_ms,
        started_at=r.started_at,
        error=RetrievalError(code=r.error_code, message=r.error_message) if has_error else None,
    )


@router.get("/retrievals", response_model=Page[RetrievalOut])
async def list_retrievals(
    _: Ops,
    session: Session,
    page: OpsPage,
    provider: Annotated[Literal["agromonitoring", "weather"] | None, Query()] = None,
    area_id: Annotated[uuid.UUID | None, Query()] = None,
    status: Annotated[
        Literal["running", "success", "partial", "empty", "failed"] | None, Query()
    ] = None,
    date_from: Annotated[date | None, Query()] = None,
    date_to: Annotated[date | None, Query()] = None,
) -> Page[RetrievalOut]:
    rows, total = await admin_ops.list_retrievals(
        session,
        provider=provider,
        area_id=area_id,
        status=status,
        date_from=date_from,
        date_to=date_to,
        limit=page.limit,
        offset=page.offset,
    )
    return Page[RetrievalOut](
        items=[retrieval_out(r) for r in rows], total=total, limit=page.limit, offset=page.offset
    )


def _integration(status: IntegrationStatus) -> IntegrationOut:
    probe = status.probe
    return IntegrationOut(
        configured=status.configured,
        enabled=status.enabled,
        last_success_at=status.last_success_at,
        last_failure_at=status.last_failure_at,
        last_error=status.last_error,
        failures_24h=status.failures_24h,
        probe=ProbeOut(ok=probe.ok, latency_ms=probe.latency_ms, outcome=probe.outcome)
        if probe
        else None,
    )


@router.get("/integrations/status", response_model=IntegrationsOut)
async def integrations_status(
    _: Ops,
    session: Session,
    agro: Annotated[AgroClient, Depends(get_agro_client)],
    weather: Annotated[WeatherProvider, Depends(get_weather_provider)],
    probe: bool = False,
) -> IntegrationsOut:
    result = await admin_ops.integration_status(session, agro, weather, probe=probe)
    return IntegrationsOut(
        agromonitoring=_integration(result["agromonitoring"]),
        weather=_integration(result["weather"]),
    )


@router.get("/activity", response_model=Page[AuditEventOut])
async def list_activity(
    _: Ops,
    session: Session,
    page: OpsPage,
    actor: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
    action: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    date_from: Annotated[date | None, Query()] = None,
    date_to: Annotated[date | None, Query()] = None,
) -> Page[AuditEventOut]:
    rows, total = await admin_ops.list_activity(
        session,
        actor=actor,
        action=action,
        date_from=date_from,
        date_to=date_to,
        limit=page.limit,
        offset=page.offset,
    )
    return Page[AuditEventOut](
        items=[AuditEventOut.model_validate(e, from_attributes=True) for e in rows],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.get("/dashboard", response_model=DashboardOut)
async def read_dashboard(_: Ops, session: Session) -> DashboardOut:
    return DashboardOut(**await admin_ops.dashboard(session))
