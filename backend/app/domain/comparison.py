"""Comparison of two observations of one sensor (Requirements 8.x, 21.x). Pure.

``ndvi_diff = mean(date_b) - mean(date_a)``; the percentage is relative to ``date_a``.
Arithmetic uses ``Decimal`` from the stored 4-decimal values, so results are exact and
repeatable, and swapping the dates flips the sign exactly.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from app.domain.constants import WarningCode

Flag = Literal["flagged", "not_flagged"]

SEASON_DAYS = 365
SEASON_TOLERANCE_DAYS = 15

_FLAGGED = (
    "Difference flagged for investigation: mean NDVI changed by {diff} between {date_a} and "
    "{date_b}. This is a polygon-level aggregate; no spatial change is inferred and the cause "
    "of any change is not identified."
)
_NOT_FLAGGED = (
    "Mean NDVI difference of {diff} between {date_a} and {date_b} is below the investigation "
    "threshold of {threshold}. This is a polygon-level aggregate; no spatial change is inferred "
    "and the cause of any change is not identified."
)


class CrossSensorError(ValueError):
    """The two observations come from different sensors (Requirement 8.3)."""


class EqualDatesError(ValueError):
    """The two dates are the same (Requirement 8.4)."""


@dataclass(frozen=True)
class ObsStats:
    source: str
    acquired_on: date
    ndvi_mean: float


@dataclass(frozen=True)
class ComparisonCore:
    ndvi_diff: float
    ndvi_diff_pct: float | None
    interval_days: int
    flag: Flag
    summary_text: str
    warnings: tuple[WarningCode, ...]


def _dec(value: float) -> Decimal:
    return Decimal(repr(value))


def seasonality_not_controlled(interval_days: int) -> bool:
    """True unless some ``k >= 1`` has ``abs(interval - 365k) <= 15``."""
    k = round(interval_days / SEASON_DAYS)
    return not (k >= 1 and abs(interval_days - SEASON_DAYS * k) <= SEASON_TOLERANCE_DAYS)


def is_flagged(mean_a: float, mean_b: float, threshold: float) -> bool:
    """``>=`` on the unrounded difference (Requirement 8.7)."""
    return abs(_dec(mean_b) - _dec(mean_a)) >= _dec(threshold)


def compare(a: ObsStats, b: ObsStats, ndvi_diff_threshold: float) -> ComparisonCore:
    if a.source != b.source:
        raise CrossSensorError("observations come from different sensors")
    if a.acquired_on == b.acquired_on:
        raise EqualDatesError("the two dates are equal")

    raw = _dec(b.ndvi_mean) - _dec(a.ndvi_mean)
    diff = raw.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    warnings: list[WarningCode] = []
    pct: float | None
    if _dec(a.ndvi_mean) == 0:
        pct = None
        warnings.append(WarningCode.PERCENT_DIFFERENCE_UNDEFINED)
    else:
        pct = float(
            (raw / abs(_dec(a.ndvi_mean)) * 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        )
    interval = abs((b.acquired_on - a.acquired_on).days)
    if seasonality_not_controlled(interval):
        warnings.append(WarningCode.SEASONALITY_NOT_CONTROLLED)

    flagged = is_flagged(a.ndvi_mean, b.ndvi_mean, ndvi_diff_threshold)
    template = _FLAGGED if flagged else _NOT_FLAGGED
    summary = template.format(
        diff=f"{diff:+.4f}",
        date_a=a.acquired_on.isoformat(),
        date_b=b.acquired_on.isoformat(),
        threshold=format(_dec(ndvi_diff_threshold).normalize(), "f"),
    )
    return ComparisonCore(
        ndvi_diff=float(diff),
        ndvi_diff_pct=pct,
        interval_days=interval,
        flag="flagged" if flagged else "not_flagged",
        summary_text=summary,
        warnings=tuple(warnings),
    )
