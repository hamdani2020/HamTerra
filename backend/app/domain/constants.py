"""Stable identifiers and fixed texts shared across the backend (single source).

Warning codes are part of the API contract. The frontend maps each code to its own
display text; the messages here are the backend's plain-language defaults.
"""

from __future__ import annotations

from enum import StrEnum


class WarningCode(StrEnum):
    INSUFFICIENT_OBSERVATIONS = "INSUFFICIENT_OBSERVATIONS"
    IRREGULAR_SAMPLING = "IRREGULAR_SAMPLING"
    WEATHER_UNAVAILABLE = "WEATHER_UNAVAILABLE"
    WEATHER_DISABLED = "WEATHER_DISABLED"
    WEATHER_INVALID_DATA = "WEATHER_INVALID_DATA"
    LOW_QUALITY_OBSERVATION = "LOW_QUALITY_OBSERVATION"
    SEASONALITY_NOT_CONTROLLED = "SEASONALITY_NOT_CONTROLLED"
    PERCENT_DIFFERENCE_UNDEFINED = "PERCENT_DIFFERENCE_UNDEFINED"
    DATA_COVERAGE_UNKNOWN = "DATA_COVERAGE_UNKNOWN"
    INVALID_CLOUD_COVERAGE = "INVALID_CLOUD_COVERAGE"
    ITEMS_DISCARDED = "ITEMS_DISCARDED"
    UPSTREAM_ERROR = "UPSTREAM_ERROR"


WARNING_MESSAGES: dict[WarningCode, str] = {
    WarningCode.INSUFFICIENT_OBSERVATIONS: "Fewer than two observations are available.",
    WarningCode.IRREGULAR_SAMPLING: "The gap between some observations exceeds the gap threshold.",
    WarningCode.WEATHER_UNAVAILABLE: "Weather context could not be retrieved.",
    WarningCode.WEATHER_DISABLED: "Weather context is not enabled.",
    WarningCode.WEATHER_INVALID_DATA: "Some weather values were invalid and were left out.",
    WarningCode.LOW_QUALITY_OBSERVATION: (
        "At least one observation is outside the quality limits."
    ),
    WarningCode.SEASONALITY_NOT_CONTROLLED: (
        "The interval is not a whole number of years, so seasonal differences are not controlled."
    ),
    WarningCode.PERCENT_DIFFERENCE_UNDEFINED: (
        "The percentage difference is undefined because the earlier mean NDVI is 0."
    ),
    WarningCode.DATA_COVERAGE_UNKNOWN: "Data coverage was not reported by the provider.",
    WarningCode.INVALID_CLOUD_COVERAGE: "Cloud coverage is missing or outside 0 to 100.",
    WarningCode.ITEMS_DISCARDED: (
        "Some provider items were discarded because they were incomplete or invalid."
    ),
    WarningCode.UPSTREAM_ERROR: "The retrieval was incomplete because the provider failed.",
}

PREVIEW_NOTE = (
    "Preview images are low resolution (117 x 117 px in validated tests) "
    "and are for visual orientation only."
)

# Fixed limitations carried by every time series, comparison and report (Requirement 7.12).
LIMITATIONS: tuple[str, ...] = (
    "NDVI values are polygon-level aggregates. They say nothing about where inside the "
    "polygon a difference occurs.",
    "Seasonality is not removed. NDVI changes with the season, rainfall and acquisition "
    "conditions.",
    "Weather is not controlled. Weather values, when shown, are context only and do not "
    "establish causation.",
)

# Fixed caveats included unchanged in every report (Requirement 11.3).
CAVEATS: tuple[str, ...] = (
    "NDVI values are polygon-level aggregates. They do not show where inside the polygon "
    "a difference occurs.",
    "Seasonality, rainfall and acquisition conditions affect NDVI.",
    "Sentinel-2 and Landsat 8 are different sensors. Their values are not equivalent and are "
    "never combined.",
    "Cloud coverage and data coverage limit the reliability of each observation.",
    "Preview images are low resolution (117 x 117 px in validated tests) and are for visual "
    "orientation only.",
    "The platform does not determine the cause of any change.",
)

# Terms that must never appear in generated text (Requirements 8.15, 21.5). This list is
# the only place the backend spells them; tests import it instead of repeating them.
FORBIDDEN_TERMS: tuple[str, ...] = (
    "illegal mining",
    "illegal",
    "deforestation",
    "destruction",
    "destroyed",
    "recovery",
    "recovered",
)

# No raster source with a confirmed resolution is adopted (Requirement 21.2, design U3).
SPATIAL_ANALYSIS_AVAILABLE = False

WEATHER_NOTE = "Context only; correlation does not imply causation."


def contains_forbidden_term(text: str) -> bool:
    lowered = text.lower()
    return any(term in lowered for term in FORBIDDEN_TERMS)
