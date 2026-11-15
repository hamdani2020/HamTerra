"""Refresh: retrieve observations from the provider and store them (Requirements 6.x).

Flow: validate the range, expire stale ``running`` records, insert a ``running``
record in its own transaction (the partial unique index gives 409 for a concurrent
refresh), then for each source fetch, upsert and commit in its own transaction.
The record is finished together with its Audit_Event.

Only normalised metadata and NDVI statistics are stored. No raw provider payload and
no image binary is stored, so ``retrieval_records.raw_payload`` stays empty.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal

from sqlalchemy import Boolean, ColumnElement, Insert, case, func, literal_column, or_, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import (
    AppError,
    Conflict,
    InternalError,
    NotFound,
    RefreshInProgress,
    ValidationFailed,
)
from app.core.security import Principal
from app.db.models.areas import Area
from app.db.models.observations import Observation
from app.db.models.retrievals import RetrievalRecord
from app.domain.constants import WARNING_MESSAGES, WarningCode
from app.domain.refresh_rules import refresh_range_problems
from app.integrations.agro.errors import AgroTimeoutError
from app.integrations.agro.models import AgroClient, NormalizedObservation, Source
from app.services import audit
from app.services.retrievals import RUNNING_EXPIRY_SECONDS

logger = logging.getLogger(__name__)

REFRESH_DEADLINE_S = 120.0
ALL_SOURCES: tuple[Source, ...] = ("sentinel-2", "landsat-8")
_CHUNK = 500
_PROVIDER = "agromonitoring"

Status = Literal["success", "partial", "empty"]


@dataclass(frozen=True)
class WarningItem:
    code: str
    message: str


@dataclass
class RefreshResult:
    retrieval_id: uuid.UUID
    status: Status
    new: int = 0
    updated: int = 0
    skipped: int = 0
    warnings: list[WarningItem] = field(default_factory=list)


@dataclass
class _Totals:
    new: int = 0
    updated: int = 0
    skipped: int = 0
    discarded: int = 0
    failures: list[tuple[str, AppError]] = field(default_factory=list)
    stored_sources: int = 0


def _warning(code: WarningCode, message: str | None = None) -> WarningItem:
    return WarningItem(code.value, message or WARNING_MESSAGES[code])


def _dec(value: float | None) -> Decimal | None:
    return None if value is None else Decimal(repr(value))


def _row(
    area_id: uuid.UUID, retrieval_id: uuid.UUID, item: NormalizedObservation
) -> dict[str, Any]:
    ndvi = item.ndvi
    if ndvi is None:
        raise ValueError("history items always carry NDVI statistics")
    return {
        "area_id": area_id,
        "source": item.source,
        "acquired_on": item.acquired_on,
        "cloud_coverage": _dec(item.cloud_coverage),
        "data_coverage": _dec(item.data_coverage),
        "ndvi_mean": _dec(ndvi.mean),
        "ndvi_min": _dec(ndvi.min),
        "ndvi_max": _dec(ndvi.max),
        "ndvi_std": _dec(ndvi.std),
        "ndvi_median": _dec(ndvi.median),
        "preview_ref": item.preview_ref,
        "geometry_status": "current",
        "retrieval_id": retrieval_id,
    }


_INSERTED: ColumnElement[bool] = literal_column("(xmax = 0)", type_=Boolean)

_COMPARED = (
    "cloud_coverage",
    "data_coverage",
    "ndvi_mean",
    "ndvi_min",
    "ndvi_max",
    "ndvi_std",
    "ndvi_median",
    "preview_ref",
    "geometry_status",
)


async def upsert_observations(
    session: AsyncSession,
    area_id: uuid.UUID,
    retrieval_id: uuid.UUID,
    items: list[NormalizedObservation],
) -> tuple[int, int, int]:
    """Insert or update rows. Returns ``(new, updated, skipped)``; each item counts once.

    A row is rewritten only when a stored column differs, so repeating a refresh with
    unchanged data reports no new and no updated rows. ``xmax = 0`` marks an insert.
    """
    new = updated = 0
    for start in range(0, len(items), _CHUNK):
        chunk = items[start : start + _CHUNK]
        base = insert(Observation).values([_row(area_id, retrieval_id, i) for i in chunk])
        excluded = base.excluded
        ref_changed = Observation.preview_ref.is_distinct_from(excluded.preview_ref)
        differs = or_(
            *[
                getattr(Observation, name).is_distinct_from(getattr(excluded, name))
                for name in _COMPARED
            ]
        )
        upsert: Insert = base.on_conflict_do_update(
            constraint="uq_observation_area_source_date",
            set_={
                **{name: getattr(excluded, name) for name in _COMPARED},
                "preview_width_px": case((ref_changed, None), else_=Observation.preview_width_px),
                "preview_height_px": case((ref_changed, None), else_=Observation.preview_height_px),
                "retrieval_id": excluded.retrieval_id,
                "updated_at": func.now(),
            },
            where=differs,
        )
        stmt = upsert.returning(_INSERTED)
        result = await session.execute(stmt)
        flags = [bool(row[0]) for row in result.all()]
        new += sum(flags)
        updated += len(flags) - sum(flags)
    return new, updated, len(items) - new - updated


def _merge(
    history: list[NormalizedObservation], images: list[NormalizedObservation]
) -> list[NormalizedObservation]:
    """Statistics come from the history items; previews are attached from image search."""
    previews = {(i.source, i.acquired_on): i.preview_ref for i in images if i.preview_ref}
    merged: list[NormalizedObservation] = []
    for item in history:
        ref = item.preview_ref or previews.get((item.source, item.acquired_on))
        merged.append(replace(item, preview_ref=ref) if ref != item.preview_ref else item)
    return merged


async def _refresh_source(
    session: AsyncSession,
    agro: AgroClient,
    area: Area,
    polygon: str,
    retrieval_id: uuid.UUID,
    source: Source,
    start: date,
    end: date,
    totals: _Totals,
) -> None:
    area_label = str(area.id)
    history = await agro.ndvi_history(polygon, source, start, end, area_id=area_label)
    images_batch = history
    if not all(i.preview_ref for i in history.items):
        images_batch = await agro.image_search(polygon, source, start, end, area_id=area_label)
    items = _merge(history.items, images_batch.items)
    new, updated, skipped = await upsert_observations(session, area.id, retrieval_id, items)
    await session.commit()
    totals.new += new
    totals.updated += updated
    totals.skipped += skipped + history.skipped_duplicates
    totals.discarded += len(history.discarded)
    totals.stored_sources += 1


async def _expire_stale(session: AsyncSession, area_id: uuid.UUID) -> None:
    await session.execute(
        update(RetrievalRecord)
        .where(
            RetrievalRecord.area_id == area_id,
            RetrievalRecord.kind == "refresh",
            RetrievalRecord.status == "running",
            RetrievalRecord.started_at < func.now() - timedelta(seconds=RUNNING_EXPIRY_SECONDS),
        )
        .values(
            status="failed",
            error_code="EXPIRED",
            error_message="Retrieval did not finish and was expired.",
            finished_at=func.now(),
        )
    )
    await session.commit()


async def _start_record(
    session: AsyncSession, actor: Principal, area_id: uuid.UUID, start: date, end: date
) -> uuid.UUID:
    record = RetrievalRecord(
        provider=_PROVIDER,
        kind="refresh",
        area_id=area_id,
        requested_by=actor.sub,
        requested_from=start,
        requested_to=end,
        status="running",
        item_count=0,
    )
    session.add(record)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise RefreshInProgress() from None
    return record.id


def _finish_status(totals: _Totals) -> tuple[str, str | None, str | None]:
    """Return ``(status, error_code, error_message)`` for the record."""
    failed = [source for source, _ in totals.failures]
    if failed and totals.stored_sources == 0:
        return "failed", "UPSTREAM_ERROR", f"The provider failed for: {', '.join(failed)}."
    if failed:
        return "partial", "UPSTREAM_ERROR", f"The provider failed for: {', '.join(failed)}."
    if totals.new + totals.updated + totals.skipped == 0:
        return "empty", None, None
    return "success", None, None


async def _finalize(
    session: AsyncSession,
    actor: Principal,
    area_id: uuid.UUID,
    retrieval_id: uuid.UUID,
    started: float,
    totals: _Totals,
    status: str,
    error_code: str | None,
    error_message: str | None,
    details: dict[str, Any],
) -> None:
    duration_ms = int((time.monotonic() - started) * 1000)
    try:
        await session.execute(
            update(RetrievalRecord)
            .where(RetrievalRecord.id == retrieval_id)
            .values(
                status=status,
                item_count=totals.new + totals.updated,
                duration_ms=duration_ms,
                error_code=error_code,
                error_message=error_message,
                finished_at=func.now(),
            )
        )
        await audit.record(
            session,
            actor_sub=actor.sub,
            action="refresh.trigger",
            target_type="area",
            target_id=str(area_id),
            outcome="failure" if status == "failed" else "success",
            details={
                **details,
                "status": status,
                "new": totals.new,
                "updated": totals.updated,
                "skipped": totals.skipped,
            },
        )
        await session.commit()
    except InternalError:
        await session.rollback()
        # The audit write failed. Do not leave the record `running`.
        await session.execute(
            update(RetrievalRecord)
            .where(RetrievalRecord.id == retrieval_id)
            .values(
                status="failed",
                duration_ms=duration_ms,
                error_code="AUDIT_FAILED",
                error_message="The audit record could not be written.",
                finished_at=func.now(),
            )
        )
        await session.commit()
        raise


async def refresh_area(
    session: AsyncSession,
    agro: AgroClient,
    settings: Settings,
    actor: Principal,
    area_id: uuid.UUID,
    *,
    date_from: date,
    date_to: date,
    sources: list[Source] | None = None,
    today: date | None = None,
    deadline_s: float | None = None,
) -> RefreshResult:
    problems = refresh_range_problems(
        date_from,
        date_to,
        today or datetime.now(UTC).date(),
        settings.refresh_max_range_days,
    )
    if problems:
        raise ValidationFailed(details={"fields": [{"field": f, "reason": r} for f, r in problems]})
    area = await session.get(Area, area_id)
    if area is None:
        raise NotFound("The monitoring area was not found.")
    polygon = area.external_polygon_id
    if not polygon:
        raise Conflict("The monitoring area has no registered provider polygon.")

    wanted = [s for s in ALL_SOURCES if sources is None or s in sources]
    await _expire_stale(session, area_id)
    retrieval_id = await _start_record(session, actor, area_id, date_from, date_to)
    started = time.monotonic()
    totals = _Totals()
    details = {
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "sources": wanted,
    }
    timed_out = False
    try:
        async with asyncio.timeout(deadline_s if deadline_s is not None else REFRESH_DEADLINE_S):
            for source in wanted:
                try:
                    await _refresh_source(
                        session,
                        agro,
                        area,
                        polygon,
                        retrieval_id,
                        source,
                        date_from,
                        date_to,
                        totals,
                    )
                except AppError as exc:
                    await session.rollback()
                    logger.warning(
                        "refresh_source_failed",
                        extra={
                            "area_id": str(area_id),
                            "source": source,
                            "error_code": str(exc.code),
                        },
                    )
                    totals.failures.append((source, exc))
    except TimeoutError:
        timed_out = True
        await session.rollback()
    except BaseException:
        await session.rollback()
        await _finalize_after_error(session, retrieval_id, started)
        raise

    if timed_out:
        status = "partial" if totals.stored_sources else "failed"
        await _finalize(
            session, actor, area_id, retrieval_id, started, totals, status,
            "UPSTREAM_TIMEOUT", "The refresh did not finish within the time limit.", details,
        )  # fmt: skip
        raise AgroTimeoutError()

    status, error_code, error_message = _finish_status(totals)
    await _finalize(
        session,
        actor,
        area_id,
        retrieval_id,
        started,
        totals,
        status,
        error_code,
        error_message,
        details,
    )
    if status == "failed":
        raise totals.failures[0][1]

    warnings: list[WarningItem] = []
    if totals.discarded:
        warnings.append(
            _warning(
                WarningCode.ITEMS_DISCARDED,
                f"{totals.discarded} provider item(s) were discarded because they were "
                "incomplete or invalid.",
            )
        )
    if status == "partial":
        failed = ", ".join(source for source, _ in totals.failures)
        warnings.append(
            _warning(
                WarningCode.UPSTREAM_ERROR,
                f"The retrieval is incomplete. The provider failed for: {failed}.",
            )
        )
    return RefreshResult(
        retrieval_id=retrieval_id,
        status=status,  # type: ignore[arg-type]
        new=totals.new,
        updated=totals.updated,
        skipped=totals.skipped,
        warnings=warnings,
    )


async def _finalize_after_error(
    session: AsyncSession, retrieval_id: uuid.UUID, started: float
) -> None:
    """Best effort: an unexpected error must not leave the record ``running``."""
    try:
        await session.execute(
            update(RetrievalRecord)
            .where(RetrievalRecord.id == retrieval_id)
            .values(
                status="failed",
                duration_ms=int((time.monotonic() - started) * 1000),
                error_code="INTERNAL_ERROR",
                error_message="The refresh failed unexpectedly.",
                finished_at=func.now(),
            )
        )
        await session.commit()
    except Exception:
        logger.error("refresh_record_finalize_failed", extra={"retrieval_id": str(retrieval_id)})
        await session.rollback()
