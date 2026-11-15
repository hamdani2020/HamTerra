"""Time-series endpoint against PostGIS, with the reference series (task 11.6)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import httpx
import numpy as np
import pytest
import pytest_asyncio

from app.db.session import dispose_engine, get_sessionmaker, init_engine
from app.domain.constants import LIMITATIONS
from app.integrations.agro.errors import AgroUpstreamError
from tests.fixtures.reference import REFERENCE_NDVI_SERIES
from tests.integration.harness import (
    FakeAgro,
    auth,
    insert_area,
    insert_observation,
    make_app,
    purge_tagged,
)

RANGE = "date_range"


class FailingAgro(FakeAgro):
    """Every provider call fails: reads must not depend on the provider."""

    async def ndvi_history(self, *args: Any, **kwargs: Any) -> Any:
        self.history_calls.append("called")
        raise AgroUpstreamError()

    async def image_search(self, *args: Any, **kwargs: Any) -> Any:
        self.history_calls.append("called")
        raise AgroUpstreamError()

    async def fetch_image(self, image_ref: str) -> Any:
        self.fetch_calls.append(image_ref)
        raise AgroUpstreamError()


@dataclass
class Ctx:
    client: httpx.AsyncClient
    agro: FailingAgro
    tag: str
    area_id: uuid.UUID

    async def get(self, **params: Any) -> httpx.Response:
        return await self.client.get(
            f"/api/v1/areas/{self.area_id}/ndvi/timeseries",
            params=params,
            headers=auth(f"{self.tag}-u", "researcher"),
        )


@pytest_asyncio.fixture
async def ctx(migrated_database_url: str) -> AsyncIterator[Ctx]:
    init_engine(migrated_database_url)
    agro = FailingAgro()
    tag = f"ts{uuid.uuid4().hex[:10]}"
    async with get_sessionmaker()() as s:
        area = await insert_area(s, f"{tag}-area")
        for point in REFERENCE_NDVI_SERIES:
            await insert_observation(
                s,
                area.id,
                "sentinel-2",
                point.observed_on,
                cloud=Decimal(str(point.cloud_coverage)),
                data=None,  # the reference reports no data coverage
                mean=Decimal(str(point.ndvi_mean)),
            )
        # A Landsat 8 observation that must never appear in a Sentinel-2 series.
        await insert_observation(s, area.id, "landsat-8", date(2026, 3, 16), mean=Decimal("0.1"))
        await s.commit()
        area_id = area.id
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=make_app(agro)), base_url="http://test"
    ) as client:
        yield Ctx(client, agro, tag, area_id)
    await purge_tagged(tag)
    await dispose_engine()


def expected_trend() -> float:
    first = REFERENCE_NDVI_SERIES[0].observed_on
    x = [(p.observed_on - first).days for p in REFERENCE_NDVI_SERIES]
    y = [p.ndvi_mean for p in REFERENCE_NDVI_SERIES]
    return round(float(np.polyfit(x, y, 1)[0]) * 30, 4)


async def test_reference_series(ctx: Ctx) -> None:
    r = await ctx.get(source="sentinel-2")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "sentinel-2"
    points = body["points"]
    assert [p["date"] for p in points] == [p.observed_on.isoformat() for p in REFERENCE_NDVI_SERIES]
    assert [p["ndvi_mean"] for p in points] == [p.ndvi_mean for p in REFERENCE_NDVI_SERIES]
    assert [p["cloud_coverage_pct"] for p in points] == [
        p.cloud_coverage for p in REFERENCE_NDVI_SERIES
    ]
    assert all(p["data_coverage_pct"] is None for p in points)
    assert all(p["weather"] is None for p in points)
    assert [p["gap_days_from_previous"] for p in points] == [None, 40, 10, 5, 10, 15, 7, 8]
    assert all(
        "DATA_COVERAGE_UNKNOWN" in [w["code"] for w in p["quality"]["warnings"]] for p in points
    )
    assert body["summary"] == {
        "count": 8,
        "first_date": "2026-01-25",
        "last_date": "2026-04-30",
        "min": 0.5198,
        "max": 0.6953,
        "mean_of_means": 0.6107,
        "trend_per_30d": expected_trend(),
    }
    assert body["summary"]["trend_per_30d"] == 0.0585
    assert body["meta"] == {
        "excluded_by_cloud": 0,
        "resolution_class": "10 m nominal sensor resolution",
    }
    assert [w["code"] for w in body["warnings"]] == ["IRREGULAR_SAMPLING"]
    assert body["limitations"] == list(LIMITATIONS)
    assert ctx.agro.history_calls == [] and ctx.agro.fetch_calls == []


async def test_cloud_filter_and_range(ctx: Ctx) -> None:
    body = (await ctx.get(source="sentinel-2", max_cloud_coverage=0.23)).json()
    assert body["meta"]["excluded_by_cloud"] == 2  # 4.95 and 5.64 are removed; 0.23 is kept
    assert body["points"][0]["date"] == "2026-03-16"
    assert body["points"][0]["gap_days_from_previous"] is None
    body = (await ctx.get(source="sentinel-2", date_from="2026-03-16", date_to="2026-03-31")).json()
    assert [p["date"] for p in body["points"]] == ["2026-03-16", "2026-03-21", "2026-03-31"]
    assert body["warnings"] == []


async def test_one_and_zero_points(ctx: Ctx) -> None:
    one = (await ctx.get(source="sentinel-2", date_from="2026-01-25", date_to="2026-01-25")).json()
    assert len(one["points"]) == 1
    assert one["summary"] == {
        "count": 1,
        "first_date": None,
        "last_date": None,
        "min": None,
        "max": None,
        "mean_of_means": None,
        "trend_per_30d": None,
    }
    assert [w["code"] for w in one["warnings"]] == ["INSUFFICIENT_OBSERVATIONS"]
    zero = (await ctx.get(source="sentinel-2", date_from="2025-01-01", date_to="2025-02-01")).json()
    assert zero["points"] == [] and zero["summary"]["count"] == 0
    assert zero["limitations"] == list(LIMITATIONS)
    assert [w["code"] for w in zero["warnings"]] == ["INSUFFICIENT_OBSERVATIONS"]


async def test_sources_are_never_mixed(ctx: Ctx) -> None:
    body = (await ctx.get(source="landsat-8")).json()
    assert [p["ndvi_mean"] for p in body["points"]] == [0.1]
    assert body["meta"]["resolution_class"] == "30 m nominal sensor resolution"


async def test_include_weather_is_disabled_for_now(ctx: Ctx) -> None:
    body = (await ctx.get(source="sentinel-2", include_weather="true")).json()
    assert "WEATHER_DISABLED" in [w["code"] for w in body["warnings"]]
    assert all(p["weather"] is None for p in body["points"])
    assert body["summary"]["mean_of_means"] == 0.6107


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({}, "source"),
        ({"source": "modis"}, "source"),
        (
            {"source": "sentinel-2", "date_from": "2026-03-02", "date_to": "2026-03-01"},
            "date_range",
        ),
        (
            {"source": "sentinel-2", "date_from": "2010-01-01", "date_to": "2020-01-10"},
            "date_range",
        ),
        ({"source": "sentinel-2", "max_cloud_coverage": "abc"}, "max_cloud_coverage"),
        ({"source": "sentinel-2", "max_cloud_coverage": 100.1}, "max_cloud_coverage"),
        ({"source": "sentinel-2", "date_from": "2026-02-30"}, "date_from"),
    ],
)
async def test_validation(ctx: Ctx, params: dict[str, Any], field: str) -> None:
    r = await ctx.get(**params)
    assert r.status_code == 422
    assert "points" not in r.json()
    assert field in [f["field"] for f in r.json()["error"]["details"]["fields"]]


async def test_span_boundary_is_3660_days(ctx: Ctx) -> None:
    end = date(2026, 4, 30)
    ok = (end - timedelta(days=3660)).isoformat()
    over = (end - timedelta(days=3661)).isoformat()
    r = await ctx.get(source="sentinel-2", date_from=ok, date_to=end.isoformat())
    assert r.status_code == 200
    r = await ctx.get(source="sentinel-2", date_from=over, date_to=end.isoformat())
    assert r.status_code == 422


async def test_missing_area_and_roles(ctx: Ctx) -> None:
    missing = await ctx.client.get(
        f"/api/v1/areas/{uuid.uuid4()}/ndvi/timeseries",
        params={"source": "sentinel-2"},
        headers=auth(f"{ctx.tag}-u", "researcher"),
    )
    assert missing.status_code == 404
    assert set(missing.json()) == {"error"}
    url = f"/api/v1/areas/{ctx.area_id}/ndvi/timeseries?source=sentinel-2"
    assert (await ctx.client.get(url)).status_code == 401
    assert (await ctx.client.get(url, headers=auth(f"{ctx.tag}-u"))).status_code == 403
    assert (await ctx.client.get(url, headers=auth(f"{ctx.tag}-u", "admin"))).status_code == 200
