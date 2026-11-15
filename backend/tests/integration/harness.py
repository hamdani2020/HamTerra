"""Shared helpers for API integration tests: fake provider, app builder, DB helpers."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field, replace
from datetime import date
from decimal import Decimal
from typing import Any

import httpx
from shapely.geometry import shape
from shapely.prepared import prep
from sqlalchemy import func, text
from sqlalchemy.engine import make_url  # noqa: F401
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import Settings
from app.db.models.areas import Area
from app.db.models.observations import Observation
from app.db.session import get_sessionmaker
from app.integrations.agro.models import (
    DiscardedItem,
    ImageBytes,
    NdviStats,
    NormalizedBatch,
    NormalizedObservation,
    ProviderPolygon,
    Source,
)
from app.integrations.cognito.jwks import JwksCache
from app.integrations.cognito.validator import TokenValidator
from app.main import create_app
from tests.fixtures.jwt_keys import FAKE_CLIENT_ID, FAKE_ISSUER, FakeKey
from tests.fixtures.reference import load_ghana_boundary_fixture

KEY = FakeKey("kid-harness")

PNG_117 = (
    b"\x89PNG\r\n\x1a\n" + (13).to_bytes(4, "big") + b"IHDR"
    + (117).to_bytes(4, "big") + (117).to_bytes(4, "big") + b"\x08\x06\x00\x00\x00"
)  # fmt: skip

TRIANGLE = "POLYGON((-1 7, -0.99 7, -0.99 7.01, -1 7.01, -1 7))"


def obs_item(
    source: Source,
    day: date,
    *,
    cloud: float = 2.0,
    data: float | None = 95.0,
    mean: float = 0.5,
    preview: str | None = None,
) -> NormalizedObservation:
    return NormalizedObservation(
        source=source,
        acquired_on=day,
        cloud_coverage=cloud,
        data_coverage=data,
        ndvi=NdviStats(mean=mean, min=mean - 0.1, max=mean + 0.1, std=0.05, median=mean),
        preview_ref=preview,
    )


class FakeAgro:
    """Provider double with per-source batches, failures and an optional gate."""

    def __init__(self) -> None:
        self.history: dict[str, list[NormalizedObservation]] = {}
        self.images: dict[str, list[NormalizedObservation]] = {}
        self.discarded: dict[str, list[DiscardedItem]] = {}
        self.fail: dict[str, Exception] = {}
        self.delay_s: dict[str, float] = {}
        self.gate: asyncio.Event | None = None
        self.entered = asyncio.Event()
        self.history_calls: list[str] = []
        self.search_calls: list[str] = []
        self.fetch_calls: list[str] = []
        self.image: ImageBytes | Exception = ImageBytes(PNG_117, "image/png")

    async def ndvi_history(
        self, polygon_id: str, source: Source, start: date, end: date, *, area_id: str = ""
    ) -> NormalizedBatch:
        self.history_calls.append(source)
        self.entered.set()
        if self.gate is not None:
            await self.gate.wait()
        if self.delay_s.get(source):
            await asyncio.sleep(self.delay_s[source])
        if source in self.fail:
            raise self.fail[source]
        return NormalizedBatch(
            items=[i for i in self.history.get(source, []) if start <= i.acquired_on <= end],
            discarded=list(self.discarded.get(source, [])),
        )

    async def image_search(
        self, polygon_id: str, source: Source, start: date, end: date, *, area_id: str = ""
    ) -> NormalizedBatch:
        """Scenes for ``source``. Unless set explicitly, the scenes behind the history items,
        carrying their cloud, data coverage and preview (as the real API does)."""
        self.search_calls.append(source)
        if source in self.images:
            scenes = self.images[source]
        else:
            scenes = [replace(i, ndvi=None) for i in self.history.get(source, [])]
        return NormalizedBatch(items=[s for s in scenes if start <= s.acquired_on <= end])

    async def fetch_image(self, image_ref: str) -> ImageBytes:
        self.fetch_calls.append(image_ref)
        if isinstance(self.image, Exception):
            raise self.image
        return self.image

    async def create_polygon(self, name: str, geometry: dict[str, Any]) -> ProviderPolygon:
        return ProviderPolygon(id="poly-x", area_ha=None)

    async def delete_polygon(self, polygon_id: str) -> None:
        return None

    async def probe(self) -> None:
        return None


async def _jwks() -> dict[str, Any]:
    return KEY.jwks()


def make_app(agro: Any, weather: Any = None, cognito: Any = None) -> Any:
    app = create_app(Settings())
    if weather is not None:
        app.state.weather_provider = weather
    if cognito is not None:
        app.state.cognito_admin = cognito
    app.state.token_validator = TokenValidator(
        cache=JwksCache(_jwks), issuer=FAKE_ISSUER, client_id=FAKE_CLIENT_ID
    )
    app.state.agro_client = agro
    # The small test boundary, so routes that need it work without the lifespan.
    app.state.ghana_boundary = prep(shape(load_ghana_boundary_fixture()["geometry"]))
    return app


def auth(sub: str, *groups: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {KEY.make_token(sub=sub, groups=list(groups))}"}


async def client_for(app: Any) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client


async def insert_area(session: AsyncSession, name: str, polygon_id: str | None = "poly-1") -> Area:
    area = Area(
        name=name,
        status="active",
        geom=func.ST_GeomFromText(TRIANGLE, 4326),
        area_ha=Decimal("100.00"),
        external_polygon_id=polygon_id,
    )
    session.add(area)
    await session.flush()
    return area


async def insert_observation(
    session: AsyncSession,
    area_id: uuid.UUID,
    source: str,
    day: date,
    *,
    cloud: Decimal | None = Decimal("2.00"),
    data: Decimal | None = Decimal("95.00"),
    mean: Decimal = Decimal("0.5000"),
    preview_ref: str | None = None,
    geometry_status: str = "current",
    stats: tuple[Decimal | None, Decimal | None, Decimal | None, Decimal | None] | None = None,
) -> Observation:
    """``stats`` is ``(min, max, std, median)``; omitted means all null."""
    low, high, std, median = stats or (None, None, None, None)
    obs = Observation(
        area_id=area_id,
        source=source,
        acquired_on=day,
        cloud_coverage=cloud,
        data_coverage=data,
        ndvi_mean=mean,
        ndvi_min=low,
        ndvi_max=high,
        ndvi_std=std,
        ndvi_median=median,
        preview_ref=preview_ref,
        geometry_status=geometry_status,
    )
    session.add(obs)
    await session.flush()
    return obs


async def purge_tagged(tag: str) -> None:
    """Remove rows created by a test. Audit rows are append-only and stay."""
    pattern = f"{tag}-%"
    async with get_sessionmaker()() as s:
        params = {"p": pattern}
        await s.execute(
            text(
                "DELETE FROM observations WHERE area_id IN "
                "(SELECT id FROM areas WHERE name LIKE :p)"
            ),
            params,
        )
        await s.execute(
            text(
                "DELETE FROM retrieval_records WHERE area_id IN "
                "(SELECT id FROM areas WHERE name LIKE :p)"
            ),
            params,
        )
        await s.execute(text("DELETE FROM areas WHERE name LIKE :p"), params)
        await s.execute(text("DELETE FROM users WHERE sub LIKE :p"), params)
        await s.commit()


def run_in_rolled_back_session(url: str, work: Callable[[AsyncSession], Awaitable[Any]]) -> Any:
    """Run ``work`` in a fresh event loop; everything it writes is rolled back."""

    async def go() -> Any:
        engine = create_async_engine(
            url, poolclass=NullPool, connect_args={"server_settings": {"timezone": "UTC"}}
        )
        try:
            async with engine.connect() as conn:
                outer = await conn.begin()
                session = AsyncSession(
                    bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
                )
                try:
                    return await work(session)
                finally:
                    await session.close()
                    await outer.rollback()
        finally:
            await engine.dispose()

    return asyncio.run(go())


@dataclass
class Rows:
    """Plain values of stored observations, for comparisons."""

    data: dict[tuple[str, date], tuple[Any, ...]] = field(default_factory=dict)


class FakeWeather:
    """Configured weather provider double returning hourly records or failing."""

    name = "test-weather"
    configured = True

    def __init__(self) -> None:
        from app.integrations.weather.base import WeatherRecord

        self.Record = WeatherRecord
        self.fail: Exception | None = None
        self.delay_s = 0.0
        self.discarded = 0
        self.calls: list[tuple[date, date]] = []
        self.missing_days: set[date] = set()

    async def history(self, lat: float, lon: float, start: date, end: date) -> Any:
        from datetime import UTC, datetime, time, timedelta

        from app.integrations.weather.base import WeatherBatch

        self.calls.append((start, end))
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        if self.fail is not None:
            raise self.fail
        records = []
        day = start
        while day <= end:
            if day not in self.missing_days:
                for hour in (0, 12):
                    records.append(
                        self.Record(
                            observed_at=datetime.combine(day, time(hour), tzinfo=UTC),
                            temperature_c=25.0 + hour / 12,
                            precipitation_mm=0.5,
                            wind_speed_ms=2.0,
                        )
                    )
            day += timedelta(days=1)
        return WeatherBatch(records=records, discarded_values=self.discarded)

    async def probe(self) -> None:
        return None

    async def aclose(self) -> None:
        return None


async def set_setting(key: str, value: str | None) -> None:
    """Set a stored setting (None restores the default)."""
    async with get_sessionmaker()() as s:
        if value is None:
            await s.execute(
                text("UPDATE app_settings SET value = default_value WHERE key = :k"), {"k": key}
            )
        else:
            await s.execute(
                text("UPDATE app_settings SET value = :v WHERE key = :k"), {"k": key, "v": value}
            )
        await s.commit()


class FakeCognito:
    """Cognito admin double: records group calls, can fail or stall on a chosen call."""

    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled
        self.calls: list[tuple[str, str, bool]] = []
        self.fail_on: int | None = None  # index of the call that fails
        self.error: Exception | None = None
        self.delay_s = 0.0

    async def set_group_membership(self, username: str, group: Any, add: bool) -> None:
        index = len(self.calls)
        self.calls.append((username, str(group), add))
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        if self.error is not None and (self.fail_on is None or self.fail_on == index):
            raise self.error
