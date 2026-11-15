"""Property 18: quality level and comparison quality."""

from __future__ import annotations

import math

from hypothesis import given
from hypothesis import strategies as st

from app.domain.constants import WarningCode
from app.domain.quality import comparison_quality, observation_quality, quality_level

cloud_values = st.one_of(
    st.none(),
    st.floats(0, 100),
    st.sampled_from([-0.01, 100.01, 150.0, float("nan"), float("inf"), -5.0]),
)
data_values = st.one_of(st.none(), st.floats(0, 100))
limits = st.floats(0, 100)


def _valid(cloud: float | None) -> bool:
    return cloud is not None and math.isfinite(cloud) and 0 <= cloud <= 100


@given(cloud=cloud_values, data=data_values, cloud_limit=limits, data_min=limits)
def test_level_follows_the_rules(
    cloud: float | None, data: float | None, cloud_limit: float, data_min: float
) -> None:
    level = quality_level(cloud, data, cloud_limit, data_min)
    if not _valid(cloud) or cloud > cloud_limit or (data is not None and data < data_min):  # type: ignore[operator]
        assert level == "poor"
    elif cloud <= 10 and (data is None or data >= 90):  # type: ignore[operator]
        assert level == "good"
    else:
        assert level == "limited"


@given(cloud=st.floats(0, 100), cloud_limit=limits, data_min=limits)
def test_missing_data_coverage_never_makes_poor_by_itself(
    cloud: float, cloud_limit: float, data_min: float
) -> None:
    result = observation_quality(cloud, None, cloud_limit, data_min)
    assert WarningCode.DATA_COVERAGE_UNKNOWN in result.warnings
    assert (result.level == "poor") == (cloud > cloud_limit)
    assert result.data_coverage_pct is None


@given(cloud=cloud_values, data=data_values, cloud_limit=limits, data_min=limits)
def test_warnings_for_invalid_cloud_and_unknown_data(
    cloud: float | None, data: float | None, cloud_limit: float, data_min: float
) -> None:
    result = observation_quality(cloud, data, cloud_limit, data_min)
    assert (WarningCode.INVALID_CLOUD_COVERAGE in result.warnings) == (not _valid(cloud))
    assert (WarningCode.DATA_COVERAGE_UNKNOWN in result.warnings) == (data is None)
    assert result.cloud_coverage_pct == cloud or (cloud is not None and math.isnan(cloud))
    assert result.data_coverage_pct == data


@given(
    a=st.tuples(cloud_values, data_values),
    b=st.tuples(cloud_values, data_values),
    cloud_limit=limits,
    data_min=limits,
)
def test_comparison_quality(
    a: tuple[float | None, float | None],
    b: tuple[float | None, float | None],
    cloud_limit: float,
    data_min: float,
) -> None:
    qa = observation_quality(*a, cloud_limit, data_min)
    qb = observation_quality(*b, cloud_limit, data_min)
    result = comparison_quality(qa, qb)
    either_poor = "poor" in (qa.level, qb.level)
    assert (result.level == "poor") == either_poor
    assert (WarningCode.LOW_QUALITY_OBSERVATION in result.warnings) == either_poor
    order = ["good", "limited", "poor"]
    assert order.index(result.level) == max(order.index(qa.level), order.index(qb.level))
    clouds = [c for c in (qa.cloud_coverage_pct, qb.cloud_coverage_pct) if c is not None]
    datas = [d for d in (qa.data_coverage_pct, qb.data_coverage_pct) if d is not None]
    if clouds and not any(math.isnan(c) for c in clouds):
        assert result.cloud_coverage_pct == max(clouds)
    assert result.data_coverage_pct == (min(datas) if datas else None)


def test_boundaries() -> None:
    assert quality_level(10, 90, 20, 80) == "good"
    assert quality_level(10.01, 90, 20, 80) == "limited"
    assert quality_level(10, 89.99, 20, 80) == "limited"
    assert quality_level(20, 80, 20, 80) == "limited"
    assert quality_level(20.01, 95, 20, 80) == "poor"
    assert quality_level(5, 79.99, 20, 80) == "poor"
    assert quality_level(5, None, 20, 80) == "good"
