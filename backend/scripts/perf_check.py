"""Performance check (task 16.3, Requirements 11.11, 23.1 to 23.3).

Seeds the test database (``TEST_DATABASE_URL``, default: ``DATABASE_URL`` with database
``eco_test``) with 1000 areas and 500 observations for one area, then measures p95 latency
in-process (ASGI, no network hop) for:

- single-area reads (area detail, observation list, time series): limit 500 ms, 100 requests
- map data for 1000 areas: limit 1000 ms, 100 requests
- report generation for 100 observations: limit 10 s, 20 runs

Reads are measured twice: with a working provider mock and with one that fails every call,
because reads must not depend on the provider. The seeded rows are removed afterwards
(audit rows stay; that table is append-only).

Run inside the backend container:  python scripts/perf_check.py
Exits non-zero when a limit is exceeded.
"""

from __future__ import annotations

import asyncio
import os
import statistics
import sys
import time
import uuid
from collections.abc import Awaitable, Callable
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.engine import make_url  # noqa: E402


def _database_url() -> str:
    explicit = os.environ.get("TEST_DATABASE_URL")
    if explicit:
        return explicit
    url = make_url(os.environ["DATABASE_URL"]).set(database="eco_test")
    return url.render_as_string(hide_password=False)


DB_URL = _database_url()
# Dummy provider and Cognito values: tokens are signed with a local test key.
os.environ.update(
    {
        "COGNITO_USER_POOL_ID": "eu-west-1_dummy",
        "COGNITO_REGION": "eu-west-1",
        "COGNITO_APP_CLIENT_ID": "dummy-client-id",
        "AGRO_API_KEY": "dummy-agro-key",
        "WEATHER_PROVIDER": "none",
        "GHANA_BOUNDARY_PATH": "tests/fixtures/ghana_boundary_small.geojson",
    }
)

import httpx  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db.session import dispose_engine, get_sessionmaker, init_engine  # noqa: E402
from app.integrations.agro.errors import AgroUpstreamError  # noqa: E402
from tests.integration.harness import FakeAgro, auth, make_app  # noqa: E402

TAG = f"perf{uuid.uuid4().hex[:8]}"
READ_LIMIT_MS = 500.0
MAP_LIMIT_MS = 1000.0
REPORT_LIMIT_MS = 10_000.0

_AREAS_SQL = text(
    "INSERT INTO areas (name, geom, area_ha, external_polygon_id) "
    "SELECT :tag || '-' || g, ST_MakeEnvelope("
    "-2.5 + (g % 40) * 0.05, 6 + (g / 40) * 0.05, "
    "-2.5 + (g % 40) * 0.05 + 0.01, 6 + (g / 40) * 0.05 + 0.01, 4326), 120, 'poly' "
    "FROM generate_series(1, 1000) AS g"
)
_OBS_SQL = text(
    "INSERT INTO observations (area_id, source, acquired_on, cloud_coverage, ndvi_mean) "
    "VALUES (:a, :src, :d, :c, :m)"
)
_CLEANUP = (
    "DELETE FROM reports WHERE area_id IN (SELECT id FROM areas WHERE name LIKE :p)",
    "DELETE FROM observations WHERE area_id IN (SELECT id FROM areas WHERE name LIKE :p)",
    "DELETE FROM areas WHERE name LIKE :p",
    "DELETE FROM users WHERE sub LIKE :p",
)


class FailingAgro(FakeAgro):
    async def ndvi_history(self, *a: Any, **k: Any) -> Any:
        raise AgroUpstreamError()

    async def image_search(self, *a: Any, **k: Any) -> Any:
        raise AgroUpstreamError()

    async def fetch_image(self, image_ref: str) -> Any:
        raise AgroUpstreamError()


def p95(samples: list[float]) -> float:
    return statistics.quantiles(samples, n=100, method="inclusive")[94]


