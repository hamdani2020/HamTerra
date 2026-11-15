"""Tests for the application factory and the ASGI middleware (task 2.6)."""

from __future__ import annotations

import sys
import types
from collections.abc import Iterator

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app, discover_routers


def make_settings(**overrides: object) -> Settings:
    return Settings(**overrides)  # type: ignore[arg-type]


def make_client(settings: Settings | None = None) -> TestClient:
    app = create_app(settings or make_settings())
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def fake_routers(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    import app.api.routers as pkg

    for name, path in (("health", "/health/live"), ("things", "/things")):
        router = APIRouter()

        @router.get(path)
        async def handler() -> dict[str, str]:
            return {"ok": "yes"}

        @router.post("/echo" if name == "things" else "/health/echo")
        async def echo(payload: dict[str, str]) -> dict[str, str]:
            return payload

        mod = types.ModuleType(f"app.api.routers.{name}")
        mod.router = router  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, mod.__name__, mod)
        monkeypatch.setattr(pkg, name, mod, raising=False)

    import pkgutil

    real = pkgutil.iter_modules

    def fake_iter(path: object) -> Iterator[pkgutil.ModuleInfo]:
        yield from real(path)  # type: ignore[arg-type]
        for n in ("health", "things"):
            yield pkgutil.ModuleInfo(None, n, False)  # type: ignore[arg-type]

    monkeypatch.setattr("app.main.pkgutil.iter_modules", fake_iter)
    yield


def test_discovery_finds_health_and_openapi_is_served() -> None:
    assert [name for name, _ in discover_routers()] == [
        "admin_areas",
        "admin_ops",
        "admin_settings",
        "admin_users",
        "areas",
        "comparisons",
        "health",
        "me",
        "observations",
        "reports",
        "settings",
        "timeseries",
    ]
    client = make_client()
    assert client.get("/api/v1/openapi.json").status_code == 200
    assert isinstance(client.app, FastAPI)


def test_router_discovery_mounts_health_at_root_and_others_versioned(
    fake_routers: None,
) -> None:
    client = make_client()
    assert client.get("/health/live").status_code == 200
    assert client.get("/api/v1/things").status_code == 200
    assert client.get("/things").status_code == 404


def test_request_id_echoed_when_valid() -> None:
    resp = make_client().get("/missing", headers={"X-Request-ID": "abc_DEF-123"})
    assert resp.status_code == 404
    assert resp.headers["x-request-id"] == "abc_DEF-123"
    assert resp.json()["error"]["request_id"] == "abc_DEF-123"


@pytest.mark.parametrize("bad", ["has space", "a" * 129, "semi;colon"])
def test_request_id_replaced_when_invalid(bad: str) -> None:
    resp = make_client().get("/missing", headers={"X-Request-ID": bad})
    rid = resp.headers["x-request-id"]
    assert rid != bad
    assert len(rid) == 32 and int(rid, 16) >= 0


def test_unhandled_error_still_has_request_id(fake_routers: None) -> None:
    app = create_app(make_settings())

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("secret detail")

    resp = TestClient(app, raise_server_exceptions=False).get("/boom")
    assert resp.status_code == 500
    assert resp.headers["x-request-id"]
    assert "secret detail" not in resp.text


def test_body_limit_content_length(fake_routers: None) -> None:
    client = make_client(make_settings(max_body_bytes=1024))
    resp = client.post("/api/v1/echo", content=b"x" * 2000)
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"
    assert resp.headers["x-request-id"]


def test_body_limit_chunked(fake_routers: None) -> None:
    client = make_client(make_settings(max_body_bytes=1024))

    def chunks() -> Iterator[bytes]:
        for _ in range(4):
            yield b"x" * 600

    resp = client.post("/api/v1/echo", content=chunks())
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"
    assert resp.headers["x-request-id"]


def test_cors_absent_when_no_origins() -> None:
    resp = make_client().get("/api/v1/openapi.json", headers={"Origin": "http://a.example"})
    assert "access-control-allow-origin" not in resp.headers


def test_cors_enabled_for_listed_origin() -> None:
    client = make_client(make_settings(allowed_origins="http://a.example"))
    resp = client.get("/api/v1/openapi.json", headers={"Origin": "http://a.example"})
    assert resp.headers["access-control-allow-origin"] == "http://a.example"
