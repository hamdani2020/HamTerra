"""Comparison endpoint against PostGIS, with the reference series (task 12.7)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

import httpx
import pytest
import pytest_asyncio
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from sqlalchemy import select

from app.core.errors import CrossSensorComparison
from app.db.models.settings import AppSetting
from app.db.session import dispose_engine, get_sessionmaker, init_engine
from app.domain.constants import LIMITATIONS, contains_forbidden_term
from app.services import comparisons as comparison_service
from tests.fixtures.reference import REFERENCE_NDVI_SERIES
from tests.integration.harness import (
    FakeAgro,
    auth,
    insert_area,
    insert_observation,
    make_app,
    purge_tagged,
    run_in_rolled_back_session,
)


@dataclass
class Ctx:
    client: httpx.AsyncClient
    tag: str
    area_id: uuid.UUID

    async def post(self, **body: Any) -> httpx.Response:
        payload = {"source": "sentinel-2", **body}
        return await self.client.post(
            f"/api/v1/areas/{self.area_id}/comparisons",
            json=payload,
            headers=auth(f"{self.tag}-u", "researcher"),
        )


@pytest_asyncio.fixture
async def ctx(migrated_database_url: str) -> AsyncIterator[Ctx]:
    init_engine(migrated_database_url)
    tag = f"cmp{uuid.uuid4().hex[:10]}"
    async with get_sessionmaker()() as s:
        area = await insert_area(s, f"{tag}-area")
        for point in REFERENCE_NDVI_SERIES:
            await insert_observation(
                s, area.id, "sentinel-2", point.observed_on,
                cloud=Decimal(str(point.cloud_coverage)), data=None,
                mean=Decimal(str(point.ndvi_mean)),
            )  # fmt: skip
        await insert_observation(s, area.id, "sentinel-2", date(2025, 3, 10), mean=Decimal("0"))
        await insert_observation(s, area.id, "landsat-8", date(2026, 4, 30), mean=Decimal("0.3"))
        await s.commit()
        area_id = area.id
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=make_app(FakeAgro())), base_url="http://test"
    ) as client:
        yield Ctx(client, tag, area_id)
    await purge_tagged(tag)
    await dispose_engine()


async def test_reference_pair(ctx: Ctx) -> None:
    r = await ctx.post(date_a="2026-03-06", date_b="2026-04-30")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ndvi_diff"] == 0.1739
    assert body["ndvi_diff_pct"] == 33.35
    assert body["interval_days"] == 55
    assert body["flag"] == "flagged"
    assert body["a"]["date"] == "2026-03-06" and body["a"]["ndvi"]["mean"] == 0.5214
    assert body["b"]["date"] == "2026-04-30" and body["b"]["ndvi"]["mean"] == 0.6953
    assert body["thresholds_applied"] == {
        "ndvi_diff": 0.1,
        "max_cloud": 20.0,
        "min_data_coverage": 80.0,
    }
    assert body["quality"]["level"] == "good"
    assert body["quality"]["cloud_coverage_pct"] == 5.64
    assert body["quality"]["data_coverage_pct"] is None
    assert body["spatial_analysis_available"] is False
    assert [w["code"] for w in body["warnings"]] == ["SEASONALITY_NOT_CONTROLLED"]
    assert body["limitations"] == list(LIMITATIONS)
    assert body["weather"] is None
    assert body["summary_text"].startswith("Difference flagged for investigation")
    assert "+0.1739" in body["summary_text"]
    assert not contains_forbidden_term(r.text)


async def test_swapping_flips_the_sign(ctx: Ctx) -> None:
    ab = (await ctx.post(date_a="2026-03-06", date_b="2026-04-30")).json()
    ba = (await ctx.post(date_a="2026-04-30", date_b="2026-03-06")).json()
    assert ba["ndvi_diff"] == -ab["ndvi_diff"]
    assert ba["interval_days"] == ab["interval_days"]
    assert ba["flag"] == ab["flag"]
    again = (await ctx.post(date_a="2026-03-06", date_b="2026-04-30")).json()
    assert again == ab


async def test_zero_mean_gives_null_percent(ctx: Ctx) -> None:
    body = (await ctx.post(date_a="2025-03-10", date_b="2026-03-06")).json()
    assert body["ndvi_diff_pct"] is None
    assert body["ndvi_diff"] == 0.5214
    codes = [w["code"] for w in body["warnings"]]
    assert "PERCENT_DIFFERENCE_UNDEFINED" in codes
    assert "SEASONALITY_NOT_CONTROLLED" not in codes  # 361 days is within 15 of a year


async def test_overrides_apply_to_this_request_only(ctx: Ctx) -> None:
    async with get_sessionmaker()() as s:
        before = {
            r.key: (r.value, r.updated_at) for r in (await s.scalars(select(AppSetting))).all()
        }
    r = await ctx.post(
        date_a="2026-03-06",
        date_b="2026-04-30",
        thresholds={"ndvi_diff": 0.2, "max_cloud": 5, "min_data_coverage": 0},
    )
    body = r.json()
    assert body["thresholds_applied"] == {
        "ndvi_diff": 0.2,
        "max_cloud": 5.0,
        "min_data_coverage": 0.0,
    }
    assert body["flag"] == "not_flagged"
    assert "below the investigation threshold of 0.2" in body["summary_text"]
    assert body["a"]["quality"]["level"] == "poor"  # 5.64 > 5
    assert body["quality"]["level"] == "poor"
    assert "LOW_QUALITY_OBSERVATION" in [w["code"] for w in body["warnings"]]
    async with get_sessionmaker()() as s:
        after = {
            r.key: (r.value, r.updated_at) for r in (await s.scalars(select(AppSetting))).all()
        }
    assert after == before


@pytest.mark.parametrize(
    ("thresholds", "field"),
    [
        ({"ndvi_diff": 2.01}, "thresholds.ndvi_diff"),
        ({"ndvi_diff": -0.1}, "thresholds.ndvi_diff"),
        ({"max_cloud": 101}, "thresholds.max_cloud"),
        ({"min_data_coverage": -1}, "thresholds.min_data_coverage"),
        ({"ndvi_diff": "0.1"}, "thresholds.ndvi_diff"),
        ({"ndvi_diff": True}, "thresholds.ndvi_diff"),
        ({"other": 1}, "thresholds.other"),
    ],
)
async def test_invalid_override_is_422(ctx: Ctx, thresholds: dict[str, Any], field: str) -> None:
    r = await ctx.post(date_a="2026-03-06", date_b="2026-04-30", thresholds=thresholds)
    assert r.status_code == 422
    assert "ndvi_diff" not in r.json()["error"]["details"].get("result", {})
    assert field in [f["field"] for f in r.json()["error"]["details"]["fields"]]


async def test_equal_dates_beat_missing_observation(ctx: Ctx) -> None:
    for day in ("2026-03-06", "2019-01-01"):
        r = await ctx.post(date_a=day, date_b=day)
        assert r.status_code == 422
        assert r.json()["error"]["details"]["defect"] == "EQUAL_DATES"
    missing_area = await ctx.client.post(
        f"/api/v1/areas/{uuid.uuid4()}/comparisons",
        json={"source": "sentinel-2", "date_a": "2026-01-01", "date_b": "2026-01-01"},
        headers=auth(f"{ctx.tag}-u", "researcher"),
    )
    assert missing_area.status_code == 422


async def test_missing_observation_names_the_date(ctx: Ctx) -> None:
    r = await ctx.post(date_a="2026-03-06", date_b="2026-03-07")
    assert r.status_code == 404
    assert r.json()["error"]["details"]["missing_dates"] == ["2026-03-07"]
    assert "2026-03-07" in r.json()["error"]["message"]
    # The Landsat 8 observation on 2026-04-30 is not a Sentinel-2 observation.
    r = await ctx.post(date_a="2026-03-06", date_b="2026-04-30", source="landsat-8")
    assert r.json()["error"]["details"]["missing_dates"] == ["2026-03-06"]


async def test_missing_area_and_roles(ctx: Ctx) -> None:
    body = {"source": "sentinel-2", "date_a": "2026-03-06", "date_b": "2026-04-30"}
    r = await ctx.client.post(
        f"/api/v1/areas/{uuid.uuid4()}/comparisons", json=body, headers=auth("x", "researcher")
    )
    assert r.status_code == 404
    url = f"/api/v1/areas/{ctx.area_id}/comparisons"
    assert (await ctx.client.post(url, json=body)).status_code == 401
    assert (await ctx.client.post(url, json=body, headers=auth(f"{ctx.tag}-u"))).status_code == 403


async def test_weather_disabled_by_default(ctx: Ctx) -> None:
    body = (await ctx.post(date_a="2026-03-06", date_b="2026-04-30", include_weather=True)).json()
    assert body["weather"] is None
    assert "WEATHER_DISABLED" in [w["code"] for w in body["warnings"]]


# --- Property 25 at the service level ---------------------------------------------


@settings(
    max_examples=30, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(day_a=st.integers(0, 50), day_b=st.integers(0, 50))
def test_cross_sensor_is_refused_for_stored_observations(
    migrated_database_url: str, day_a: int, day_b: int
) -> None:
    from datetime import timedelta

    async def work(session: Any) -> None:
        area = await insert_area(session, f"prop-{uuid.uuid4().hex[:8]}")
        base = date(2026, 1, 1)
        a = await insert_observation(session, area.id, "sentinel-2", base + timedelta(days=day_a))
        b = await insert_observation(session, area.id, "landsat-8", base + timedelta(days=day_b))
        thresholds = await comparison_service.resolve_thresholds(session, None)
        with pytest.raises(CrossSensorComparison):
            await comparison_service.compare_loaded(session, a, b, thresholds=thresholds)

    run_in_rolled_back_session(migrated_database_url, work)
