"""Properties 14 and 16 against PostGIS (each example runs in a rolled-back transaction)."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from sqlalchemy import select

from app.core.config import Settings
from app.core.security import Principal, Role
from app.db.models.observations import Observation
from app.integrations.agro.models import NdviStats, NormalizedObservation, Source
from app.services import observations as observation_service
from app.services import refresh as refresh_service
from app.services.observations import ObservationFilters
from tests.integration.harness import (
    FakeAgro,
    insert_area,
    insert_observation,
    obs_item,
    run_in_rolled_back_session,
)

BASE = date(2026, 1, 1)
SOURCES = ("sentinel-2", "landsat-8")
SETTINGS = settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
ACTOR = Principal(sub="prop-actor", username="prop", email=None, roles=frozenset({Role.admin}))


def q2(value: float | None) -> Decimal | None:
    return None if value is None else Decimal(repr(value)).quantize(Decimal("0.01"), ROUND_HALF_UP)


def day_or_none(filters: dict[str, Any], name: str) -> date | None:
    return BASE + timedelta(days=filters[name]) if name in filters else None


def q4(value: float) -> Decimal:
    return Decimal(repr(value)).quantize(Decimal("0.0001"), ROUND_HALF_UP)


def q4n(value: float | None) -> Decimal | None:
    return None if value is None else q4(value)


def stats_of(item: NormalizedObservation) -> NdviStats:
    if item.ndvi is None:
        raise AssertionError("history items carry statistics")
    return item.ndvi


def stored_cloud(item: NormalizedObservation, *, changed: bool) -> Decimal | None:
    """The stored cloud value: equal to the provider value, or a different one."""
    value = q2(item.cloud_coverage)
    if not changed:
        return value
    return Decimal("0.00") if value == Decimal("99.99") else Decimal("99.99")


# --- Property 14 ------------------------------------------------------------------

item_values = st.tuples(
    st.floats(0, 100),  # cloud
    st.one_of(st.none(), st.floats(0, 100)),  # data coverage
    st.floats(-1, 1),  # mean NDVI
    st.one_of(st.none(), st.just("https://api.example.test/img/1")),  # preview
)
batch_strategy = st.dictionaries(
    st.tuples(st.sampled_from(SOURCES), st.integers(0, 12)), item_values, max_size=10
)
state_choice = st.sampled_from(["absent", "same", "changed", "stale"])


def to_item(key: tuple[str, int], values: tuple[Any, ...]) -> NormalizedObservation:
    source, offset = key
    cloud, data, mean, preview = values
    sensor: Source = "sentinel-2" if source == "sentinel-2" else "landsat-8"
    return obs_item(
        sensor,
        BASE + timedelta(days=offset),
        cloud=cloud,
        data=data,
        mean=mean,
        preview=preview,
    )


async def stored_rows(session: Any, area_id: uuid.UUID) -> dict[tuple[str, date], tuple[Any, ...]]:
    rows = (await session.scalars(select(Observation).where(Observation.area_id == area_id))).all()
    return {
        (o.source, o.acquired_on): (
            o.cloud_coverage,
            o.data_coverage,
            o.ndvi_mean,
            o.preview_ref,
            o.geometry_status,
        )
        for o in rows
    }


@SETTINGS
@given(batch=batch_strategy, states=st.lists(state_choice, min_size=10, max_size=10))
def test_refresh_counts_and_idempotence(
    migrated_database_url: str, batch: dict[Any, Any], states: list[str]
) -> None:
    items = [to_item(k, v) for k, v in batch.items()]

    async def work(session: Any) -> None:
        area = await insert_area(session, f"prop-{uuid.uuid4().hex[:8]}")
        expected_new = expected_updated = 0
        for index, item in enumerate(items):
            state = states[index % len(states)]
            if state == "absent":
                expected_new += 1
                continue
            await insert_observation(
                session,
                area.id,
                item.source,
                item.acquired_on,
                cloud=stored_cloud(item, changed=state == "changed"),
                data=q2(item.data_coverage),
                mean=q4(stats_of(item).mean),
                stats=(
                    q4n(stats_of(item).min),
                    q4n(stats_of(item).max),
                    q4n(stats_of(item).std),
                    q4n(stats_of(item).median),
                ),
                preview_ref=item.preview_ref,
                geometry_status="stale_geometry" if state == "stale" else "current",
            )
            if state in ("changed", "stale"):
                expected_updated += 1
        await session.commit()

        agro = FakeAgro()
        for source in SOURCES:
            agro.history[source] = [i for i in items if i.source == source]
        end = BASE + timedelta(days=30)
        run = {
            "session": session,
            "agro": agro,
            "settings": Settings(),
            "actor": ACTOR,
            "area_id": area.id,
        }
        first = await refresh_service.refresh_area(
            **run,
            date_from=BASE,
            date_to=end,
            today=end,
        )
        assert min(first.new, first.updated, first.skipped) >= 0
        assert first.new + first.updated + first.skipped == len(items)
        assert (first.new, first.updated) == (expected_new, expected_updated)
        after_first = await stored_rows(session, area.id)

        second = await refresh_service.refresh_area(
            **run,
            date_from=BASE,
            date_to=end,
            today=end,
        )
        assert (second.new, second.updated) == (0, 0)
        assert second.skipped == len(items)
        assert await stored_rows(session, area.id) == after_first
        for item in items:
            row = after_first[(item.source, item.acquired_on)]
            assert row[0] == q2(item.cloud_coverage)
            assert row[1] == q2(item.data_coverage)
            assert row[2] == q4(stats_of(item).mean)
            assert row[4] == "current"

    run_in_rolled_back_session(migrated_database_url, work)


# --- Property 16 ------------------------------------------------------------------

stored_obs = st.tuples(
    st.sampled_from(SOURCES),
    st.integers(0, 20),
    st.one_of(st.none(), st.integers(0, 100)),
    st.one_of(st.none(), st.integers(0, 100)),
)
filters_strategy = st.fixed_dictionaries(
    {},
    optional={
        "source": st.sampled_from(SOURCES),
        "date_from": st.integers(0, 20),
        "date_to": st.integers(0, 20),
        "max_cloud_coverage": st.integers(0, 100),
        "min_data_coverage": st.integers(0, 100),
    },
)


@SETTINGS
@given(
    rows=st.lists(stored_obs, max_size=15, unique_by=lambda r: (r[0], r[1])),
    filters=filters_strategy,
)
def test_list_returns_exactly_the_matching_observations(
    migrated_database_url: str, rows: list[Any], filters: dict[str, Any]
) -> None:
    async def work(session: Any) -> None:
        area = await insert_area(session, f"prop-{uuid.uuid4().hex[:8]}")
        for source, offset, cloud, data in rows:
            await insert_observation(
                session,
                area.id,
                source,
                BASE + timedelta(days=offset),
                cloud=None if cloud is None else Decimal(cloud),
                data=None if data is None else Decimal(data),
            )
        spec = ObservationFilters(
            source=filters.get("source"),
            date_from=BASE + timedelta(days=filters["date_from"])
            if "date_from" in filters
            else None,
            date_to=day_or_none(filters, "date_to"),
            max_cloud_coverage=filters.get("max_cloud_coverage"),
            min_data_coverage=filters.get("min_data_coverage"),
        )

        def matches(row: Any) -> bool:
            source, offset, cloud, data = row
            day = BASE + timedelta(days=offset)
            return (
                (spec.source is None or source == spec.source)
                and (spec.date_from is None or day >= spec.date_from)
                and (spec.date_to is None or day <= spec.date_to)
                and (
                    spec.max_cloud_coverage is None
                    or (cloud is not None and cloud <= spec.max_cloud_coverage)
                )
                and (
                    spec.min_data_coverage is None
                    or (data is not None and data >= spec.min_data_coverage)
                )
            )

        expected = {(r[0], BASE + timedelta(days=r[1])) for r in rows if matches(r)}
        listing = await observation_service.list_observations(
            session, area.id, spec, limit=200, offset=0
        )
        got = [(v.observation.source, v.observation.acquired_on) for v in listing.views]
        assert set(got) == expected and len(got) == len(expected)
        assert listing.total == len(expected)
        dates = [d for _, d in got]
        assert dates == sorted(dates, reverse=True)
        assert sum(listing.counts_by_source.values()) == len(expected)
        for source in SOURCES:
            assert listing.counts_by_source.get(source, 0) == sum(
                1 for s, _ in expected if s == source
            )

    run_in_rolled_back_session(migrated_database_url, work)
