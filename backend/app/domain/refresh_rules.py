"""Date-range rules for a refresh (Requirement 6.2). Pure."""

from __future__ import annotations

from datetime import date

DEFAULT_MAX_RANGE_DAYS = 366


def refresh_range_problems(
    start: date, end: date, today: date, max_days: int = DEFAULT_MAX_RANGE_DAYS
) -> list[tuple[str, str]]:
    """Return ``(field, reason)`` for each violated rule. Empty means the range is valid.

    The span counts both end dates, so a range of exactly ``max_days`` days is accepted.
    """
    problems: list[tuple[str, str]] = []
    if start > end:
        problems.append(("date_from", "date_from must not be after date_to"))
        return problems
    if end > today:
        problems.append(("date_to", "date_to must not be in the future"))
    if (end - start).days + 1 > max_days:
        problems.append(("date_to", f"the range must not be longer than {max_days} days"))
    return problems
