"""Observation, refresh and preview proxy endpoints against PostGIS (task 10.10)."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select, text, update

from app.core.config import Settings
from app.db.models.areas import Area
from app.db.models.audit import AuditEvent
from app.db.models.observations import Observation
from app.db.models.retrievals import RetrievalRecord
from app.db.session import dispose_engine, get_sessionmaker, init_engine
from app.integrations.agro.errors import AgroClientError, AgroTimeoutError, AgroUpstreamError
from app.integrations.agro.models import DiscardedItem
from app.services import refresh as refresh_service
from tests.integration.harness import (
    FakeAgro,
    auth,
    insert_area,
    insert_observation,
    make_app,
    obs_item,
    purge_tagged,
)

# The provider key the app is configured with (a dummy value in tests).
PROVIDER_KEY = Settings().agro_api_key.get_secret_value()
TODAY = datetime.now(UTC).date()
D1 = TODAY - timedelta(days=60)
D2 = TODAY - timedelta(days=30)


@dataclass
class Ctx:
    client: httpx.AsyncClient
    agro: FakeAgro
    tag: str
    area_id: uuid.UUID

    @property
    def sub(self) -> str:
        return f"{self.tag}-user"

    def h(self, *groups: str) -> dict[str, str]:
        return auth(self.sub, *(groups or ("researcher",)))

    async def refresh(self, **body: Any) -> httpx.Response:
        payload = {"date_from": D1.isoformat(), "date_to": TODAY.isoformat(), **body}
        return await self.client.post(
            f"/api/v1/areas/{self.area_id}/observations/refresh", json=payload, headers=self.h()
        )

    async def count(self) -> int:
        async with get_sessionmaker()() as s:
            return int(
                await s.scalar(select(func.count()).where(Observation.area_id == self.area_id)) or 0
            )

    async def records(self) -> list[RetrievalRecord]:
        async with get_sessionmaker()() as s:
            return list(
                (
                    await s.scalars(
                        select(RetrievalRecord)
                        .where(RetrievalRecord.area_id == self.area_id)
                        .order_by(RetrievalRecord.started_at)
                    )
                ).all()
            )


@pytest_asyncio.fixture
async def ctx(migrated_database_url: str) -> AsyncIterator[Ctx]:
    init_engine(migrated_database_url)
    agro = FakeAgro()
    app = make_app(agro)
    tag = f"o{uuid.uuid4().hex[:10]}"
    async with get_sessionmaker()() as s:
        area = await insert_area(s, f"{tag}-area")
        await s.commit()
        area_id = area.id
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield Ctx(client, agro, tag, area_id)
    await purge_tagged(tag)
    await dispose_engine()


def s2(day: date, **kw: Any) -> Any:
    return obs_item("sentinel-2", day, **kw)


def l8(day: date, **kw: Any) -> Any:
    return obs_item("landsat-8", day, **kw)


# --- refresh ------------------------------------------------------------------------


async def test_refresh_stores_and_is_idempotent(ctx: Ctx) -> None:
    preview = "https://api.agromonitoring.test/image/1.0/abc"
    ctx.agro.history["sentinel-2"] = [s2(D1, preview=preview), s2(D2, data=None)]
    ctx.agro.history["landsat-8"] = [l8(D2)]
    r = await ctx.refresh()
    assert r.status_code == 200, r.text
    body = r.json()
    assert {k: body[k] for k in ("status", "new", "updated", "skipped")} == {
        "status": "success",
        "new": 3,
        "updated": 0,
        "skipped": 0,
    }
    assert body["warnings"] == []
    again = (await ctx.refresh()).json()
    assert (again["new"], again["updated"], again["skipped"]) == (0, 0, 3)
    assert await ctx.count() == 3
    records = await ctx.records()
    assert [r.status for r in records] == ["success", "success"]
    assert records[0].item_count == 3 and records[1].item_count == 0
    assert all(r.raw_payload is None and r.duration_ms is not None for r in records)
    assert str(records[0].id) == body["retrieval_id"]

    ctx.agro.history["sentinel-2"][1] = s2(D2, data=50.0)
    changed = (await ctx.refresh()).json()
    assert (changed["new"], changed["updated"], changed["skipped"]) == (0, 1, 2)

    async with get_sessionmaker()() as s:
        events = (
            await s.scalars(
                select(AuditEvent).where(
                    AuditEvent.action == "refresh.trigger",
                    AuditEvent.target_id == str(ctx.area_id),
                )
            )
        ).all()
    assert len(events) == 3
    assert events[0].details["date_from"] == D1.isoformat()


async def test_refresh_selected_source_only(ctx: Ctx) -> None:
    ctx.agro.history["sentinel-2"] = [s2(D1)]
    ctx.agro.history["landsat-8"] = [l8(D1)]
    r = await ctx.refresh(sources=["landsat-8"])
    assert r.json()["new"] == 1
    assert ctx.agro.history_calls == ["landsat-8"]


async def test_refresh_resets_stale_geometry(ctx: Ctx) -> None:
    async with get_sessionmaker()() as s:
        await insert_observation(
            s, ctx.area_id, "sentinel-2", D1, cloud=Decimal("2.00"), data=Decimal("95.00"),
            geometry_status="stale_geometry",
        )  # fmt: skip
        await s.commit()
    ctx.agro.history["sentinel-2"] = [s2(D1)]
    body = (await ctx.refresh(sources=["sentinel-2"])).json()
    assert body["updated"] == 1
    async with get_sessionmaker()() as s:
        status = await s.scalar(
            select(Observation.geometry_status).where(Observation.area_id == ctx.area_id)
        )
    assert status == "current"


async def test_empty_refresh(ctx: Ctx) -> None:
    r = await ctx.refresh()
    assert r.status_code == 200
    body = r.json()
    assert (body["status"], body["new"], body["updated"], body["skipped"]) == ("empty", 0, 0, 0)
    assert [r.status for r in await ctx.records()] == ["empty"]


async def test_discarded_items_are_reported(ctx: Ctx) -> None:
    ctx.agro.history["sentinel-2"] = [s2(D1)]
    ctx.agro.discarded["sentinel-2"] = [DiscardedItem(str(ctx.area_id), "cl", "out_of_range")] * 2
    body = (await ctx.refresh(sources=["sentinel-2"])).json()
    assert body["status"] == "success"
    (warning,) = body["warnings"]
    assert warning["code"] == "ITEMS_DISCARDED" and "2" in warning["message"]


async def test_partial_success_keeps_stored_source(ctx: Ctx) -> None:
    ctx.agro.history["sentinel-2"] = [s2(D1), s2(D2)]
    ctx.agro.fail["landsat-8"] = AgroUpstreamError(status=503)
    r = await ctx.refresh()
    assert r.status_code == 200
    body = r.json()
    assert (body["status"], body["new"]) == ("partial", 2)
    assert [w["code"] for w in body["warnings"]] == ["UPSTREAM_ERROR"]
    assert "landsat-8" in body["warnings"][0]["message"]
    assert await ctx.count() == 2
    (record,) = await ctx.records()
    assert (record.status, record.error_code, record.item_count) == ("partial", "UPSTREAM_ERROR", 2)


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (AgroUpstreamError(status=503), 502, "UPSTREAM_ERROR"),
        (AgroClientError(401), 502, "UPSTREAM_ERROR"),
        (AgroTimeoutError(), 504, "UPSTREAM_TIMEOUT"),
    ],
)
async def test_total_failure_leaves_data_unchanged(
    ctx: Ctx, error: Exception, status: int, code: str
) -> None:
    async with get_sessionmaker()() as s:
        await insert_observation(s, ctx.area_id, "sentinel-2", D1)
        await s.commit()
    ctx.agro.fail = {"sentinel-2": error, "landsat-8": error}
    r = await ctx.refresh()
    assert (r.status_code, r.json()["error"]["code"]) == (status, code)
    assert PROVIDER_KEY not in r.text
    assert await ctx.count() == 1
    (record,) = await ctx.records()
    assert record.status == "failed" and record.finished_at is not None


async def test_deadline_returns_504_and_keeps_earlier_source(
    ctx: Ctx, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(refresh_service, "REFRESH_DEADLINE_S", 0.3)
    ctx.agro.history["sentinel-2"] = [s2(D1)]
    ctx.agro.history["landsat-8"] = [l8(D1)]
    ctx.agro.delay_s["landsat-8"] = 5
    r = await ctx.refresh()
    assert (r.status_code, r.json()["error"]["code"]) == (504, "UPSTREAM_TIMEOUT")
    async with get_sessionmaker()() as s:
        sources = (
            await s.scalars(select(Observation.source).where(Observation.area_id == ctx.area_id))
        ).all()
    assert list(sources) == ["sentinel-2"]
    (record,) = await ctx.records()
    assert (record.status, record.error_code) == ("partial", "UPSTREAM_TIMEOUT")


async def test_concurrent_refresh_is_409(ctx: Ctx) -> None:
    ctx.agro.gate = asyncio.Event()
    first = asyncio.create_task(ctx.refresh())
    await asyncio.wait_for(ctx.agro.entered.wait(), 5)
    second = await ctx.refresh()
    assert (second.status_code, second.json()["error"]["code"]) == (409, "REFRESH_IN_PROGRESS")
    ctx.agro.gate.set()
    assert (await first).status_code == 200
    assert len(await ctx.records()) == 1


async def test_stale_running_record_is_expired(ctx: Ctx) -> None:
    async with get_sessionmaker()() as s:
        s.add(
            RetrievalRecord(
                provider="agromonitoring", kind="refresh", area_id=ctx.area_id, status="running"
            )
        )
        await s.commit()
    assert (await ctx.refresh()).status_code == 409  # fresh: still running
    async with get_sessionmaker()() as s:
        await s.execute(
            update(RetrievalRecord)
            .where(RetrievalRecord.area_id == ctx.area_id)
            .values(started_at=func.now() - timedelta(seconds=200))
        )
        await s.commit()
    assert (await ctx.refresh()).status_code == 200
    statuses = [(r.status, r.error_code) for r in await ctx.records()]
    assert statuses == [("failed", "EXPIRED"), ("empty", None)]


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"date_from": "2026-03-02", "date_to": "2026-03-01"}, "date_from"),
        ({"date_from": (TODAY - timedelta(days=366)).isoformat()}, "date_to"),
        ({"date_to": (TODAY + timedelta(days=1)).isoformat()}, "date_to"),
        ({"date_from": "2026-02-30"}, "date_from"),
        ({"sources": []}, "sources"),
        ({"sources": ["modis"]}, "sources.0"),
        ({"extra": 1}, "extra"),
    ],
)
async def test_invalid_range_creates_no_record(ctx: Ctx, body: dict[str, Any], field: str) -> None:
    r = await ctx.refresh(**body)
    assert r.status_code == 422
    fields = [f["field"] for f in r.json()["error"]["details"]["fields"]]
    assert field in fields
    assert await ctx.records() == []
    assert ctx.agro.history_calls == []


async def test_exactly_366_days_is_accepted(ctx: Ctx) -> None:
    r = await ctx.refresh(date_from=(TODAY - timedelta(days=365)).isoformat())
    assert r.status_code == 200


async def test_refresh_unknown_area_and_roles(ctx: Ctx) -> None:
    url = f"/api/v1/areas/{uuid.uuid4()}/observations/refresh"
    body = {"date_from": D1.isoformat(), "date_to": D2.isoformat()}
    assert (await ctx.client.post(url, json=body, headers=ctx.h())).status_code == 404
    own = f"/api/v1/areas/{ctx.area_id}/observations/refresh"
    assert (await ctx.client.post(own, json=body, headers=ctx.h("admin"))).status_code == 200
    assert (await ctx.client.post(own, json=body, headers=auth(ctx.sub))).status_code == 403
    assert (await ctx.client.post(own, json=body)).status_code == 401


async def test_area_without_provider_polygon_is_409(ctx: Ctx) -> None:
    async with get_sessionmaker()() as s:
        await s.execute(update(Area).where(Area.id == ctx.area_id).values(external_polygon_id=None))
        await s.commit()
    r = await ctx.refresh()
    assert r.status_code == 409
    assert await ctx.records() == []


# --- reads --------------------------------------------------------------------------


async def test_list_observations_with_quality_meta_and_preview(ctx: Ctx) -> None:
    async with get_sessionmaker()() as s:
        a = await insert_observation(
            s, ctx.area_id, "sentinel-2", D1, cloud=Decimal("5.00"), data=None,
            preview_ref="https://api.agromonitoring.test/image/1.0/a",
        )  # fmt: skip
        await insert_observation(s, ctx.area_id, "landsat-8", D2, cloud=Decimal("35.00"))
        await insert_observation(s, ctx.area_id, "sentinel-2", D2, cloud=Decimal("15.00"))
        await s.commit()
        a_id = a.id
    r = await ctx.client.get(f"/api/v1/areas/{ctx.area_id}/observations", headers=ctx.h())
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 3 and body["limit"] == 50
    assert [i["date"] for i in body["items"]] == [D2.isoformat(), D2.isoformat(), D1.isoformat()]
    assert body["meta"] == {
        "resolution_class": {
            "sentinel-2": "10 m nominal sensor resolution",
            "landsat-8": "30 m nominal sensor resolution",
        },
        "counts_by_source": {"sentinel-2": 2, "landsat-8": 1},
    }
    by_id = {i["id"]: i for i in body["items"]}
    first = by_id[str(a_id)]
    assert first["quality"]["level"] == "good"
    assert first["quality"]["data_coverage_pct"] is None
    assert [w["code"] for w in first["quality"]["warnings"]] == ["DATA_COVERAGE_UNKNOWN"]
    assert first["preview"]["url"] == f"/api/v1/observations/{a_id}/preview"
    assert "visual orientation only" in first["preview"]["note"]
    assert "agromonitoring" not in r.text
    assert PROVIDER_KEY not in r.text
    levels = sorted(i["quality"]["level"] for i in body["items"])
    assert levels == ["good", "limited", "poor"]


async def test_quality_uses_current_settings(ctx: Ctx) -> None:
    async with get_sessionmaker()() as s:
        obs = await insert_observation(s, ctx.area_id, "sentinel-2", D1, cloud=Decimal("15.00"))
        await s.commit()
    url = f"/api/v1/observations/{obs.id}"
    assert (await ctx.client.get(url, headers=ctx.h())).json()["quality"]["level"] == "limited"
    try:
        async with get_sessionmaker()() as s:
            await s.execute(
                text("UPDATE app_settings SET value = '10' WHERE key = 'cloud_limit_pct'")
            )
            await s.commit()
        assert (await ctx.client.get(url, headers=ctx.h())).json()["quality"]["level"] == "poor"
    finally:
        async with get_sessionmaker()() as s:
            await s.execute(
                text("UPDATE app_settings SET value = default_value WHERE key = 'cloud_limit_pct'")
            )
            await s.commit()


async def test_filters(ctx: Ctx) -> None:
    async with get_sessionmaker()() as s:
        await insert_observation(s, ctx.area_id, "sentinel-2", D1, cloud=Decimal("5"), data=None)
        await insert_observation(s, ctx.area_id, "sentinel-2", D2, cloud=Decimal("25"))
        await insert_observation(s, ctx.area_id, "landsat-8", D2, cloud=Decimal("5"))
        await s.commit()
    base = f"/api/v1/areas/{ctx.area_id}/observations"

    async def total(**params: Any) -> int:
        r = await ctx.client.get(base, params=params, headers=ctx.h())
        assert r.status_code == 200, r.text
        return int(r.json()["total"])

    assert await total(source="sentinel-2") == 2
    assert await total(date_from=D2.isoformat()) == 2
    assert await total(date_to=D1.isoformat()) == 1
    assert await total(date_from=D2.isoformat(), date_to=D2.isoformat()) == 2
    assert await total(max_cloud_coverage=5) == 2
    assert await total(min_data_coverage=0) == 2  # null data coverage never matches
    assert await total(source="sentinel-2", max_cloud_coverage=10) == 1


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"source": "modis"}, "source"),
        ({"date_from": "2026-13-01"}, "date_from"),
        ({"max_cloud_coverage": 101}, "max_cloud_coverage"),
        ({"min_data_coverage": -1}, "min_data_coverage"),
        ({"max_cloud_coverage": "abc"}, "max_cloud_coverage"),
        ({"date_from": "2026-03-02", "date_to": "2026-03-01"}, "date_from"),
        ({"limit": 201}, "limit"),
    ],
)
async def test_invalid_filters(ctx: Ctx, params: dict[str, Any], field: str) -> None:
    r = await ctx.client.get(
        f"/api/v1/areas/{ctx.area_id}/observations", params=params, headers=ctx.h()
    )
    assert r.status_code == 422
    assert "items" not in r.json()
    assert field in [f["field"] for f in r.json()["error"]["details"]["fields"]]


async def test_not_found_cases(ctx: Ctx) -> None:
    missing = uuid.uuid4()
    for url in (
        f"/api/v1/areas/{missing}/observations",
        f"/api/v1/observations/{missing}",
        f"/api/v1/observations/{missing}/preview",
    ):
        r = await ctx.client.get(url, headers=ctx.h())
        assert r.status_code == 404
        assert set(r.json()) == {"error"}
    assert ctx.agro.fetch_calls == []


# --- preview proxy ------------------------------------------------------------------


async def test_preview_proxy(ctx: Ctx) -> None:
    ref = "https://api.agromonitoring.test/image/1.0/abc?size=117"
    async with get_sessionmaker()() as s:
        obs = await insert_observation(s, ctx.area_id, "sentinel-2", D1, preview_ref=ref)
        bare = await insert_observation(s, ctx.area_id, "landsat-8", D1)
        await s.commit()
    url = f"/api/v1/observations/{obs.id}/preview"

    for headers in ({}, auth(ctx.sub)):  # unauthenticated, then no role
        r = await ctx.client.get(url, headers=headers)
        assert r.status_code in (401, 403)
        assert "agromonitoring" not in r.text
    assert ctx.agro.fetch_calls == []

    r = await ctx.client.get(url, headers=ctx.h())
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.headers["cache-control"] == "private, max-age=3600"
    assert r.content.startswith(b"\x89PNG")
    assert ctx.agro.fetch_calls == [ref]
    detail = (await ctx.client.get(f"/api/v1/observations/{obs.id}", headers=ctx.h())).json()
    assert (detail["preview"]["width_px"], detail["preview"]["height_px"]) == (117, 117)

    r = await ctx.client.get(f"/api/v1/observations/{bare.id}/preview", headers=ctx.h())
    assert r.status_code == 404
    bare_detail = (await ctx.client.get(f"/api/v1/observations/{bare.id}", headers=ctx.h())).json()
    assert bare_detail["preview"]["url"] is None


@pytest.mark.parametrize(
    ("failure", "status"),
    [(AgroUpstreamError(), 502), (AgroTimeoutError(), 504)],
)
async def test_preview_provider_errors(ctx: Ctx, failure: Exception, status: int) -> None:
    async with get_sessionmaker()() as s:
        obs = await insert_observation(
            s, ctx.area_id, "sentinel-2", D1, preview_ref="https://api.agromonitoring.test/x"
        )
        await s.commit()
    ctx.agro.image = failure
    r = await ctx.client.get(f"/api/v1/observations/{obs.id}/preview", headers=ctx.h())
    assert r.status_code == status
    assert "agromonitoring" not in r.text


# --- hybrid source of values (verified against the real API) ---------------------


async def test_cloud_and_coverage_come_from_image_search(ctx: Ctx) -> None:
    from dataclasses import replace

    ref = "https://api.agromonitoring.test/image/1.0/scene"
    # History reports 100 for cloud and coverage; the scene carries the real values.
    ctx.agro.history["sentinel-2"] = [s2(D1, cloud=100, data=100), s2(D2, cloud=100, data=100)]
    ctx.agro.images["sentinel-2"] = [replace(s2(D1, cloud=4.95, data=98.0, preview=ref), ndvi=None)]
    body = (await ctx.refresh(sources=["sentinel-2"])).json()
    assert (body["status"], body["new"]) == ("success", 2)
    assert ctx.agro.search_calls == ["sentinel-2"]
    async with get_sessionmaker()() as s:
        rows = {
            o.acquired_on: o
            for o in (
                await s.scalars(select(Observation).where(Observation.area_id == ctx.area_id))
            ).all()
        }
    matched, unmatched = rows[D1], rows[D2]
    assert (matched.cloud_coverage, matched.data_coverage) == (Decimal("4.95"), Decimal("98.00"))
    assert matched.preview_ref == ref
    assert matched.ndvi_mean == Decimal("0.5000")  # statistics still come from history
    # No scene: unknown, never a substituted value.
    assert (unmatched.cloud_coverage, unmatched.data_coverage) == (None, None)
    detail = (await ctx.client.get(f"/api/v1/observations/{unmatched.id}", headers=ctx.h())).json()
    assert detail["quality"]["level"] == "poor"
    codes = [w["code"] for w in detail["quality"]["warnings"]]
    assert codes == ["INVALID_CLOUD_COVERAGE", "DATA_COVERAGE_UNKNOWN"]


async def test_per_image_batches_are_not_searched_again(ctx: Ctx) -> None:
    from app.integrations.agro.models import NormalizedBatch

    async def per_image_history(*args: Any, **kwargs: Any) -> NormalizedBatch:
        ctx.agro.history_calls.append("per_image")
        return NormalizedBatch(items=[s2(D1, cloud=3.0, data=99.0)], scene_metadata=True)

    ctx.agro.ndvi_history = per_image_history  # type: ignore[method-assign]
    body = (await ctx.refresh(sources=["sentinel-2"])).json()
    assert body["new"] == 1
    assert ctx.agro.search_calls == []
    async with get_sessionmaker()() as s:
        cloud = await s.scalar(
            select(Observation.cloud_coverage).where(Observation.area_id == ctx.area_id)
        )
    assert cloud == Decimal("3.00")
