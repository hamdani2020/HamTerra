"""Properties 19, 20 and 21: series selection, gaps, summary and trend."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, timedelta

import numpy as np
from hypothesis import assume, given
from hypothesis import strategies as st

from app.domain.constants import WarningCode
from app.domain.timeseries import SeriesInput, build_series, round4

BASE = date(2026, 1, 1)

observations = st.lists(
    st.tuples(
        st.integers(0, 400),  # day offset
        st.floats(-1, 1),  # mean NDVI
        st.one_of(st.none(), st.floats(0, 100)),  # cloud
    ),
    max_size=25,
    unique_by=lambda t: t[0],
)


def inputs(rows: Sequence[tuple[int, float, float | None]]) -> list[SeriesInput[int]]:
    return [
        SeriesInput(BASE + timedelta(days=d), mean, cloud, ref=index)
        for index, (d, mean, cloud) in enumerate(rows)
    ]


# --- Property 19 -----------------------------------------------------------------


@given(rows=observations, max_cloud=st.one_of(st.none(), st.floats(0, 100)))
def test_selection_and_ordering(
    rows: list[tuple[int, float, float | None]], max_cloud: float | None
) -> None:
    series = build_series(inputs(rows), max_cloud=max_cloud, gap_threshold_days=30)
    expected = sorted(
        (
            d
            for d, _, cloud in rows
            if max_cloud is None or (cloud is not None and cloud <= max_cloud)
        )
    )
    got = [(p.item.acquired_on - BASE).days for p in series.points]
    assert got == expected
    assert series.excluded_by_cloud == len(rows) - len(expected)
    assert series.summary.count == len(expected)


# --- Property 20 -----------------------------------------------------------------


@given(rows=observations, threshold=st.integers(1, 120))
def test_gaps_and_irregular_sampling(
    rows: list[tuple[int, float, float | None]], threshold: int
) -> None:
    series = build_series(inputs(rows), max_cloud=None, gap_threshold_days=threshold)
    if not series.points:
        return
    assert series.points[0].gap_days_from_previous is None
    gaps = []
    for previous, current in zip(series.points, series.points[1:], strict=False):
        gap = (current.item.acquired_on - previous.item.acquired_on).days
        assert current.gap_days_from_previous == gap
        gaps.append(gap)
    if len(series.points) >= 2:
        irregular = WarningCode.IRREGULAR_SAMPLING in series.warnings
        assert irregular == any(g > threshold for g in gaps)


def test_gap_boundary_30_versus_31() -> None:
    def warned(gap: int) -> bool:
        items = inputs([(0, 0.5, 1.0), (gap, 0.6, 1.0)])
        return (
            WarningCode.IRREGULAR_SAMPLING
            in build_series(items, max_cloud=None, gap_threshold_days=30).warnings
        )

    assert not warned(30)
    assert warned(31)


# --- Property 21 -----------------------------------------------------------------


@given(rows=observations)
def test_summary_shape(rows: list[tuple[int, float, float | None]]) -> None:
    series = build_series(inputs(rows), max_cloud=None, gap_threshold_days=30)
    s = series.summary
    if len(rows) < 2:
        assert WarningCode.INSUFFICIENT_OBSERVATIONS in series.warnings
        assert (s.first_date, s.last_date, s.min, s.max, s.mean_of_means, s.trend_per_30d) == (
            None, None, None, None, None, None,
        )  # fmt: skip
        return
    assert WarningCode.INSUFFICIENT_OBSERVATIONS not in series.warnings
    assert s.min is not None and s.max is not None and s.mean_of_means is not None
    assert s.min <= s.mean_of_means <= s.max
    assert s.first_date == series.points[0].item.acquired_on
    assert s.last_date == series.points[-1].item.acquired_on
    for value in (s.min, s.max, s.mean_of_means, s.trend_per_30d):
        assert value == round4(value)  # type: ignore[arg-type]


@given(
    days=st.lists(st.integers(0, 365), min_size=2, max_size=20, unique=True),
    intercept=st.floats(-0.5, 0.5),
    slope=st.floats(-0.001, 0.001),
)
def test_trend_of_a_line_is_30_times_its_slope(
    days: list[int], intercept: float, slope: float
) -> None:
    rows = [(d, intercept + slope * d, 0.0) for d in days]
    series = build_series(inputs(rows), max_cloud=None, gap_threshold_days=400)
    assert series.summary.trend_per_30d is not None
    assert abs(series.summary.trend_per_30d - 30 * slope) <= 0.00005 + 1e-9


@given(
    rows=st.lists(
        st.tuples(st.integers(0, 365), st.floats(-0.4, 0.4)),
        min_size=2,
        max_size=15,
        unique_by=lambda t: t[0],
    ),
    shift=st.floats(-0.5, 0.5),
    k=st.floats(-2, 2),
)
def test_trend_shift_and_scale(rows: list[tuple[int, float]], shift: float, k: float) -> None:
    from app.domain.timeseries import trend_slope_per_30d

    days = [float(d) for d, _ in rows]
    values = [v for _, v in rows]
    assume(len(set(days)) >= 2)
    base = trend_slope_per_30d(days, values)
    assert abs(trend_slope_per_30d(days, [v + shift for v in values]) - base) < 1e-9
    assert abs(trend_slope_per_30d(days, [v * k for v in values]) - k * base) < 1e-9
    assert abs(base - np.polyfit(days, values, 1)[0] * 30) < 1e-9
