"""Properties 22 to 26 for the comparison domain (pure)."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.domain.comparison import (
    CrossSensorError,
    EqualDatesError,
    ObsStats,
    compare,
    is_flagged,
    seasonality_not_controlled,
)
from app.domain.constants import (
    FORBIDDEN_TERMS,
    SPATIAL_ANALYSIS_AVAILABLE,
    WarningCode,
    contains_forbidden_term,
)

BASE = date(2020, 1, 1)
# Stored means have 4 decimals (numeric(7,4)), so generate exactly those values.
means = st.integers(-10000, 10000).map(lambda n: n / 10000)
thresholds = st.integers(0, 200).map(lambda n: n / 100)
offsets = st.integers(0, 3000)
sources = st.sampled_from(["sentinel-2", "landsat-8"])


def obs(source: str, offset: int, mean: float) -> ObsStats:
    return ObsStats(source, BASE + timedelta(days=offset), mean)


# --- Property 22 -----------------------------------------------------------------


@settings(max_examples=200)
@given(
    source=sources,
    da=offsets,
    db=offsets,
    ma=means,
    mb=means,
    t=thresholds,
)
def test_arithmetic_symmetry_and_determinism(
    source: str, da: int, db: int, ma: float, mb: float, t: float
) -> None:
    if da == db:
        return
    a, b = obs(source, da, ma), obs(source, db, mb)
    ab = compare(a, b, t)
    ba = compare(b, a, t)
    exact = Decimal(repr(mb)) - Decimal(repr(ma))
    assert ab.ndvi_diff == float(exact.quantize(Decimal("0.0001"), ROUND_HALF_UP))
    assert ab.ndvi_diff == -ba.ndvi_diff
    assert ab.interval_days == ba.interval_days == abs(db - da)
    assert ab.flag == ba.flag
    if ma == 0:
        assert ab.ndvi_diff_pct is None
        assert WarningCode.PERCENT_DIFFERENCE_UNDEFINED in ab.warnings
    else:
        expected = (exact / abs(Decimal(repr(ma))) * 100).quantize(Decimal("0.01"), ROUND_HALF_UP)
        assert ab.ndvi_diff_pct == float(expected)
        assert WarningCode.PERCENT_DIFFERENCE_UNDEFINED not in ab.warnings
    assert compare(a, b, t) == ab  # determinism


# --- Property 23 -----------------------------------------------------------------


@given(ma=means, mb=means, t=thresholds)
def test_flag_iff_absolute_difference_at_least_threshold(ma: float, mb: float, t: float) -> None:
    expected = abs(Decimal(repr(mb)) - Decimal(repr(ma))) >= Decimal(repr(t))
    assert is_flagged(ma, mb, t) is expected
    result = compare(obs("sentinel-2", 0, ma), obs("sentinel-2", 10, mb), t)
    assert (result.flag == "flagged") is expected


def test_flag_boundary_is_inclusive() -> None:
    assert compare(obs("sentinel-2", 0, 0.5), obs("sentinel-2", 5, 0.6), 0.1).flag == "flagged"
    assert (
        compare(obs("sentinel-2", 0, 0.5), obs("sentinel-2", 5, 0.5999), 0.1).flag == "not_flagged"
    )


# --- Property 24 -----------------------------------------------------------------


@given(interval=st.integers(1, 5000))
def test_seasonality_rule(interval: int) -> None:
    near_a_year = any(abs(interval - 365 * k) <= 15 for k in range(1, 20))
    assert seasonality_not_controlled(interval) is (not near_a_year)


@pytest.mark.parametrize(
    ("interval", "warns"),
    [(349, True), (350, False), (365, False), (380, False), (381, True), (715, False), (55, True)],
)
def test_seasonality_examples(interval: int, warns: bool) -> None:
    assert seasonality_not_controlled(interval) is warns


# --- Property 25 (domain part) --------------------------------------------------


@given(da=offsets, db=offsets, ma=means, mb=means)
def test_cross_sensor_is_refused(da: int, db: int, ma: float, mb: float) -> None:
    with pytest.raises(CrossSensorError):
        compare(obs("sentinel-2", da, ma), obs("landsat-8", db, mb), 0.1)


@given(d=offsets, ma=means, mb=means, source=sources)
def test_equal_dates_are_refused(d: int, ma: float, mb: float, source: str) -> None:
    with pytest.raises(EqualDatesError):
        compare(obs(source, d, ma), obs(source, d, mb), 0.1)


# --- Property 26 -----------------------------------------------------------------


@given(da=offsets, db=offsets, ma=means, mb=means, t=thresholds)
def test_neutral_wording_and_no_spatial_claim(
    da: int, db: int, ma: float, mb: float, t: float
) -> None:
    if da == db:
        return
    text = compare(obs("sentinel-2", da, ma), obs("sentinel-2", db, mb), t).summary_text
    assert not contains_forbidden_term(text)
    assert "polygon-level aggregate" in text
    assert "no spatial change is inferred" in text
    assert "cause of any change is not identified" in text
    assert SPATIAL_ANALYSIS_AVAILABLE is False


def test_flagged_text_uses_the_neutral_phrase() -> None:
    text = compare(obs("sentinel-2", 0, 0.2), obs("sentinel-2", 30, 0.8), 0.1).summary_text
    assert text.lower().startswith("difference flagged for investigation")


def test_forbidden_term_detection() -> None:
    for term in FORBIDDEN_TERMS:
        assert contains_forbidden_term(f"x {term.upper()} y")
    assert not contains_forbidden_term("difference flagged for investigation")
