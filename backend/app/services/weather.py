"""Weather context for time series, comparisons and reports (Requirements 7.13, 7.14, 8.16,
8.17, 10.x).

Weather is environmental context only. No correlation with NDVI is computed or returned.
Failures never fail the request: they become ``weather: null`` and a warning code.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.db.models.areas import Area
from app.db.models.retrievals import RetrievalRecord
from app.db.session import get_sessionmaker
from app.domain.constants import WEATHER_NOTE, WarningCode
from app.integrations.weather.base import WeatherProvider, WeatherRecord
from app.services import settings as settings_service

logger = logging.getLogger(__name__)

WEATHER_TIMEOUT_S = 10.0
Period = tuple[date, date]


@dataclass
class WeatherOutcome:
    """One context (or None) per requested period, in request order, plus warnings."""

    contexts: list[dict[str, Any] | None]
    warnings: list[WarningCode] = field(default_factory=list)

    @property
    def any_context(self) -> bool:
        return any(c is not None for c in self.contexts)


def _round(value: float) -> float:
    return round(value, 2)


def build_context(
    provider: str, period: Period, records: list[WeatherRecord]
) -> dict[str, Any] | None:
    """Aggregate the records of ``period`` (UTC days, inclusive). None when there are none."""
    start, end = period
    inside = [r for r in records if start <= r.observed_at.date() <= end]
    if not inside:
        return None
    values: dict[str, dict[str, Any]] = {}
    temps = [r.temperature_c for r in inside if r.temperature_c is not None]
    if temps:
        values["temperature_mean"] = {"value": _round(sum(temps) / len(temps)), "unit": "°C"}
    rain = [r.precipitation_mm for r in inside if r.precipitation_mm is not None]
    if rain:
        values["precipitation_total"] = {"value": _round(sum(rain)), "unit": "mm"}
    wind = [r.wind_speed_ms for r in inside if r.wind_speed_ms is not None]
    if wind:
        values["wind_speed_mean"] = {"value": _round(sum(wind) / len(wind)), "unit": "m/s"}
    if not values:
        return None
    return {
        "provider": provider,
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "values": values,
        "note": WEATHER_NOTE,
    }


async def _area_point(session: AsyncSession, area_id: uuid.UUID) -> tuple[float, float] | None:
    point = func.ST_PointOnSurface(Area.geom)
    row = (
        await session.execute(select(func.ST_Y(point), func.ST_X(point)).where(Area.id == area_id))
    ).first()
    return None if row is None else (float(row[0]), float(row[1]))


async def _log_call(
    area_id: uuid.UUID, start: date, end: date, status: str, duration_ms: int, error: str | None
) -> None:
    """One Retrieval_Record per provider call, written in its own session (best effort)."""
    try:
        async with get_sessionmaker()() as session:
            session.add(
                RetrievalRecord(
                    provider="weather",
                    kind="weather",
                    area_id=area_id,
                    requested_from=start,
                    requested_to=end,
                    status=status,
                    item_count=0,
                    duration_ms=duration_ms,
                    error_code=error,
                    error_message=None if error is None else "The weather provider call failed.",
                    finished_at=func.now(),
                )
            )
            await session.commit()
    except Exception:
        logger.warning("weather_record_write_failed")


def _chunks(provider: WeatherProvider, start: date, end: date) -> list[Period]:
    splitter = getattr(provider, "chunks", None)
    if callable(splitter):
        result: list[Period] = splitter(start, end)
        return result
    return [(start, end)]


async def weather_for_periods(
    session: AsyncSession,
    provider: WeatherProvider,
    area_id: uuid.UUID,
    periods: list[Period],
    *,
    timeout_s: float | None = None,
) -> WeatherOutcome:
    empty = WeatherOutcome(contexts=[None] * len(periods))
    values = await settings_service.current_values(session)
    if not provider.configured or not values["weather_enabled"]:
        empty.warnings.append(WarningCode.WEATHER_DISABLED)
        return empty
    if not periods:
        return empty
    point = await _area_point(session, area_id)
    if point is None:
        empty.warnings.append(WarningCode.WEATHER_UNAVAILABLE)
        return empty
    lat, lon = point

    records: list[WeatherRecord] = []
    discarded = 0
    start = min(p[0] for p in periods)
    end = max(p[1] for p in periods)
    try:
        async with asyncio.timeout(timeout_s if timeout_s is not None else WEATHER_TIMEOUT_S):
            for chunk_start, chunk_end in _chunks(provider, start, end):
                started = time.monotonic()
                try:
                    batch = await provider.history(lat, lon, chunk_start, chunk_end)
                except (AppError, TimeoutError) as exc:
                    code = "UPSTREAM_TIMEOUT" if isinstance(exc, TimeoutError) else str(exc.code)
                    await _log_call(
                        area_id, chunk_start, chunk_end, "failed",
                        int((time.monotonic() - started) * 1000), code,
                    )  # fmt: skip
                    raise
                await _log_call(
                    area_id, chunk_start, chunk_end, "success" if batch.records else "empty",
                    int((time.monotonic() - started) * 1000), None,
                )  # fmt: skip
                records.extend(batch.records)
                discarded += batch.discarded_values
    except (AppError, TimeoutError):
        logger.warning("weather_unavailable", extra={"area_id": str(area_id)})
        empty.warnings.append(WarningCode.WEATHER_UNAVAILABLE)
        return empty

    outcome = WeatherOutcome(contexts=[build_context(provider.name, p, records) for p in periods])
    if discarded:
        outcome.warnings.append(WarningCode.WEATHER_INVALID_DATA)
    if any(c is None for c in outcome.contexts):
        outcome.warnings.append(WarningCode.WEATHER_UNAVAILABLE)
    return outcome
