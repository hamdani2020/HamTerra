"""Quality indicators (Requirements 8.12, 9.1 to 9.5). Pure functions.

Cloud coverage and data coverage stay separate values. A missing data coverage never
makes an observation ``poor`` by itself.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

from app.domain.constants import WarningCode

Level = Literal["good", "limited", "poor"]
_RANK: dict[Level, int] = {"good": 0, "limited": 1, "poor": 2}

GOOD_MAX_CLOUD = 10.0
GOOD_MIN_DATA = 90.0


@dataclass(frozen=True)
class QualityResult:
    level: Level
    cloud_coverage_pct: float | None
    data_coverage_pct: float | None
    warnings: tuple[WarningCode, ...] = field(default_factory=tuple)


def _valid_percent(value: float | None) -> bool:
    return value is not None and math.isfinite(value) and 0 <= value <= 100


def quality_level(
    cloud: float | None, data: float | None, cloud_limit: float, data_min: float
) -> Level:
    if cloud is None or not _valid_percent(cloud):
        return "poor"
    if cloud > cloud_limit or (data is not None and data < data_min):
        return "poor"
    if cloud <= GOOD_MAX_CLOUD and (data is None or data >= GOOD_MIN_DATA):
        return "good"
    return "limited"


def observation_quality(
    cloud: float | None, data: float | None, cloud_limit: float, data_min: float
) -> QualityResult:
    warnings: list[WarningCode] = []
    if not _valid_percent(cloud):
        warnings.append(WarningCode.INVALID_CLOUD_COVERAGE)
    if data is None:
        warnings.append(WarningCode.DATA_COVERAGE_UNKNOWN)
    return QualityResult(
        level=quality_level(cloud, data, cloud_limit, data_min),
        cloud_coverage_pct=cloud,
        data_coverage_pct=data,
        warnings=tuple(warnings),
    )


def comparison_quality(a: QualityResult, b: QualityResult) -> QualityResult:
    """The worse level, the larger cloud, the smaller non-null data coverage."""
    level = a.level if _RANK[a.level] >= _RANK[b.level] else b.level
    clouds = [c for c in (a.cloud_coverage_pct, b.cloud_coverage_pct) if c is not None]
    datas = [d for d in (a.data_coverage_pct, b.data_coverage_pct) if d is not None]
    warnings: list[WarningCode] = []
    for code in (*a.warnings, *b.warnings):
        if code not in warnings:
            warnings.append(code)
    if level == "poor" and WarningCode.LOW_QUALITY_OBSERVATION not in warnings:
        warnings.append(WarningCode.LOW_QUALITY_OBSERVATION)
    return QualityResult(
        level=level,
        cloud_coverage_pct=max(clouds) if clouds else None,
        data_coverage_pct=min(datas) if datas else None,
        warnings=tuple(warnings),
    )
