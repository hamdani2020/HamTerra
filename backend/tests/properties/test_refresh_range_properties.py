"""Property 15: refresh range validation (pure rule)."""

from __future__ import annotations

from datetime import date, timedelta

from hypothesis import given
from hypothesis import strategies as st

from app.domain.refresh_rules import refresh_range_problems

TODAY = date(2026, 6, 1)
days = st.dates(min_value=date(2024, 1, 1), max_value=date(2027, 12, 31))


@given(start=days, end=days, max_days=st.integers(1, 800))
def test_accepted_iff_all_rules_hold(start: date, end: date, max_days: int) -> None:
    problems = refresh_range_problems(start, end, TODAY, max_days)
    expected = start <= end and (end - start).days + 1 <= max_days and end <= TODAY
    assert (problems == []) is expected


@given(start=days, max_days=st.integers(1, 800))
def test_span_boundary_is_inclusive(start: date, max_days: int) -> None:
    exact = start + timedelta(days=max_days - 1)
    over = exact + timedelta(days=1)
    today = over + timedelta(days=1)
    assert refresh_range_problems(start, exact, today, max_days) == []
    assert refresh_range_problems(start, over, today, max_days) != []


def test_problems_name_the_field() -> None:
    assert refresh_range_problems(date(2026, 2, 2), date(2026, 2, 1), TODAY)[0][0] == "date_from"
    assert refresh_range_problems(date(2026, 5, 1), date(2026, 6, 2), TODAY)[0][0] == "date_to"
