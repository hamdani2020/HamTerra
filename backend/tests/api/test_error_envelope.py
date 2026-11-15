"""Property 3: error envelope shape and secrecy (task 16.2). No database needed."""

from __future__ import annotations

import io
import logging
import re
import sys
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from pydantic import BaseModel

from app.core.config import Settings
from app.core.errors import Forbidden, NotFound, Unauthenticated
from app.core.logging import configure_logging
from app.integrations.agro.errors import AgroUpstreamError
from app.main import _secret_values, create_app

logger = logging.getLogger("tests.error_envelope")

KINDS = ("validation", "unauth", "forbidden", "notfound", "upstream", "crash")
EXPECTED = {
    "validation": (422, "VALIDATION_ERROR"),
    "unauth": (401, "UNAUTHENTICATED"),
    "forbidden": (403, "FORBIDDEN"),
    "notfound": (404, "NOT_FOUND"),
    "upstream": (502, "UPSTREAM_ERROR"),
    "crash": (500, "INTERNAL_ERROR"),
}
REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


class Body(BaseModel):
    count: int


def build(secret: str) -> tuple[TestClient, Settings]:
    settings = Settings(
        agro_api_key=secret,
        database_url=f"postgresql+asyncpg://eco:{secret}x@postgis:5432/eco",
        weather_api_key=f"w{secret}",
    )
    app = create_app(settings)
    router = APIRouter(prefix="/e")

    @router.post("/validation")
    async def validation(body: Body) -> dict[str, int]:
        return {"count": body.count}

    @router.get("/unauth")
    async def unauth() -> None:
        logger.info("Authorization: Bearer %s", secret)
        raise Unauthenticated()

    @router.get("/forbidden")
    async def forbidden() -> None:
        raise Forbidden()

    @router.get("/notfound")
    async def notfound() -> None:
        raise NotFound()

    @router.get("/upstream")
    async def upstream() -> None:
        logger.warning("calling https://api.example/x?appid=%s", secret)
        raise AgroUpstreamError()

    @router.get("/crash")
    async def crash() -> None:
        # An exception text that carries SQL and a secret; neither may reach the client.
        raise RuntimeError("SELECT * FROM users WHERE password = " + repr(secret + "x") + secret)  # noqa: S608

    app.include_router(router)
    return TestClient(app, raise_server_exceptions=False), settings


@pytest.fixture
def captured_logs() -> Iterator[io.StringIO]:
    root = logging.getLogger()
    saved_handlers, saved_level = list(root.handlers), root.level
    buffer = io.StringIO()
    real_stdout = sys.stdout
    yield buffer
    sys.stdout = real_stdout
    for handler in list(root.handlers):
        root.removeHandler(handler)
    for handler in saved_handlers:
        root.addHandler(handler)
    root.setLevel(saved_level)


def call(client: TestClient, kind: str) -> Any:
    if kind == "validation":
        return client.post("/e/validation", json={"count": "not-a-number"})
    return client.get(f"/e/{kind}")


@settings(
    max_examples=100, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    secret=st.text(alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789", min_size=16, max_size=32),
    kind=st.sampled_from(KINDS),
)
def test_envelope_shape_and_no_secret(captured_logs: io.StringIO, secret: str, kind: str) -> None:
    client, settings = build(secret)
    buffer = io.StringIO()
    sys.stdout = buffer  # configure_logging writes JSON lines to stdout
    try:
        configure_logging("DEBUG", _secret_values(settings))
        response = call(client, kind)
    finally:
        sys.stdout = sys.__stdout__
    status, code = EXPECTED[kind]
    assert response.status_code == status
    body = response.json()
    assert set(body) == {"error"}
    error = body["error"]
    assert set(error) == {"code", "message", "details", "request_id"}
    assert error["code"] == code
    assert isinstance(error["message"], str) and isinstance(error["details"], dict)
    assert REQUEST_ID.match(error["request_id"])
    assert response.headers["x-request-id"] == error["request_id"]

    text = response.text + "".join(f"{k}: {v}\n" for k, v in response.headers.items())
    logs = buffer.getvalue()
    for value in _secret_values(settings) + [secret]:
        assert value not in text
        assert value not in logs
    assert "Traceback" not in text and "SELECT" not in text
    if kind in ("unauth", "upstream", "crash"):
        assert "[REDACTED]" in logs
