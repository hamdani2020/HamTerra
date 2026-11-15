"""Shared helpers for API integration tests: fake provider, app builder, DB helpers."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

import httpx
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
        return NormalizedBatch(items=list(self.images.get(source, [])))

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


def make_app(agro: Any) -> Any:
    app = create_app(Settings())
    app.state.token_validator = TokenValidator(
        cache=JwksCache(_jwks), issuer=FAKE_ISSUER, client_id=FAKE_CLIENT_ID
    )
    app.state.agro_client = agro
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
