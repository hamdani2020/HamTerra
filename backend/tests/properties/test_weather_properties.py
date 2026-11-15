"""Property 28: weather normalisation."""

from __future__ import annotations

import math
from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.integrations.weather.normalize import (
    KELVIN_OFFSET,
    kelvin_to_celsius,
    normalize_record,
    normalize_records,
)

junk = st.one_of(
    st.none(),
    st.booleans(),
    st.text(max_size=4),
    st.lists(st.integers(), max_size=2),
    st.sampled_from([float("nan"), float("inf"), -1.0]),
)
number = st.floats(0, 400)
records = st.fixed_dictionaries(
    {"dt": st.one_of(st.integers(1_700_000_000, 1_800_000_000), junk)},
    optional={
        "main": st.one_of(
            st.fixed_dictionaries({}, optional={"temp": st.one_of(number, junk)}), junk
        ),
        "wind": st.one_of(
            st.fixed_dictionaries({}, optional={"speed": st.one_of(number, junk)}), junk
        ),
        "rain": st.one_of(
            st.fixed_dictionaries({}, optional={"1h": st.one_of(number, junk)}), junk
        ),
    },
)


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        return None
    return float(value)


@given(raw=records)
def test_values_have_units_and_invalid_ones_are_discarded(raw: dict[str, Any]) -> None:
    record, discarded = normalize_record(raw)
    if not isinstance(raw["dt"], int) or isinstance(raw["dt"], bool):
        assert record is None and discarded == 1
        return
    assert record is not None
    main = raw.get("main")
    kelvin = _num(main.get("temp")) if isinstance(main, dict) else None
    if kelvin is not None and kelvin >= 0:
        assert record.temperature_c == pytest.approx(kelvin - KELVIN_OFFSET)
    else:
        assert record.temperature_c is None
    wind = raw.get("wind")
    speed = _num(wind.get("speed")) if isinstance(wind, dict) else None
    assert record.wind_speed_ms == (speed if speed is not None and speed >= 0 else None)
    expected_discarded = (record.temperature_c is None) + (record.wind_speed_ms is None)
    if "rain" in raw:
        rain = raw["rain"]
        mm = _num(rain.get("1h")) if isinstance(rain, dict) else None
        ok = mm is not None and mm >= 0
        assert record.precipitation_mm == (mm if ok else None)
        expected_discarded += not ok
    else:
        assert record.precipitation_mm is None
    assert discarded == expected_discarded


@given(items=st.lists(records, max_size=10))
def test_batch_keeps_valid_records(items: list[dict[str, Any]]) -> None:
    batch = normalize_records(items)
    singles = [normalize_record(i) for i in items]
    assert batch.records == [r for r, _ in singles if r is not None]
    assert batch.discarded_values == sum(d for _, d in singles)


def test_kelvin_conversion() -> None:
    assert kelvin_to_celsius(273.15) == 0
    assert kelvin_to_celsius(300.15) == pytest.approx(27.0)
