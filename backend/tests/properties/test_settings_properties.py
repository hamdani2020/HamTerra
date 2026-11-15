"""Property 27: settings and override validation (pure part)."""

from __future__ import annotations

import math
from typing import Any

from hypothesis import given
from hypothesis import strategies as st

from app.domain.app_settings import (
    SETTING_DEFS,
    SettingKeyError,
    SettingValueError,
    lookup,
    validate_value,
)

# The allow-list from the design, written out independently of the code under test.
TABLE: dict[str, tuple[str, float | None, float | None]] = {
    "ndvi_diff_threshold": ("decimal", 0.0, 2.0),
    "cloud_limit_pct": ("decimal", 0.0, 100.0),
    "data_coverage_min_pct": ("decimal", 0.0, 100.0),
    "gap_threshold_days": ("integer", 1, 3660),
    "weather_enabled": ("boolean", None, None),
    "default_page_size": ("integer", 1, 200),
}

keys = st.one_of(
    st.sampled_from(sorted(TABLE)),
    st.sampled_from(
        ["agro_api_key", "API_KEY", "db_password", "Secret", "auth_token", "credentials"]
    ),
    st.sampled_from(["unknown", "", "ndvi", "cloud_limit_pct ", "CLOUD_LIMIT_PCT"]),
    st.text(max_size=12),
)
values = st.one_of(
    st.none(),
    st.booleans(),
    st.integers(-10, 4000),
    st.floats(-5, 300),
    st.sampled_from([float("nan"), float("inf"), float("-inf")]),
    st.text(max_size=4),
    st.lists(st.integers(), max_size=2),
)


def _oracle(key: str, value: Any) -> bool:
    lowered = key.lower()
    if any(word in lowered for word in ("key", "secret", "password", "token", "credential")):
        return False
    if key not in TABLE:
        return False
    kind, low, high = TABLE[key]
    if kind == "boolean":
        return isinstance(value, bool)
    if isinstance(value, bool):
        return False
    if kind == "integer":
        ok_type = isinstance(value, int)
    else:
        ok_type = isinstance(value, int | float) and math.isfinite(value)
    return bool(ok_type and low is not None and high is not None and low <= value <= high)


@given(key=keys, value=values)
def test_accepted_iff_key_allowed_and_value_valid(key: str, value: Any) -> None:
    try:
        validate_value(lookup(key), value)
        accepted = True
    except (SettingKeyError, SettingValueError):
        accepted = False
    assert accepted is _oracle(key, value)


@given(key=st.sampled_from(sorted(TABLE)))
def test_bounds_are_inclusive(key: str) -> None:
    definition = SETTING_DEFS[key]
    if definition.type == "boolean":
        return
    assert definition.minimum is not None and definition.maximum is not None
    for bound in (definition.minimum, definition.maximum):
        value: Any = int(bound) if definition.type == "integer" else float(bound)
        assert validate_value(definition, value) == bound


@given(
    key=st.sampled_from(
        ["agro_api_key", "weather_api_key", "db_password", "client_secret", "x_TOKEN"]
    )
)
def test_secret_like_keys_are_not_permitted_even_if_unknown(key: str) -> None:
    try:
        lookup(key)
    except SettingKeyError as exc:
        assert exc.reason == "key_not_permitted"
    else:
        raise AssertionError("secret-like key was accepted")


def test_definitions_match_the_migration_seed() -> None:
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "0005_settings_audit.py"
    spec = importlib.util.spec_from_file_location("seed_0005", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    seeded = {key: (kind, default, lo, hi) for key, kind, default, lo, hi in module.SEED_SETTINGS}
    defined = {
        d.key: (
            d.type,
            d.default,
            None if d.minimum is None else str(d.minimum),
            None if d.maximum is None else str(d.maximum),
        )
        for d in SETTING_DEFS.values()
    }
    assert defined == seeded
