"""Allow-listed application settings and value validation (Requirements 8.8 to 8.11, 14.x).

Pure code. The same ``validate_value`` checks Admin updates and per-request threshold
overrides, so both follow one rule.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal

SettingType = Literal["integer", "decimal", "boolean"]
SettingValue = int | Decimal | bool


@dataclass(frozen=True)
class SettingDef:
    key: str
    type: SettingType
    default: str
    minimum: Decimal | None
    maximum: Decimal | None
    researcher_visible: bool


def _d(
    key: str, type_: SettingType, default: str, lo: str | None, hi: str | None, visible: bool
) -> SettingDef:
    low = Decimal(lo) if lo is not None else None
    high = Decimal(hi) if hi is not None else None
    return SettingDef(key, type_, default, low, high, visible)


# Order is the order returned by the API.
SETTING_DEFS: dict[str, SettingDef] = {
    d.key: d
    for d in (
        _d("ndvi_diff_threshold", "decimal", "0.10", "0.00", "2.00", True),
        _d("cloud_limit_pct", "decimal", "20", "0", "100", True),
        _d("data_coverage_min_pct", "decimal", "80", "0", "100", True),
        _d("gap_threshold_days", "integer", "30", "1", "3660", True),
        _d("weather_enabled", "boolean", "false", None, None, False),
        _d("default_page_size", "integer", "50", "1", "200", True),
    )
}

_SECRET_LIKE = re.compile(r"key|secret|password|token|credential", re.IGNORECASE)


class SettingKeyError(Exception):
    """``reason`` is ``key_not_permitted`` (secret-like) or ``unknown_key``."""

    def __init__(self, reason: Literal["key_not_permitted", "unknown_key"]) -> None:
        self.reason = reason
        super().__init__(reason)


class SettingValueError(ValueError):
    """``constraint`` is ``type``, ``minimum`` or ``maximum``."""

    def __init__(self, constraint: Literal["type", "minimum", "maximum"], detail: str) -> None:
        self.constraint = constraint
        self.detail = detail
        super().__init__(detail)


def is_secret_like(key: str) -> bool:
    return bool(_SECRET_LIKE.search(key))


def lookup(key: str) -> SettingDef:
    """The definition for ``key``. The secret-like check runs first (Requirement 14.6)."""
    if is_secret_like(key):
        raise SettingKeyError("key_not_permitted")
    definition = SETTING_DEFS.get(key)
    if definition is None:
        raise SettingKeyError("unknown_key")
    return definition


def validate_value(definition: SettingDef, value: Any) -> SettingValue:
    """Return the value as ``bool``, ``int`` or ``Decimal``, or raise ``SettingValueError``."""
    if definition.type == "boolean":
        if not isinstance(value, bool):
            raise SettingValueError("type", "a boolean is required")
        return value
    if isinstance(value, bool):
        raise SettingValueError("type", f"a {definition.type} number is required")
    if definition.type == "integer":
        if not isinstance(value, int):
            raise SettingValueError("type", "an integer is required")
        number = Decimal(value)
    else:
        if not isinstance(value, int | float):
            raise SettingValueError("type", "a number is required")
        if isinstance(value, float) and not math.isfinite(value):
            raise SettingValueError("type", "a finite number is required")
        number = Decimal(str(value))
    if definition.minimum is not None and number < definition.minimum:
        raise SettingValueError("minimum", f"must be at least {definition.minimum}")
    if definition.maximum is not None and number > definition.maximum:
        raise SettingValueError("maximum", f"must be at most {definition.maximum}")
    return int(number) if definition.type == "integer" else number


def parse_stored(definition: SettingDef, text: str) -> SettingValue:
    """Read a stored text value. Stored text is trusted but still range-checked."""
    if definition.type == "boolean":
        return text.strip().lower() == "true"
    if definition.type == "integer":
        return int(text)
    return Decimal(text)


def to_text(value: SettingValue) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, Decimal):
        return format(value, "f")
    return str(value)


def to_json(value: SettingValue) -> bool | int | float:
    if isinstance(value, bool | int):
        return value
    return float(value)
