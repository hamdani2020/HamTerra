"""Comparison of two stored observations (Requirements 8.x, 21.x).

Check order: equal dates (422), threshold overrides (422), the area (404), each date's
observation (404 naming the date), then the sensor rule (422).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import CrossSensorComparison, NotFound, ValidationFailed
from app.db.models.areas import Area
from app.db.models.observations import Observation
from app.domain.app_settings import SETTING_DEFS, SettingValueError, validate_value
from app.domain.comparison import (
    ComparisonCore,
    CrossSensorError,
    EqualDatesError,
    ObsStats,
    compare,
)
from app.domain.constants import WarningCode
from app.domain.quality import QualityResult, comparison_quality
from app.integrations.weather.base import WeatherProvider
from app.services import settings as settings_service
from app.services.observations import ObservationView, QualityLimits, view_of
from app.services.weather import weather_for_periods

# Override name -> setting key (Requirement 8.10).
OVERRIDE_KEYS: dict[str, str] = {
    "ndvi_diff": "ndvi_diff_threshold",
    "max_cloud": "cloud_limit_pct",
    "min_data_coverage": "data_coverage_min_pct",
}


@dataclass(frozen=True)
class Thresholds:
    ndvi_diff: float
    max_cloud: float
    min_data_coverage: float

    def as_dict(self) -> dict[str, float]:
        return {
            "ndvi_diff": self.ndvi_diff,
            "max_cloud": self.max_cloud,
            "min_data_coverage": self.min_data_coverage,
        }


@dataclass(frozen=True)
class ComparisonOutcome:
    area_id: uuid.UUID
    source: str
    a: ObservationView
    b: ObservationView
    core: ComparisonCore
    thresholds: Thresholds
    quality: QualityResult
    weather: dict[str, dict[str, Any] | None] | None
    warnings: list[WarningCode]


def equal_dates_error() -> ValidationFailed:
    return ValidationFailed(
        "The two dates must differ.",
        details={
            "defect": "EQUAL_DATES",
            "fields": [{"field": "date_b", "reason": "date_b must differ from date_a"}],
        },
    )


async def resolve_thresholds(session: AsyncSession, overrides: dict[str, Any] | None) -> Thresholds:
    """Stored settings, with request overrides validated against the same ranges.

    Overrides apply to this request only; nothing is written.
    """
    values = await settings_service.current_values(session)
    resolved = {name: float(values[key]) for name, key in OVERRIDE_KEYS.items()}
    problems = []
    for name, value in (overrides or {}).items():
        if value is None:
            continue
        try:
            resolved[name] = float(validate_value(SETTING_DEFS[OVERRIDE_KEYS[name]], value))
        except SettingValueError as exc:
            problems.append({"field": f"thresholds.{name}", "reason": exc.detail})
    if problems:
        raise ValidationFailed(details={"fields": problems})
    return Thresholds(**resolved)


async def _observation(
    session: AsyncSession, area_id: uuid.UUID, source: str, day: date
) -> Observation | None:
    return await session.scalar(
        select(Observation).where(
            Observation.area_id == area_id,
            Observation.source == source,
            Observation.acquired_on == day,
        )
    )


async def compare_observations(
    session: AsyncSession,
    area_id: uuid.UUID,
    *,
    source: str,
    date_a: date,
    date_b: date,
    thresholds: Thresholds,
    include_weather: bool = False,
    weather_provider: WeatherProvider | None = None,
) -> ComparisonOutcome:
    if date_a == date_b:
        raise equal_dates_error()
    if await session.scalar(select(Area.id).where(Area.id == area_id)) is None:
        raise NotFound("The monitoring area was not found.", details={"area_id": str(area_id)})
    obs_a = await _observation(session, area_id, source, date_a)
    obs_b = await _observation(session, area_id, source, date_b)
    missing = [d.isoformat() for d, o in ((date_a, obs_a), (date_b, obs_b)) if o is None]
    if missing or obs_a is None or obs_b is None:
        raise NotFound(
            f"No stored observation for {source} on {', '.join(missing)}.",
            details={"missing_dates": missing},
        )
    return await compare_loaded(
        session,
        obs_a,
        obs_b,
        thresholds=thresholds,
        include_weather=include_weather,
        weather_provider=weather_provider,
    )


async def compare_loaded(
    session: AsyncSession,
    obs_a: Observation,
    obs_b: Observation,
    *,
    thresholds: Thresholds,
    include_weather: bool = False,
    weather_provider: WeatherProvider | None = None,
) -> ComparisonOutcome:
    try:
        core = compare(
            ObsStats(obs_a.source, obs_a.acquired_on, float(obs_a.ndvi_mean)),
            ObsStats(obs_b.source, obs_b.acquired_on, float(obs_b.ndvi_mean)),
            thresholds.ndvi_diff,
        )
    except CrossSensorError:
        raise CrossSensorComparison() from None
    except EqualDatesError:
        raise equal_dates_error() from None

    limits = QualityLimits(cloud_limit=thresholds.max_cloud, data_min=thresholds.min_data_coverage)
    view_a, view_b = view_of(obs_a, limits), view_of(obs_b, limits)
    quality = comparison_quality(view_a.quality, view_b.quality)

    warnings = list(core.warnings)
    if WarningCode.LOW_QUALITY_OBSERVATION in quality.warnings:
        warnings.append(WarningCode.LOW_QUALITY_OBSERVATION)

    weather: dict[str, dict[str, Any] | None] | None = None
    if include_weather and weather_provider is not None:
        first, last = sorted((obs_a.acquired_on, obs_b.acquired_on))
        outcome = await weather_for_periods(
            session,
            weather_provider,
            obs_a.area_id,
            [
                (obs_a.acquired_on, obs_a.acquired_on),
                (obs_b.acquired_on, obs_b.acquired_on),
                (first, last),
            ],
        )
        if outcome.any_context:
            weather = dict(zip(("a", "b", "between"), outcome.contexts, strict=True))
        warnings.extend(outcome.warnings)

    return ComparisonOutcome(
        area_id=obs_a.area_id,
        source=obs_a.source,
        a=view_a,
        b=view_b,
        core=core,
        thresholds=thresholds,
        quality=quality,
        weather=weather,
        warnings=warnings,
    )
