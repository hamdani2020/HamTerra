"""Evidence reports (Requirements 11.x, 18.1).

A report stores a JSON snapshot of everything it shows. Reads return only that snapshot, so
later refreshes, area edits or setting changes cannot change a stored report.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.serializers import comparison_out, quality_out, warnings_out
from app.core.errors import NoObservations, NotFound, ValidationFailed
from app.core.permissions import REQUIRED_ROLE, Permission
from app.core.security import Principal, role_satisfies
from app.db.models.areas import Area
from app.db.models.observations import Observation
from app.db.models.reports import Comparison, Report
from app.db.models.users import User
from app.domain.constants import CAVEATS, LIMITATIONS
from app.domain.timeseries import SeriesInput, build_series
from app.integrations.weather.base import WeatherProvider
from app.services import audit
from app.services import settings as settings_service
from app.services.comparisons import (
    Thresholds,
    compare_loaded,
    equal_dates_error,
    resolve_thresholds,
)
from app.services.observations import QualityLimits, view_of
from app.services.weather import weather_for_periods

MAX_REPORT_SPAN_DAYS = 1826


@dataclass(frozen=True)
class ReportRow:
    report: Report
    content: dict[str, Any]


def _num(value: Any) -> float | None:
    return None if value is None else float(value)


def can_read_all(principal: Principal) -> bool:
    return role_satisfies(principal.roles, REQUIRED_ROLE[Permission.REPORTS_READ_ALL])


def validate_period(date_from: date, date_to: date) -> None:
    if date_from > date_to:
        raise ValidationFailed(
            details={
                "fields": [{"field": "date_from", "reason": "date_from must not be after date_to"}]
            }
        )
    if (date_to - date_from).days + 1 > MAX_REPORT_SPAN_DAYS:
        raise ValidationFailed(
            details={
                "fields": [
                    {
                        "field": "date_to",
                        "reason": "the range must not be longer than 5 years (1826 days)",
                    }
                ]
            }
        )


async def create_report(
    session: AsyncSession,
    actor: Principal,
    weather_provider: WeatherProvider,
    *,
    area_id: uuid.UUID,
    source: str,
    date_from: date,
    date_to: date,
    title: str | None,
    pairs: list[tuple[date, date]],
    include_weather: bool,
) -> ReportRow:
    validate_period(date_from, date_to)
    for a, b in pairs:
        if a == b:
            raise equal_dates_error()

    area = await session.get(Area, area_id)
    if area is None:
        raise NotFound("The monitoring area was not found.", details={"area_id": str(area_id)})
    geometry_text = await session.scalar(
        select(func.ST_AsGeoJSON(Area.geom)).where(Area.id == area_id)
    )

    rows = (
        await session.scalars(
            select(Observation)
            .where(
                Observation.area_id == area_id,
                Observation.source == source,
                Observation.acquired_on >= date_from,
                Observation.acquired_on <= date_to,
            )
            .order_by(Observation.acquired_on)
        )
    ).all()
    if not rows:
        raise NoObservations(
            "No observations are stored for this area, sensor and period.",
            details={"area_id": str(area_id), "source": source},
        )

    thresholds: Thresholds = await resolve_thresholds(session, None)
    limits = QualityLimits(cloud_limit=thresholds.max_cloud, data_min=thresholds.min_data_coverage)
    gap_days = int((await settings_service.current_values(session))["gap_threshold_days"])
    views = [view_of(o, limits) for o in rows]
    series = build_series(
        [
            SeriesInput(
                v.observation.acquired_on,
                float(v.observation.ndvi_mean),
                _num(v.observation.cloud_coverage),
                v,
            )
            for v in views
        ],
        max_cloud=None,
        gap_threshold_days=gap_days,
    )

    by_date = {o.acquired_on: o for o in rows}
    comparisons = []
    for a, b in pairs:
        obs_a = by_date.get(a) or await _load(session, area_id, source, a)
        obs_b = by_date.get(b) or await _load(session, area_id, source, b)
        if obs_a is None or obs_b is None:
            missing = [d.isoformat() for d, o in ((a, obs_a), (b, obs_b)) if o is None]
            raise NotFound(
                f"No stored observation for {source} on {', '.join(missing)}.",
                details={"missing_dates": missing},
            )
        comparisons.append(await compare_loaded(session, obs_a, obs_b, thresholds=thresholds))

    weather = None
    warning_codes = list(series.warnings)
    if include_weather:
        outcome = await weather_for_periods(
            session, weather_provider, area_id, [(date_from, date_to)]
        )
        weather = outcome.contexts[0]
        warning_codes.extend(outcome.warnings)

    author = await session.scalar(select(User).where(User.sub == actor.sub))
    if author is None:  # get_principal always upserts the caller first
        raise NotFound("The user record was not found.")

    summary = series.summary
    content: dict[str, Any] = {
        "title": title
        or f"{area.name}: {source} NDVI, {date_from.isoformat()} to {date_to.isoformat()}",
        "created_by": {"sub": actor.sub, "username": actor.username},
        "area": {
            "id": str(area.id),
            "name": area.name,
            "area_ha": float(area.area_ha),
            "geometry": json.loads(geometry_text) if geometry_text else None,
        },
        "period": {"from": date_from.isoformat(), "to": date_to.isoformat()},
        "source": source,
        "observations": [
            {
                "date": v.observation.acquired_on.isoformat(),
                "ndvi_mean": float(v.observation.ndvi_mean),
                "cloud_coverage_pct": v.quality.cloud_coverage_pct,
                "data_coverage_pct": v.quality.data_coverage_pct,
                "quality": quality_out(v.quality).model_dump(mode="json"),
            }
            for v in views
        ],
        "summary": {
            "count": summary.count,
            "first_date": summary.first_date.isoformat() if summary.first_date else None,
            "last_date": summary.last_date.isoformat() if summary.last_date else None,
            "min": summary.min,
            "max": summary.max,
            "mean_of_means": summary.mean_of_means,
            "trend_per_30d": summary.trend_per_30d,
        },
        "comparisons": [comparison_out(c).model_dump(mode="json") for c in comparisons],
        "thresholds_applied": thresholds.as_dict(),
        "weather": weather,
        "warnings": [w.model_dump(mode="json") for w in warnings_out(warning_codes)],
        "caveats": list(CAVEATS),
        "limitations": list(LIMITATIONS),
    }

    try:
        report = Report(
            title=content["title"],
            area_id=area.id,
            created_by=author.id,
            source=source,
            period_from=date_from,
            period_to=date_to,
            content=content,
        )
        session.add(report)
        await session.flush()
        for pair, result in zip(pairs, content["comparisons"], strict=True):
            session.add(
                Comparison(
                    report_id=report.id,
                    area_id=area.id,
                    source=source,
                    date_a=pair[0],
                    date_b=pair[1],
                    result=result,
                )
            )
        await audit.record(
            session,
            actor_sub=actor.sub,
            action="report.create",
            target_type="report",
            target_id=str(report.id),
            details={"area_id": str(area.id), "source": source, "comparisons": len(pairs)},
        )
        await session.commit()
    except BaseException:
        await session.rollback()
        raise
    await session.refresh(report)
    return ReportRow(report, content)


async def _load(
    session: AsyncSession, area_id: uuid.UUID, source: str, day: date
) -> Observation | None:
    return await session.scalar(
        select(Observation).where(
            Observation.area_id == area_id,
            Observation.source == source,
            Observation.acquired_on == day,
        )
    )


def _not_found() -> NotFound:
    # Identical for a missing report and another user's report (Requirement 11.10).
    return NotFound("The report was not found.")


async def get_report(
    session: AsyncSession, principal: Principal, report_id: uuid.UUID
) -> ReportRow:
    row = (
        await session.execute(
            select(Report, User.sub)
            .join(User, User.id == Report.created_by)
            .where(Report.id == report_id)
        )
    ).first()
    if row is None:
        raise _not_found()
    report, owner_sub = row
    if owner_sub != principal.sub and not can_read_all(principal):
        raise _not_found()
    return ReportRow(report, report.content)


async def list_reports(
    session: AsyncSession,
    principal: Principal,
    *,
    area_id: uuid.UUID | None,
    created_by: str | None,
    limit: int,
    offset: int,
) -> tuple[list[ReportRow], int]:
    conditions: list[Any] = []
    if can_read_all(principal):
        if created_by is not None:
            conditions.append(User.sub == created_by)
    else:
        if created_by is not None and created_by != principal.sub:
            raise ValidationFailed(
                details={
                    "fields": [
                        {"field": "created_by", "reason": "only admins may filter by creator"}
                    ]
                }
            )
        conditions.append(User.sub == principal.sub)
    if area_id is not None:
        conditions.append(Report.area_id == area_id)
    base = select(Report).join(User, User.id == Report.created_by).where(*conditions)
    total = await session.scalar(select(func.count()).select_from(base.subquery()))
    reports = (
        await session.scalars(
            base.order_by(Report.created_at.desc(), Report.id).limit(limit).offset(offset)
        )
    ).all()
    return [ReportRow(r, r.content) for r in reports], int(total or 0)


def report_document(row: ReportRow) -> dict[str, Any]:
    """The stored snapshot plus the row's identity fields."""
    created_at: datetime = row.report.created_at
    return {"id": str(row.report.id), "created_at": created_at, **row.content}
