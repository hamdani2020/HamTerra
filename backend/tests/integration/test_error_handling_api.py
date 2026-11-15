"""Error envelope on real endpoints and a scan for configured secrets (task 16.2)."""

from __future__ import annotations

import io
import logging
import sys
import uuid
from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx
import pytest
import pytest_asyncio

from app.core.config import Settings
from app.core.logging import configure_logging
from app.db.session import dispose_engine, get_sessionmaker, init_engine
from app.integrations.agro.errors import AgroUpstreamError
from app.main import _secret_values
from app.services import areas as area_service
from tests.fixtures.jwt_keys import FakeKey
from tests.integration.harness import (
    KEY,
    FakeAgro,
    auth,
    insert_area,
    make_app,
    purge_tagged,
)

SECRETS = [*_secret_values(Settings())]


@pytest.fixture
def logs() -> Iterator[io.StringIO]:
    root = logging.getLogger()
    saved, level = list(root.handlers), root.level
    buffer = io.StringIO()
    real = sys.stdout
    sys.stdout = buffer
    try:
        configure_logging("DEBUG", SECRETS + [KEY.make_token(sub="probe")])
    finally:
        sys.stdout = real
    yield buffer
    for handler in list(root.handlers):
        root.removeHandler(handler)
    for handler in saved:
        root.addHandler(handler)
    root.setLevel(level)


@pytest_asyncio.fixture
async def client(migrated_database_url: str) -> AsyncIterator[tuple[httpx.AsyncClient, Any, str]]:
    init_engine(migrated_database_url)
    agro = FakeAgro()
    tag = f"err{uuid.uuid4().hex[:8]}"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=make_app(agro), raise_app_exceptions=False),
        base_url="http://test",
    ) as c:
        yield c, agro, tag
    await purge_tagged(tag)
    await dispose_engine()


def assert_envelope(response: httpx.Response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    body = response.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message", "details", "request_id"}
    assert body["error"]["code"] == code
    assert response.headers["x-request-id"] == body["error"]["request_id"]


async def test_envelopes_and_secret_scan(
    client: tuple[httpx.AsyncClient, Any, str], logs: io.StringIO, monkeypatch: pytest.MonkeyPatch
) -> None:
    c, agro, tag = client
    researcher = auth(f"{tag}-u", "researcher")
    responses: list[httpx.Response] = []

    r = await c.get("/api/v1/areas", params={"bbox": "1,2,3"}, headers=researcher)
    assert_envelope(r, 422, "VALIDATION_ERROR")
    assert r.json()["error"]["details"]["fields"][0]["field"] == "bbox"
    responses.append(r)

    bad_signature = FakeKey(KEY.kid).make_token(sub=f"{tag}-u", groups=["admin"])
    r = await c.get("/api/v1/me", headers={"Authorization": f"Bearer {bad_signature}"})
    assert_envelope(r, 401, "UNAUTHENTICATED")
    assert r.headers["www-authenticate"] == "Bearer"
    responses.append(r)

    r = await c.get("/api/v1/admin/dashboard", headers=researcher)
    assert_envelope(r, 403, "FORBIDDEN")
    responses.append(r)

    r = await c.get(f"/api/v1/areas/{uuid.uuid4()}", headers=researcher)
    assert_envelope(r, 404, "NOT_FOUND")
    responses.append(r)

    async with get_sessionmaker()() as s:
        area = await insert_area(s, f"{tag}-area")
        await s.commit()
    agro.fail = {
        "sentinel-2": AgroUpstreamError(status=503),
        "landsat-8": AgroUpstreamError(status=503),
    }
    r = await c.post(
        f"/api/v1/areas/{area.id}/observations/refresh",
        json={"date_from": "2026-01-01", "date_to": "2026-01-31"},
        headers=researcher,
    )
    assert_envelope(r, 502, "UPSTREAM_ERROR")
    responses.append(r)

    secret = SECRETS[0]

    async def explode(*_: Any, **__: Any) -> Any:
        raise RuntimeError(f"connection failed for {secret} running SELECT 1")

    monkeypatch.setattr(area_service, "list_areas", explode)
    r = await c.get("/api/v1/areas", headers=researcher)
    assert_envelope(r, 500, "INTERNAL_ERROR")
    responses.append(r)

    captured = logs.getvalue()
    assert "unhandled_exception" in captured
    for response in responses:
        text = response.text + str(dict(response.headers))
        assert "Traceback" not in text and "SELECT" not in text
        for value in SECRETS:
            assert value not in text
    for value in SECRETS:
        assert value not in captured
    assert researcher["Authorization"].split()[1] not in captured
