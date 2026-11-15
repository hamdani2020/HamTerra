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
