from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

from app.core.errors import (
    ErrorCode,
    Forbidden,
    PayloadTooLarge,
    ServiceUnavailable,
    Unauthenticated,
    register_exception_handlers,
)
from app.core.logging import request_id_var


class _Orig(Exception):
    def __init__(self, sqlstate: str) -> None:
        super().__init__("constraint uq_secret_name violated")
        self.sqlstate = sqlstate


class _Body(BaseModel):
    name: str
    count: int


def _make_app() -> FastAPI:
    app = FastAPI()
    register_exception_handlers(app)

    @app.post("/validate")
    async def validate(body: _Body) -> None:  # pragma: no cover - body only validated
        return None

    @app.get("/unauth")
    async def unauth() -> None:
        raise Unauthenticated()

    @app.get("/forbidden")
    async def forbidden() -> None:
        raise Forbidden(details={"permission": "areas:write"})

    @app.get("/big")
    async def big() -> None:
        raise PayloadTooLarge()

    @app.get("/unavailable")
    async def unavailable() -> None:
        raise ServiceUnavailable()

    @app.get("/http")
    async def http() -> None:
        raise HTTPException(status_code=404, detail="internal path /srv/x")

    @app.get("/integrity/{state}")
    async def integrity(state: str) -> None:
        raise IntegrityError("SELECT password FROM users", {"p": "s3cret"}, _Orig(state))

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("password=hunter2 SELECT * FROM t")

    return app


@pytest.fixture
def client() -> TestClient:
    return TestClient(_make_app(), raise_server_exceptions=False)


def _error(resp: Any) -> dict[str, Any]:
    body = resp.json()
    assert set(body) == {"error"}
    err: dict[str, Any] = body["error"]
    assert set(err) == {"code", "message", "details", "request_id"}
    return err


def test_401_has_www_authenticate(client: TestClient) -> None:
    resp = client.get("/unauth")
    assert resp.status_code == 401
    assert resp.headers["www-authenticate"] == "Bearer"
    assert _error(resp)["code"] == ErrorCode.UNAUTHENTICATED


def test_app_error_details_and_codes(client: TestClient) -> None:
    resp = client.get("/forbidden")
    assert resp.status_code == 403
    assert _error(resp)["details"] == {"permission": "areas:write"}
    assert client.get("/big").status_code == 413
    assert _error(client.get("/unavailable"))["code"] == "SERVICE_UNAVAILABLE"


def test_validation_lists_fields_without_input_values(client: TestClient) -> None:
    resp = client.post("/validate", json={"name": 5, "count": "leaky-value"})
    assert resp.status_code == 422
    err = _error(resp)
    assert err["code"] == "VALIDATION_ERROR"
    fields = {f["field"]: f["reason"] for f in err["details"]["fields"]}
    assert set(fields) == {"name", "count"}
    assert all(fields.values())
    assert "leaky-value" not in resp.text


def test_http_exception_does_not_echo_detail(client: TestClient) -> None:
    resp = client.get("/http")
    assert resp.status_code == 404
    assert _error(resp)["code"] == "NOT_FOUND"
    assert "/srv/x" not in resp.text
    assert _error(client.get("/missing-route"))["code"] == "NOT_FOUND"


def test_integrity_error_mapping_hides_sql(client: TestClient) -> None:
    unique = client.get("/integrity/23505")
    assert unique.status_code == 409
    assert _error(unique)["details"] == {"constraint_type": "unique"}
    for state, kind in (("23514", "check"), ("23503", "foreign_key")):
        resp = client.get(f"/integrity/{state}")
        assert resp.status_code == 422
        assert _error(resp)["details"] == {"constraint_type": kind}
        assert "SELECT" not in resp.text
        assert "s3cret" not in resp.text
        assert "uq_secret_name" not in resp.text


def test_catch_all_500_is_generic_and_carries_request_id(client: TestClient) -> None:
    token = request_id_var.set("req-123")
    try:
        resp = client.get("/boom")
    finally:
        request_id_var.reset(token)
    assert resp.status_code == 500
    err = _error(resp)
    assert err["code"] == "INTERNAL_ERROR"
    assert err["request_id"] == "req-123"
    assert "hunter2" not in resp.text
    assert "Traceback" not in resp.text
