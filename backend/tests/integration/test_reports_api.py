"""Report endpoints against PostGIS (tasks 14.3 to 14.6)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest
import pytest_asyncio
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from sqlalchemy import func, select, text, update

from app.db.models.areas import Area
from app.db.models.audit import AuditEvent
from app.db.models.observations import Observation
from app.db.models.reports import Comparison, Report
from app.db.session import dispose_engine, get_sessionmaker, init_engine
from app.domain.constants import CAVEATS, LIMITATIONS, contains_forbidden_term
from tests.fixtures.reference import REFERENCE_NDVI_SERIES
from tests.integration.harness import (
    FakeAgro,
    auth,
    insert_area,
    insert_observation,
    make_app,
    obs_item,
    purge_tagged,
    set_setting,
)

HEALTH = HealthCheck.function_scoped_fixture


@dataclass
class Ctx:
    client: httpx.AsyncClient
    agro: FakeAgro
    tag: str
    area_id: uuid.UUID

    def user(self, name: str, *groups: str) -> dict[str, str]:
        return auth(f"{self.tag}-{name}", *(groups or ("researcher",)))

    async def create(self, headers: dict[str, str] | None = None, **body: Any) -> httpx.Response:
        payload = {
            "area_id": str(self.area_id),
            "source": "sentinel-2",
            "date_from": "2026-01-01",
            "date_to": "2026-04-30",
            **body,
        }
        return await self.client.post(
            "/api/v1/reports", json=payload, headers=headers or self.user("alice")
        )

    async def report_rows(self) -> int:
        async with get_sessionmaker()() as s:
            return int(
                await s.scalar(select(func.count()).where(Report.area_id == self.area_id)) or 0
            )


async def _purge_reports(area_id: uuid.UUID) -> None:
    async with get_sessionmaker()() as s:
        await s.execute(text("DELETE FROM reports WHERE area_id = :a"), {"a": area_id})
        await s.commit()


@pytest_asyncio.fixture
async def ctx(migrated_database_url: str) -> AsyncIterator[Ctx]:
    init_engine(migrated_database_url)
    tag = f"rep{uuid.uuid4().hex[:10]}"
    async with get_sessionmaker()() as s:
        area = await insert_area(s, f"{tag}-area")
        for point in REFERENCE_NDVI_SERIES:
            await insert_observation(
                s, area.id, "sentinel-2", point.observed_on,
                cloud=Decimal(str(point.cloud_coverage)), data=None,
                mean=Decimal(str(point.ndvi_mean)),
            )  # fmt: skip
        await insert_observation(s, area.id, "landsat-8", date(2026, 3, 6), mean=Decimal("0.1"))
        await s.commit()
        area_id = area.id
    agro = FakeAgro()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=make_app(agro)), base_url="http://test"
    ) as client:
        yield Ctx(client, agro, tag, area_id)
    await _purge_reports(area_id)
    await purge_tagged(tag)
    await dispose_engine()


# --- content -------------------------------------------------------------------------


async def test_create_report_content(ctx: Ctx) -> None:
    r = await ctx.create(
        title="  Prestea check ",
        comparisons=[{"date_a": "2026-03-06", "date_b": "2026-04-30"}],
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["title"] == "Prestea check"
    assert body["created_by"] == {"sub": f"{ctx.tag}-alice", "username": f"{ctx.tag}-alice"}
    assert body["created_at"].endswith("Z")
    assert body["area"]["id"] == str(ctx.area_id)
    assert body["area"]["name"] == f"{ctx.tag}-area"
    assert body["area"]["area_ha"] == 100.0
    assert body["area"]["geometry"]["type"] == "Polygon"
    assert body["period"] == {"from": "2026-01-01", "to": "2026-04-30"}
    assert body["source"] == "sentinel-2"
    assert [o["date"] for o in body["observations"]] == [
        p.observed_on.isoformat() for p in REFERENCE_NDVI_SERIES
    ]
    assert [o["ndvi_mean"] for o in body["observations"]] == [
        p.ndvi_mean for p in REFERENCE_NDVI_SERIES
    ]
    assert all(o["data_coverage_pct"] is None for o in body["observations"])
    assert all("level" in o["quality"] for o in body["observations"])
    assert body["summary"]["count"] == 8 and body["summary"]["mean_of_means"] == 0.6107
    (comparison,) = body["comparisons"]
    assert (comparison["ndvi_diff"], comparison["flag"]) == (0.1739, "flagged")
    assert comparison["spatial_analysis_available"] is False
    assert body["thresholds_applied"] == {
        "ndvi_diff": 0.1,
        "max_cloud": 20.0,
        "min_data_coverage": 80.0,
    }
    assert body["weather"] is None
    assert body["caveats"] == list(CAVEATS)
    assert body["limitations"] == list(LIMITATIONS)
    assert "IRREGULAR_SAMPLING" in [w["code"] for w in body["warnings"]]
    assert not contains_forbidden_term(r.text)

    fetched = await ctx.client.get(f"/api/v1/reports/{body['id']}", headers=ctx.user("alice"))
    assert fetched.status_code == 200
    assert fetched.json() == body
    async with get_sessionmaker()() as s:
        stored = (
            await s.scalars(select(Comparison).where(Comparison.report_id == uuid.UUID(body["id"])))
        ).all()
        events = (
            await s.scalars(select(AuditEvent).where(AuditEvent.target_id == body["id"]))
        ).all()
    assert len(stored) == 1 and stored[0].result["ndvi_diff"] == 0.1739
    assert [e.action for e in events] == ["report.create"]


async def test_default_title_and_identical_caveats(ctx: Ctx) -> None:
    first = (await ctx.create()).json()
    second = (await ctx.create(date_from="2026-03-01", headers=ctx.user("bob"))).json()
    assert first["title"] == f"{ctx.tag}-area: sentinel-2 NDVI, 2026-01-01 to 2026-04-30"
    assert first["caveats"] == second["caveats"] == list(CAVEATS)


async def test_sources_are_never_mixed(ctx: Ctx) -> None:
    body = (await ctx.create(source="landsat-8")).json()
    assert [o["ndvi_mean"] for o in body["observations"]] == [0.1]
    s2 = (await ctx.create()).json()
    assert 0.1 not in [o["ndvi_mean"] for o in s2["observations"]]


async def test_weather_disabled_in_report(ctx: Ctx) -> None:
    body = (await ctx.create(include_weather=True)).json()
    assert body["weather"] is None
    assert "WEATHER_DISABLED" in [w["code"] for w in body["warnings"]]


# --- validation ------------------------------------------------------------------


async def test_no_observations_stores_nothing(ctx: Ctx) -> None:
    r = await ctx.create(date_from="2025-01-01", date_to="2025-02-01")
    assert (r.status_code, r.json()["error"]["code"]) == (422, "NO_OBSERVATIONS")
    assert await ctx.report_rows() == 0


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"date_from": "2026-05-01", "date_to": "2026-04-30"}, "date_from"),
        ({"date_from": "2021-04-29", "date_to": "2026-04-30"}, "date_to"),
        ({"source": "modis"}, "source"),
        ({"area_id": "not-a-uuid"}, "area_id"),
        ({"date_from": "2026-02-30"}, "date_from"),
        ({"title": ""}, "title"),
        ({"title": "x" * 201}, "title"),
        ({"comparisons": [{"date_a": "2026-03-06", "date_b": "2026-03-06"}]}, "date_b"),
        ({"comparisons": [{"date_a": "2026-03-06", "date_b": "2026-04-30"}] * 11}, "comparisons"),
        ({"unknown": 1}, "unknown"),
    ],
)
async def test_invalid_requests_store_nothing(ctx: Ctx, body: dict[str, Any], field: str) -> None:
    r = await ctx.create(**body)
    assert r.status_code == 422, r.text
    assert field in [f["field"] for f in r.json()["error"]["details"].get("fields", [])]
    assert await ctx.report_rows() == 0


async def test_five_year_span_boundary(ctx: Ctx) -> None:
    ok = (date(2026, 4, 30) - timedelta(days=1825)).isoformat()
    assert (await ctx.create(date_from=ok)).status_code == 201


async def test_missing_area_and_comparison_date(ctx: Ctx) -> None:
    r = await ctx.create(area_id=str(uuid.uuid4()))
    assert r.status_code == 404
    r = await ctx.create(comparisons=[{"date_a": "2026-03-06", "date_b": "2026-03-07"}])
    assert r.status_code == 404
    assert r.json()["error"]["details"]["missing_dates"] == ["2026-03-07"]
    assert await ctx.report_rows() == 0


async def test_formats(ctx: Ctx) -> None:
    report_id = (await ctx.create()).json()["id"]
    base = f"/api/v1/reports/{report_id}"
    r = await ctx.client.get(f"{base}?format=pdf", headers=ctx.user("alice"))
    assert (r.status_code, r.json()["error"]["code"]) == (501, "NOT_IMPLEMENTED")
    r = await ctx.client.get(f"{base}?format=xml", headers=ctx.user("alice"))
    assert r.status_code == 422
    assert r.json()["error"]["details"]["fields"][0]["field"] == "format"
    assert (
        await ctx.client.get(f"{base}?format=json", headers=ctx.user("alice"))
    ).status_code == 200


# --- snapshot (Property 29 examples) ------------------------------------------------


async def test_snapshot_survives_refresh_edit_and_settings(ctx: Ctx) -> None:
    created = (
        await ctx.create(comparisons=[{"date_a": "2026-03-06", "date_b": "2026-04-30"}])
    ).json()
    url = f"/api/v1/reports/{created['id']}"

    ctx.agro.history["sentinel-2"] = [obs_item("sentinel-2", date(2026, 3, 6), mean=0.9)]
    async with get_sessionmaker()() as s:
        await s.execute(
            update(Area).where(Area.id == ctx.area_id).values(name=f"{ctx.tag}-renamed")
        )
        await s.execute(
            update(Observation)
            .where(Observation.area_id == ctx.area_id)
            .values(ndvi_mean=Decimal("0.0001"), geometry_status="stale_geometry")
        )
        await s.commit()
    await set_setting("ndvi_diff_threshold", "1.5")
    await set_setting("cloud_limit_pct", "1")
    try:
        refreshed = await ctx.client.post(
            f"/api/v1/areas/{ctx.area_id}/observations/refresh",
            json={"date_from": "2026-03-01", "date_to": "2026-03-31", "sources": ["sentinel-2"]},
            headers=ctx.user("alice"),
        )
        assert refreshed.status_code == 200
        after = (await ctx.client.get(url, headers=ctx.user("alice"))).json()
    finally:
        await set_setting("ndvi_diff_threshold", None)
        await set_setting("cloud_limit_pct", None)
    assert after == created


# --- visibility (Property 30 examples and property) --------------------------------


async def test_visibility(ctx: Ctx) -> None:
    alice = (await ctx.create()).json()["id"]
    bob = (await ctx.create(headers=ctx.user("bob"))).json()["id"]

    def ids(r: httpx.Response) -> set[str]:
        return {i["id"] for i in r.json()["items"]}

    scope = {"area_id": str(ctx.area_id)}
    mine = await ctx.client.get("/api/v1/reports", params=scope, headers=ctx.user("alice"))
    assert ids(mine) == {alice} and mine.json()["total"] == 1
    item = mine.json()["items"][0]
    assert (
        item["area_name"] == f"{ctx.tag}-area" and item["created_by"]["sub"] == f"{ctx.tag}-alice"
    )
    everyone = await ctx.client.get(
        "/api/v1/reports", params=scope, headers=ctx.user("root", "admin")
    )
    assert ids(everyone) == {alice, bob}
    only_bob = await ctx.client.get(
        "/api/v1/reports",
        params={**scope, "created_by": f"{ctx.tag}-bob"},
        headers=ctx.user("root", "admin"),
    )
    assert ids(only_bob) == {bob}
    r = await ctx.client.get(
        "/api/v1/reports", params={"created_by": f"{ctx.tag}-bob"}, headers=ctx.user("alice")
    )
    assert r.status_code == 422

    foreign = await ctx.client.get(f"/api/v1/reports/{bob}", headers=ctx.user("alice"))
    missing = await ctx.client.get(f"/api/v1/reports/{uuid.uuid4()}", headers=ctx.user("alice"))
    assert foreign.status_code == missing.status_code == 404

    def strip(r: httpx.Response) -> dict[str, Any]:
        return {k: v for k, v in r.json()["error"].items() if k != "request_id"}

    assert strip(foreign) == strip(missing)
    assert (
        await ctx.client.get(f"/api/v1/reports/{bob}", headers=ctx.user("root", "admin"))
    ).status_code == 200
    assert (
        await ctx.client.get("/api/v1/reports", headers=ctx.user("nobody", ""))
    ).status_code == 403


@settings(max_examples=15, deadline=None, suppress_health_check=[HEALTH])
@given(owners=st.lists(st.sampled_from(["u1", "u2", "u3"]), min_size=1, max_size=6))
async def test_visibility_property(ctx: Ctx, owners: list[str]) -> None:
    await _purge_reports(ctx.area_id)
    created: dict[str, set[str]] = {}
    for owner in owners:
        r = await ctx.create(date_from="2026-04-01", headers=ctx.user(owner))
        created.setdefault(owner, set()).add(r.json()["id"])
    scope: dict[str, str | int] = {"area_id": str(ctx.area_id), "limit": 200}
    for owner in ("u1", "u2", "u3"):
        r = await ctx.client.get("/api/v1/reports", params=scope, headers=ctx.user(owner))
        assert {i["id"] for i in r.json()["items"]} == created.get(owner, set())
    r = await ctx.client.get("/api/v1/reports", params=scope, headers=ctx.user("root", "admin"))
    assert {i["id"] for i in r.json()["items"]} == set().union(*created.values())
