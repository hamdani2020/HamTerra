"""Domain objects to API response models. Shared by routers and the report snapshot."""

from __future__ import annotations

from typing import Any

from app.api.schemas.comparisons import ComparisonOut, ComparisonWeather, ThresholdsApplied
from app.api.schemas.observations import (
    NdviStatsOut,
    ObservationOut,
    PreviewOut,
    QualityOut,
    WarningOut,
)
from app.domain.constants import (
    LIMITATIONS,
    PREVIEW_NOTE,
    SPATIAL_ANALYSIS_AVAILABLE,
    WARNING_MESSAGES,
    WarningCode,
)
from app.domain.quality import QualityResult
from app.services.comparisons import ComparisonOutcome
from app.services.observations import ObservationView


def warnings_out(codes: list[WarningCode] | tuple[WarningCode, ...]) -> list[WarningOut]:
    return [WarningOut(code=c.value, message=WARNING_MESSAGES[c]) for c in codes]


def quality_out(quality: QualityResult) -> QualityOut:
    return QualityOut(
        level=quality.level,
        cloud_coverage_pct=quality.cloud_coverage_pct,
        data_coverage_pct=quality.data_coverage_pct,
        warnings=[WarningOut(code=w.value, message=WARNING_MESSAGES[w]) for w in quality.warnings],
    )


def observation_out(view: ObservationView) -> ObservationOut:
    obs = view.observation
    quality = view.quality

    def num(value: Any) -> float | None:
        return None if value is None else float(value)

    return ObservationOut(
        id=obs.id,
        area_id=obs.area_id,
        date=obs.acquired_on,
        source=obs.source,
        ndvi=NdviStatsOut(
            mean=float(obs.ndvi_mean),
            min=num(obs.ndvi_min),
            max=num(obs.ndvi_max),
            std=num(obs.ndvi_std),
            median=num(obs.ndvi_median),
        ),
        quality=quality_out(quality),
        preview=PreviewOut(
            url=f"/api/v1/observations/{obs.id}/preview" if obs.preview_ref else None,
            width_px=obs.preview_width_px,
            height_px=obs.preview_height_px,
            note=PREVIEW_NOTE,
        ),
        geometry_status=obs.geometry_status,
    )


def comparison_out(outcome: ComparisonOutcome) -> ComparisonOut:
    core = outcome.core
    weather = ComparisonWeather(**outcome.weather) if outcome.weather is not None else None
    return ComparisonOut(
        area_id=outcome.area_id,
        source=outcome.source,
        a=observation_out(outcome.a),
        b=observation_out(outcome.b),
        ndvi_diff=core.ndvi_diff,
        ndvi_diff_pct=core.ndvi_diff_pct,
        interval_days=core.interval_days,
        flag=core.flag,
        thresholds_applied=ThresholdsApplied(**outcome.thresholds.as_dict()),
        quality=quality_out(outcome.quality),
        spatial_analysis_available=SPATIAL_ANALYSIS_AVAILABLE,
        summary_text=core.summary_text,
        weather=weather,
        warnings=warnings_out(outcome.warnings),
        limitations=list(LIMITATIONS),
    )
