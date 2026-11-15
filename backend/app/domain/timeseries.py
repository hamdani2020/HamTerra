"""NDVI time-series construction (Requirements 7.1, 7.6, 7.8 to 7.12). Pure.

One series holds one sensor's observations only; the caller selects the source.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from app.domain.constants import WarningCode

TREND_WINDOW_DAYS = 30


@dataclass(frozen=True)
class SeriesInput[T]:
    """One stored observation. ``ref`` carries the caller's object through unchanged."""

    acquired_on: date
    ndvi_mean: float
    cloud_coverage: float | None
    ref: T


@dataclass(frozen=True)
class SeriesPoint[T]:
    item: SeriesInput[T]
    gap_days_from_previous: int | None


@dataclass(frozen=True)
class SeriesSummary:
    count: int
    first_date: date | None = None
    last_date: date | None = None
    min: float | None = None
    max: float | None = None
    mean_of_means: float | None = None
    trend_per_30d: float | None = None


@dataclass(frozen=True)
class Series[T]:
    points: list[SeriesPoint[T]]
    summary: SeriesSummary
    excluded_by_cloud: int
    warnings: list[WarningCode] = field(default_factory=list)


def round4(value: float) -> float:
    """Half-up rounding to 4 decimals, from the shortest decimal form of ``value``."""
    return float(Decimal(repr(value)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))


def trend_slope_per_30d(days: list[float], values: list[float]) -> float:
    """Ordinary least squares slope of ``values`` over ``days``, times 30 (unrounded)."""
    n = len(days)
    if n < 2:
        raise ValueError("at least two points are needed")
    mean_x = sum(days) / n
    mean_y = sum(values) / n
    sxx = sum((x - mean_x) ** 2 for x in days)
    if sxx == 0:
        raise ValueError("dates must not all be equal")
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(days, values, strict=True))
    return sxy / sxx * TREND_WINDOW_DAYS


def build_series[T](
    items: list[SeriesInput[T]],
    *,
    max_cloud: float | None,
    gap_threshold_days: int,
) -> Series[T]:
    """Sort ascending, apply the cloud filter, compute gaps, warnings and the summary.

    With ``max_cloud`` set, an observation whose cloud coverage is above it, or unknown,
    is excluded and counted in ``excluded_by_cloud``.
    """
    ordered = sorted(items, key=lambda i: i.acquired_on)
    if max_cloud is None:
        kept = ordered
    else:
        kept = [
            i for i in ordered if i.cloud_coverage is not None and i.cloud_coverage <= max_cloud
        ]
    excluded = len(ordered) - len(kept)

    points: list[SeriesPoint[T]] = []
    previous: date | None = None
    for item in kept:
        gap = None if previous is None else (item.acquired_on - previous).days
        points.append(SeriesPoint(item, gap))
        previous = item.acquired_on

    warnings: list[WarningCode] = []
    if len(kept) < 2:
        warnings.append(WarningCode.INSUFFICIENT_OBSERVATIONS)
        return Series(points, SeriesSummary(count=len(kept)), excluded, warnings)

    gaps = [p.gap_days_from_previous for p in points if p.gap_days_from_previous is not None]
    if any(gap > gap_threshold_days for gap in gaps):
        warnings.append(WarningCode.IRREGULAR_SAMPLING)

    values = [i.ndvi_mean for i in kept]
    first = kept[0].acquired_on
    days = [float((i.acquired_on - first).days) for i in kept]
    summary = SeriesSummary(
        count=len(kept),
        first_date=first,
        last_date=kept[-1].acquired_on,
        min=round4(min(values)),
        max=round4(max(values)),
        mean_of_means=round4(sum(values) / len(values)),
        trend_per_30d=round4(trend_slope_per_30d(days, values)),
    )
    return Series(points, summary, excluded, warnings)