async def seed() -> uuid.UUID:
    async with get_sessionmaker()() as s:
        await s.execute(_AREAS_SQL, {"tag": TAG})
        area_id = await s.scalar(text("SELECT id FROM areas WHERE name = :n"), {"n": f"{TAG}-1"})
        rows = [
            {
                "a": area_id,
                "src": "sentinel-2" if i % 2 == 0 else "landsat-8",
                "d": date(2024, 1, 1) + timedelta(days=(i // 2) * 3),
                "c": Decimal(i % 40),
                "m": Decimal("0.5") + Decimal(i % 10) / 100,
            }
            for i in range(500)
        ]
        await s.execute(_OBS_SQL, rows)
        await s.commit()
        return uuid.UUID(str(area_id))


async def cleanup() -> None:
    async with get_sessionmaker()() as s:
        for statement in _CLEANUP:
            await s.execute(text(statement), {"p": f"{TAG}-%"})
        await s.commit()


async def measure(runs: int, request: Callable[[], Awaitable[httpx.Response]]) -> float:
    first = await request()  # warm-up, also checks the call works
    first.raise_for_status()
    samples: list[float] = []
    for _ in range(runs):
        started = time.perf_counter()
        response = await request()
        samples.append((time.perf_counter() - started) * 1000)
        response.raise_for_status()
    return p95(samples)


async def run_reads(
    agro: FakeAgro, area_id: uuid.UUID, label: str
) -> list[tuple[str, float, float]]:
    headers = auth(f"{TAG}-reader", "researcher")
    results: list[tuple[str, float, float]] = []
    transport = httpx.ASGITransport(app=make_app(agro))
    async with httpx.AsyncClient(transport=transport, base_url="http://perf") as client:
        base = f"/api/v1/areas/{area_id}"
        checks: list[tuple[str, str, dict[str, Any], float]] = [
            ("area detail", base, {}, READ_LIMIT_MS),
            ("observation list", f"{base}/observations", {"limit": 200}, READ_LIMIT_MS),
            ("time series", f"{base}/ndvi/timeseries", {"source": "sentinel-2"}, READ_LIMIT_MS),
            ("map data (1000 areas)", "/api/v1/areas/map", {}, MAP_LIMIT_MS),
        ]
        for name, url, params, limit in checks:

            async def call(url: str = url, params: dict[str, Any] = params) -> httpx.Response:
                return await client.get(url, params=params, headers=headers)

            results.append((f"{name} [{label}]", await measure(100, call), limit))
    return results


async def run_reports(area_id: uuid.UUID) -> tuple[str, float, float]:
    headers = auth(f"{TAG}-author", "researcher")
    body = {
        "area_id": str(area_id),
        "source": "sentinel-2",
        # 100 Sentinel-2 observations, 3 days apart from 2024-01-01.
        "date_from": "2024-01-01",
        "date_to": (date(2024, 1, 1) + timedelta(days=297)).isoformat(),
    }
    transport = httpx.ASGITransport(app=make_app(FakeAgro()))
    async with httpx.AsyncClient(transport=transport, base_url="http://perf") as client:

        async def call() -> httpx.Response:
            return await client.post("/api/v1/reports", json=body, headers=headers)

        return ("report, 100 observations", await measure(20, call), REPORT_LIMIT_MS)


async def main() -> int:
    init_engine(DB_URL)
    try:
        area_id = await seed()
        results = await run_reads(FakeAgro(), area_id, "provider ok")
        results += await run_reads(FailingAgro(), area_id, "provider failing")
        results.append(await run_reports(area_id))
    finally:
        await cleanup()
        await dispose_engine()
    failed = False
    print(f"{'check':45} {'p95 ms':>10} {'limit ms':>10}")
    for name, value, limit in results:
        marker = "" if value <= limit else "  EXCEEDED"
        failed = failed or value > limit
        print(f"{name:45} {value:10.1f} {limit:10.0f}{marker}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
