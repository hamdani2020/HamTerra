"""Weather context in time series and comparisons (task 13.4)."""

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
from sqlalchemy import select

from app.db.models.retrievals import RetrievalRecord
from app.db.session import dispose_engine, get_sessionmaker, init_engine
from app.domain.constants import WEATHER_NOTE
from app.integrations.agro.errors import AgroTimeoutError, AgroUpstreamError
from app.integrations.weather.null import NullWeatherProvider
from app.services import weather as weather_service
from tests.integration.harness import (
    FakeAgro,
    FakeWeather,
    auth,
    insert_area,
    insert_observation,
    make_app,
    purge_tagged,
    set_setting,
)

DAYS = [date(2026, 3, 6), date(2026, 3, 16), date(2026, 4, 30)]
MEANS = [Decimal("0.5214"), Decimal("0.5940"), Decimal("0.6953")]


@dataclass
class Ctx:
    client: httpx.AsyncClient
    weather: FakeWeather
    tag: str
    area_id: uuid.UUID

    async def series(self, **params: Any) -> dict[str, Any]:
        r = await self.client.get(
            f"/api/v1/areas/{self.area_id}/ndvi/timeseries",
            params={"source": "sentinel-2", **params},
            headers=auth(f"{self.tag}-u", "researcher"),
        )
        assert r.status_code == 200, r.text
        return dict(r.json())

    async def compare(self, **body: Any) -> dict[str, Any]:
        r = await self.client.post(
            f"/api/v1/areas/{self.area_id}/comparisons",
            json={"source": "sentinel-2", "date_a": "2026-03-06", "date_b": "2026-04-30", **body},
            headers=auth(f"{self.tag}-u", "researcher"),
        )
        assert r.status_code == 200, r.text
        return dict(r.json())


def codes(body: dict[str, Any]) -> list[str]:
    return [w["code"] for w in body["warnings"]]


@pytest_asyncio.fixture
async def ctx(migrated_database_url: str) -> AsyncIterator[Ctx]:
    init_engine(migrated_database_url)
    tag = f"wx{uuid.uuid4().hex[:10]}"
    async with get_sessionmaker()() as s:
        area = await insert_area(s, f"{tag}-area")
        for day, mean in zip(DAYS, MEANS, strict=True):
            await insert_observation(s, area.id, "sentinel-2", day, mean=mean)
        await s.commit()
        area_id = area.id
    await set_setting("weather_enabled", "true")
    weather = FakeWeather()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=make_app(FakeAgro(), weather)), base_url="http://test"
    ) as client:
        yield Ctx(client, weather, tag, area_id)
    await set_setting("weather_enabled", None)
    async with get_sessionmaker()() as s:
        records = await s.scalars(select(RetrievalRecord).where(RetrievalRecord.area_id == area_id))
        for record in records:
            await s.delete(record)
        await s.commit()
    await purge_tagged(tag)
    await dispose_engine()


async def test_series_points_carry_labelled_context(ctx: Ctx) -> None:
    plain = await ctx.series()
    body = await ctx.series(include_weather="true")
    assert codes(body) == codes(plain)  # no weather warning when every day has data
    for point in body["points"]:
        weather = point["weather"]
        assert weather["provider"] == "test-weather"
        assert weather["period"] == {"from": point["date"], "to": point["date"]}
        assert weather["note"] == WEATHER_NOTE
        assert weather["values"] == {
            "temperature_mean": {"value": 25.5, "unit": "°C"},
            "precipitation_total": {"value": 1.0, "unit": "mm"},
            "wind_speed_mean": {"value": 2.0, "unit": "m/s"},
        }
    assert body["summary"] == plain["summary"]
    assert [p["ndvi_mean"] for p in body["points"]] == [p["ndvi_mean"] for p in plain["points"]]
    assert "correlation" not in str(body["summary"]).lower()
    async with get_sessionmaker()() as s:
        records = (
            await s.scalars(
                select(RetrievalRecord).where(
                    RetrievalRecord.area_id == ctx.area_id, RetrievalRecord.provider == "weather"
                )
            )
        ).all()
    assert len(records) == len(ctx.weather.calls) >= 1
    assert {r.status for r in records} == {"success"}


async def test_comparison_has_a_b_and_between(ctx: Ctx) -> None:
    body = await ctx.compare(include_weather=True)
    weather = body["weather"]
    assert weather["a"]["period"] == {"from": "2026-03-06", "to": "2026-03-06"}
    assert weather["b"]["period"] == {"from": "2026-04-30", "to": "2026-04-30"}
    assert weather["between"]["period"] == {"from": "2026-03-06", "to": "2026-04-30"}
    assert weather["between"]["values"]["precipitation_total"] == {"value": 56.0, "unit": "mm"}
    assert all(w["note"] == WEATHER_NOTE for w in weather.values())
    plain = await ctx.compare()
    assert body["ndvi_diff"] == plain["ndvi_diff"] and body["flag"] == plain["flag"]


async def test_disabled_setting(ctx: Ctx) -> None:
    await set_setting("weather_enabled", "false")
    body = await ctx.series(include_weather="true")
    assert "WEATHER_DISABLED" in codes(body)
    assert all(p["weather"] is None for p in body["points"])
    assert ctx.weather.calls == []


async def test_unconfigured_provider(ctx: Ctx, migrated_database_url: str) -> None:
    app = make_app(FakeAgro(), NullWeatherProvider())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.get(
            f"/api/v1/areas/{ctx.area_id}/ndvi/timeseries",
            params={"source": "sentinel-2", "include_weather": "true"},
            headers=auth(f"{ctx.tag}-u", "researcher"),
        )
    assert "WEATHER_DISABLED" in codes(r.json())


@pytest.mark.parametrize("failure", [AgroUpstreamError(), AgroTimeoutError()])
async def test_provider_failure_leaves_ndvi_unchanged(ctx: Ctx, failure: Exception) -> None:
    plain = await ctx.series()
    ctx.weather.fail = failure
    body = await ctx.series(include_weather="true")
    assert "WEATHER_UNAVAILABLE" in codes(body)
    assert all(p["weather"] is None for p in body["points"])
    assert body["summary"] == plain["summary"]
    cmp = await ctx.compare(include_weather=True)
    assert cmp["weather"] is None and "WEATHER_UNAVAILABLE" in codes(cmp)
    async with get_sessionmaker()() as s:
        statuses = (
            await s.scalars(
                select(RetrievalRecord.status).where(
                    RetrievalRecord.area_id == ctx.area_id, RetrievalRecord.provider == "weather"
                )
            )
        ).all()
    assert set(statuses) == {"failed"}


async def test_timeout_after_ten_seconds(ctx: Ctx, monkeypatch: pytest.MonkeyPatch) -> None:
    assert weather_service.WEATHER_TIMEOUT_S == 10.0
    monkeypatch.setattr(weather_service, "WEATHER_TIMEOUT_S", 0.05)
    ctx.weather.delay_s = 2
    body = await ctx.series(include_weather="true")
    assert "WEATHER_UNAVAILABLE" in codes(body)
    assert body["summary"]["count"] == 3


async def test_invalid_values_and_missing_days(ctx: Ctx) -> None:
    ctx.weather.discarded = 3
    ctx.weather.missing_days = {DAYS[1]}
    body = await ctx.series(include_weather="true")
    assert "WEATHER_INVALID_DATA" in codes(body)
    assert "WEATHER_UNAVAILABLE" in codes(body)
    weathers = [p["weather"] for p in body["points"]]
    assert weathers[1] is None and weathers[0] is not None and weathers[2] is not None
