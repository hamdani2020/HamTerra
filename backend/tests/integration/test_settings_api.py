"""Settings endpoints against the real test database (task 9.3)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select, text

from app.core.config import Settings
from app.core.errors import InternalError
from app.db.models.audit import AuditEvent
from app.db.models.settings import AppSetting
from app.db.session import dispose_engine, get_sessionmaker, init_engine
from app.integrations.cognito.jwks import JwksCache
from app.integrations.cognito.validator import TokenValidator
from app.main import create_app
from app.services import audit
from tests.fixtures.jwt_keys import FAKE_CLIENT_ID, FAKE_ISSUER, FakeKey

KEY = FakeKey("kid-settings")
SUB = "settings-admin-sub"
RESEARCHER_KEYS = {
    "ndvi_diff_threshold",
    "cloud_limit_pct",
    "data_coverage_min_pct",
    "gap_threshold_days",
    "default_page_size",
}


async def _jwks() -> dict[str, Any]:
    return KEY.jwks()


def headers(*groups: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {KEY.make_token(sub=SUB, groups=list(groups))}"}


ADMIN = {"admin"}


async def _reset() -> None:
    async with get_sessionmaker()() as s:
        await s.execute(text("UPDATE app_settings SET value = default_value, updated_by = NULL"))
        await s.commit()


@pytest_asyncio.fixture
async def client(migrated_database_url: str) -> AsyncIterator[httpx.AsyncClient]:
    init_engine(migrated_database_url)
    app = create_app(Settings())
    app.state.token_validator = TokenValidator(
        cache=JwksCache(_jwks), issuer=FAKE_ISSUER, client_id=FAKE_CLIENT_ID
    )
    await _reset()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c
    await _reset()
    await dispose_engine()


async def stored(key: str) -> AppSetting:
    async with get_sessionmaker()() as s:
        return (await s.scalars(select(AppSetting).where(AppSetting.key == key))).one()


async def put(client: httpx.AsyncClient, key: str, value: Any, *groups: str) -> httpx.Response:
    return await client.put(
        f"/api/v1/admin/settings/{key}", json={"value": value}, headers=headers(*(groups or ADMIN))
    )


async def test_researcher_sees_only_permitted_keys(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/settings", headers=headers("researcher"))
    assert r.status_code == 200
    body = r.json()
    assert set(body) == RESEARCHER_KEYS
    assert body == {
        "ndvi_diff_threshold": 0.1,
        "cloud_limit_pct": 20.0,
        "data_coverage_min_pct": 80.0,
        "gap_threshold_days": 30,
        "default_page_size": 50,
    }
    assert "updated_by" not in r.text and "weather" not in r.text


async def test_read_requires_a_role(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/v1/settings")).status_code == 401
    assert (await client.get("/api/v1/settings", headers=headers())).status_code == 403
    assert (await client.get("/api/v1/admin/settings", headers=headers())).status_code == 403


async def test_admin_list_has_all_six_with_metadata(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/admin/settings", headers=headers("admin"))
    items = {i["key"]: i for i in r.json()["items"]}
    assert set(items) == RESEARCHER_KEYS | {"weather_enabled"}
    assert items["gap_threshold_days"] == {
        "key": "gap_threshold_days",
        "value": 30,
        "type": "integer",
        "default": 30,
        "min": 1,
        "max": 3660,
        "updated_by": None,
        "updated_at": items["gap_threshold_days"]["updated_at"],
    }
    assert items["weather_enabled"]["value"] is False
    assert items["weather_enabled"]["min"] is None
    assert items["ndvi_diff_threshold"]["max"] == 2.0


async def test_researcher_cannot_update(client: httpx.AsyncClient) -> None:
    r = await put(client, "cloud_limit_pct", 10, "researcher")
    assert r.status_code == 403
    r = await client.get("/api/v1/admin/settings", headers=headers("researcher"))
    assert r.status_code == 403
    assert (await stored("cloud_limit_pct")).value == "20"


async def test_update_persists_and_is_visible_on_the_next_call(
    client: httpx.AsyncClient,
) -> None:
    r = await put(client, "ndvi_diff_threshold", 0.15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["value"], body["updated_by"], body["default"]) == (0.15, SUB, 0.1)
    assert body["updated_at"].endswith("Z")
    seen = (await client.get("/api/v1/settings", headers=headers("researcher"))).json()
    assert seen["ndvi_diff_threshold"] == 0.15
    assert (await put(client, "weather_enabled", True)).json()["value"] is True
    assert (await stored("weather_enabled")).value == "true"

    async with get_sessionmaker()() as s:
        event = (
            await s.scalars(
                select(AuditEvent)
                .where(AuditEvent.actor_sub == SUB, AuditEvent.target_id == "ndvi_diff_threshold")
                .order_by(AuditEvent.occurred_at.desc())
            )
        ).first()
    assert event is not None
    assert (event.action, event.outcome, event.target_type) == (
        "setting.update",
        "success",
        "setting",
    )
    assert event.details == {
        "setting_key": "ndvi_diff_threshold",
        "old_value": 0.1,
        "new_value": 0.15,
    }


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("ndvi_diff_threshold", 0.0),
        ("ndvi_diff_threshold", 2),
        ("cloud_limit_pct", 100),
        ("data_coverage_min_pct", 0),
        ("gap_threshold_days", 1),
        ("gap_threshold_days", 3660),
        ("default_page_size", 1),
        ("default_page_size", 200),
    ],
)
async def test_boundary_values_are_accepted(
    client: httpx.AsyncClient, key: str, value: float
) -> None:
    assert (await put(client, key, value)).status_code == 200


@pytest.mark.parametrize(
    ("key", "value", "constraint"),
    [
        ("ndvi_diff_threshold", 2.01, "maximum"),
        ("ndvi_diff_threshold", -0.01, "minimum"),
        ("cloud_limit_pct", 100.5, "maximum"),
        ("data_coverage_min_pct", -1, "minimum"),
        ("gap_threshold_days", 0, "minimum"),
        ("gap_threshold_days", 3661, "maximum"),
        ("default_page_size", 0, "minimum"),
        ("default_page_size", 201, "maximum"),
        ("gap_threshold_days", 30.5, "type"),
        ("gap_threshold_days", 30.0, "type"),
        ("cloud_limit_pct", "20", "type"),
        ("cloud_limit_pct", True, "type"),
        ("cloud_limit_pct", None, "type"),
        ("weather_enabled", 1, "type"),
        ("weather_enabled", "true", "type"),
    ],
)
async def test_invalid_values_are_rejected_and_nothing_changes(
    client: httpx.AsyncClient, key: str, value: Any, constraint: str
) -> None:
    before = await stored(key)
    r = await put(client, key, value)
    assert r.status_code == 422
    details = r.json()["error"]["details"]
    assert (details["setting_key"], details["constraint"]) == (key, constraint)
    after = await stored(key)
    assert (after.value, after.updated_by, after.updated_at) == (
        before.value,
        before.updated_by,
        before.updated_at,
    )


@pytest.mark.parametrize("body", [{}, {"value": 1, "extra": 1}, []])
async def test_bad_bodies_are_422(client: httpx.AsyncClient, body: Any) -> None:
    r = await client.put(
        "/api/v1/admin/settings/cloud_limit_pct", json=body, headers=headers("admin")
    )
    assert r.status_code == 422


async def test_unknown_and_secret_like_keys(client: httpx.AsyncClient) -> None:
    r = await put(client, "not_a_setting", 1)
    assert (r.status_code, r.json()["error"]["details"]) == (404, {"reason": "unknown_key"})
    for key in ("agro_api_key", "AGRO_API_KEY", "db_password", "cognito_token", "client_secret"):
        r = await put(client, key, "do-not-store")
        assert r.status_code == 422, key
        assert r.json()["error"]["details"] == {"reason": "key_not_permitted"}
        assert "do-not-store" not in r.text
    async with get_sessionmaker()() as s:
        keys = set((await s.scalars(select(AppSetting.key))).all())
    assert keys == RESEARCHER_KEYS | {"weather_enabled"}


async def test_audit_failure_rolls_back_the_change(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def broken(*_: Any, **__: Any) -> None:
        raise InternalError(details={"reason": "audit_write_failed"})

    monkeypatch.setattr(audit, "record", broken)
    r = await put(client, "cloud_limit_pct", 5)
    assert r.status_code == 500
    row = await stored("cloud_limit_pct")
    assert (row.value, row.updated_by) == ("20", None)


async def test_default_page_size_drives_list_endpoints(client: httpx.AsyncClient) -> None:
    assert (await put(client, "default_page_size", 2)).status_code == 200
    r = await client.get("/api/v1/areas", headers=headers("researcher"))
    assert r.json()["limit"] == 2
    r = await client.get("/api/v1/areas?limit=5", headers=headers("researcher"))
    assert r.json()["limit"] == 5
