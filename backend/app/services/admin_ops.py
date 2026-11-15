"""Admin operations: retrievals, integration status, activity, dashboard (Requirement 13)."""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ValidationFailed
from app.db.models.areas import Area
from app.db.models.audit import AuditEvent
from app.db.models.observations import Observation
from app.db.models.reports import Report
from app.db.models.retrievals import RetrievalRecord
from app.db.models.users import User
from app.integrations.agro.models import AgroClient
from app.integrations.weather.base import WeatherProvider
from app.services import settings as settings_service

PROBE_TIMEOUT_S = 10.0
MAX_ERROR_LENGTH = 500
STATUSES = ("running", "success", "partial", "empty", "failed")
SUCCESS_STATUSES = ("success", "empty")
FAILURE_STATUSES = ("failed", "partial")
Provider = Literal["agromonitoring", "weather"]


def _check_range(date_from: date | None, date_to: date | None) -> None:
    if date_from is not None and date_to is not None and date_from > date_to:
        raise ValidationFailed(
            details={
                "fields": [{"field": "date_from", "reason": "date_from must not be after date_to"}]
            }
        )


async def list_retrievals(
    session: AsyncSession,
    *,
    provider: str | None,
    area_id: uuid.UUID | None,
    status: str | None,
    date_from: date | None,
    date_to: date | None,
    limit: int,
    offset: int,
) -> tuple[list[RetrievalRecord], int]:
    _check_range(date_from, date_to)
    conditions: list[Any] = []
    if provider is not None:
        conditions.append(RetrievalRecord.provider == provider)
    if area_id is not None:
        conditions.append(RetrievalRecord.area_id == area_id)
    if status is not None:
        conditions.append(RetrievalRecord.status == status)
    if date_from is not None:
        conditions.append(func.date(func.timezone("UTC", RetrievalRecord.started_at)) >= date_from)
    if date_to is not None:
        conditions.append(func.date(func.timezone("UTC", RetrievalRecord.started_at)) <= date_to)
    total = await session.scalar(select(func.count(RetrievalRecord.id)).where(*conditions))
    rows = (
        await session.scalars(
            select(RetrievalRecord)
            .where(*conditions)
            .order_by(RetrievalRecord.started_at.desc(), RetrievalRecord.id)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return list(rows), int(total or 0)


async def list_activity(
    session: AsyncSession,
    *,
    actor: str | None,
    action: str | None,
    date_from: date | None,
    date_to: date | None,
    limit: int,
    offset: int,
) -> tuple[list[AuditEvent], int]:
    _check_range(date_from, date_to)
    conditions: list[Any] = []
    if actor is not None:
        conditions.append(AuditEvent.actor_sub == actor)
    if action is not None:
        conditions.append(AuditEvent.action == action)
    if date_from is not None:
        conditions.append(func.date(func.timezone("UTC", AuditEvent.occurred_at)) >= date_from)
    if date_to is not None:
        conditions.append(func.date(func.timezone("UTC", AuditEvent.occurred_at)) <= date_to)
    total = await session.scalar(select(func.count(AuditEvent.id)).where(*conditions))
    rows = (
        await session.scalars(
            select(AuditEvent)
            .where(*conditions)
            .order_by(AuditEvent.occurred_at.desc(), AuditEvent.id)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return list(rows), int(total or 0)


@dataclass(frozen=True)
class ProbeResult:
    ok: bool
    latency_ms: int
    outcome: Literal["success", "failure", "timeout"]


@dataclass(frozen=True)
class IntegrationStatus:
    configured: bool
    enabled: bool
    last_success_at: datetime | None
    last_failure_at: datetime | None
    last_error: str | None
    failures_24h: int
    probe: ProbeResult | None


async def _probe(
    session: AsyncSession, provider: Provider, call: Any, timeout_s: float
) -> ProbeResult:
    """Exactly one provider call, recorded as a ``probe`` retrieval record."""
    started = time.monotonic()
    outcome: Literal["success", "failure", "timeout"] = "success"
    error_code: str | None = None
    try:
        async with asyncio.timeout(timeout_s):
            await call()
    except TimeoutError:
        outcome, error_code = "timeout", "UPSTREAM_TIMEOUT"
    except AppError as exc:
        outcome = "timeout" if exc.status_code == 504 else "failure"
        error_code = str(exc.code)
    except Exception:
        outcome, error_code = "failure", "UPSTREAM_ERROR"
    latency_ms = int((time.monotonic() - started) * 1000)
    session.add(
        RetrievalRecord(
            provider=provider,
            kind="probe",
            status="success" if outcome == "success" else "failed",
            item_count=0,
            duration_ms=latency_ms,
            error_code=error_code,
            error_message=None if error_code is None else f"Probe {outcome}.",
            finished_at=func.now(),
        )
    )
    await session.commit()
    return ProbeResult(ok=outcome == "success", latency_ms=latency_ms, outcome=outcome)


async def _history(session: AsyncSession, provider: Provider) -> dict[str, Any]:
    when = func.coalesce(RetrievalRecord.finished_at, RetrievalRecord.started_at)
    base = RetrievalRecord.provider == provider
    last_success = await session.scalar(
        select(func.max(when)).where(base, RetrievalRecord.status.in_(SUCCESS_STATUSES))
    )
    latest_failure = (
        await session.execute(
            select(when, RetrievalRecord.error_code, RetrievalRecord.error_message)
            .where(base, RetrievalRecord.status.in_(FAILURE_STATUSES))
            .order_by(when.desc())
            .limit(1)
        )
    ).first()
    failures = await session.scalar(
        select(func.count(RetrievalRecord.id)).where(
            base,
            RetrievalRecord.status.in_(FAILURE_STATUSES),
            RetrievalRecord.started_at >= func.now() - timedelta(hours=24),
        )
    )
    last_error = None
    if latest_failure is not None and (latest_failure[1] or latest_failure[2]):
        parts = [p for p in (latest_failure[1], latest_failure[2]) if p]
        last_error = ": ".join(parts)[:MAX_ERROR_LENGTH]
    return {
        "last_success_at": last_success,
        "last_failure_at": latest_failure[0] if latest_failure else None,
        "last_error": last_error,
        "failures_24h": int(failures or 0),
    }


async def integration_status(
    session: AsyncSession,
    agro: AgroClient,
    weather: WeatherProvider,
    *,
    probe: bool,
    timeout_s: float = PROBE_TIMEOUT_S,
) -> dict[str, IntegrationStatus]:
    agro_probe = weather_probe = None
    if probe:
        agro_probe = await _probe(session, "agromonitoring", agro.probe, timeout_s)
        if weather.configured:  # an unconfigured provider is never contacted (10.2)
            weather_probe = await _probe(session, "weather", weather.probe, timeout_s)
    values = await settings_service.current_values(session)
    return {
        "agromonitoring": IntegrationStatus(
            configured=True,  # AGRO_API_KEY is required at startup
            enabled=True,
            probe=agro_probe,
            **await _history(session, "agromonitoring"),
        ),
        "weather": IntegrationStatus(
            configured=weather.configured,
            enabled=bool(values["weather_enabled"]),
            probe=weather_probe,
            **await _history(session, "weather"),
        ),
    }


async def dashboard(session: AsyncSession) -> dict[str, Any]:
    areas = await session.scalar(select(func.count(Area.id)).where(Area.status == "active"))
    observations = await session.scalar(select(func.count(Observation.id)))
    reports = await session.scalar(select(func.count(Report.id)))
    roles = select(func.unnest(User.roles).label("role")).where(User.status == "active").subquery()
    role_rows = (
        await session.execute(select(roles.c.role, func.count()).group_by(roles.c.role))
    ).all()
    users_by_role = {"admin": 0, "researcher": 0}
    users_by_role.update({str(r): int(n) for r, n in role_rows})
    status_rows = (
        await session.execute(
            select(RetrievalRecord.status, func.count())
            .where(RetrievalRecord.started_at >= func.now() - timedelta(hours=168))
            .group_by(RetrievalRecord.status)
        )
    ).all()
    by_status = dict.fromkeys(STATUSES, 0)
    by_status.update({str(s): int(n) for s, n in status_rows})
    return {
        "areas_active": int(areas or 0),
        "observations_total": int(observations or 0),
        "reports_total": int(reports or 0),
        "users_by_role": users_by_role,
        "retrievals_7d_by_status": by_status,
    }
