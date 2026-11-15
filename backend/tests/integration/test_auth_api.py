"""Guard and ``/me`` tests against the real test database (task 5.9)."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
import pytest_asyncio
from fastapi import APIRouter, Depends, FastAPI
from sqlalchemy import delete, func, select

from app.api import deps
from app.api.deps import guard
from app.core.config import Settings
from app.core.permissions import Permission
from app.core.security import Principal
from app.db.models.audit import AuditEvent
from app.db.models.users import User
from app.db.session import dispose_engine, get_sessionmaker, init_engine
from app.integrations.cognito.jwks import JwksCache
from app.integrations.cognito.validator import TokenValidator
from app.main import create_app
from app.services import audit
from tests.fixtures.jwt_keys import FAKE_CLIENT_ID, FAKE_ISSUER, FakeKey

KEY = FakeKey("kid-int")

probe = APIRouter()


@probe.get("/probe/researcher")
async def researcher_only(
    p: Principal = Depends(guard(Permission.AREAS_READ)),  # noqa: B008
) -> dict[str, str]:
    return {"sub": p.sub}


@probe.get("/probe/admin")
async def admin_only(
    p: Principal = Depends(guard(Permission.USERS_READ)),  # noqa: B008
) -> dict[str, str]:
    return {"sub": p.sub}


async def _jwks() -> dict[str, Any]:
    return KEY.jwks()


def _app(migrated_database_url: str) -> FastAPI:
    app = create_app(Settings())
    app.include_router(probe)
    app.state.token_validator = TokenValidator(
        cache=JwksCache(_jwks), issuer=FAKE_ISSUER, client_id=FAKE_CLIENT_ID
    )
    return app


@pytest_asyncio.fixture
async def client(migrated_database_url: str) -> AsyncIterator[httpx.AsyncClient]:
    init_engine(migrated_database_url)
    app = _app(migrated_database_url)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    await dispose_engine()


@pytest_asyncio.fixture
async def sub() -> AsyncIterator[str]:
    # audit_events is append-only; its rows stay in the throwaway test database.
    value = f"test-{uuid.uuid4()}"
    yield value
    async with get_sessionmaker()() as session:
        await session.execute(delete(User).where(User.sub == value))
        await session.commit()


def auth(sub: str, groups: list[str] | None, **kw: Any) -> dict[str, str]:
    return {"Authorization": f"Bearer {KEY.make_token(sub=sub, groups=groups, **kw)}"}


async def test_me_without_role_and_without_email(client: httpx.AsyncClient, sub: str) -> None:
    r = await client.get("/api/v1/me", headers=auth(sub, None))
    assert r.status_code == 200
    body = r.json()
    assert body == {
        "sub": sub,
        "username": sub,
        "email": None,
        "roles": [],
        "permissions": [],
    }


async def test_me_for_researcher_and_admin(client: httpx.AsyncClient, sub: str) -> None:
    r = await client.get("/api/v1/me", headers=auth(sub, ["researcher", "ignored"]))
    body = r.json()
    assert body["roles"] == ["researcher"]
    assert "areas:read" in body["permissions"]
    assert "users:read" not in body["permissions"]
    r = await client.get("/api/v1/me", headers=auth(sub, ["admin"], overrides={"email": "a@x.org"}))
    body = r.json()
    assert body["roles"] == ["admin"]
    assert body["email"] == "a@x.org"
    assert "users:read" in body["permissions"]
    assert "areas:read" in body["permissions"]


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Basic abc"},
        {"Authorization": "Bearer"},
        {"Authorization": "Bearer a b"},
        {"Authorization": "Bearer not-a-jwt"},
    ],
)
async def test_me_401_without_user_data(client: httpx.AsyncClient, headers: dict[str, str]) -> None:
    r = await client.get("/api/v1/me", headers=headers)
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"
    assert set(r.json()) == {"error"}
    assert r.json()["error"]["code"] == "UNAUTHENTICATED"


async def test_expired_and_id_tokens_get_401_and_no_user_row(
    client: httpx.AsyncClient, sub: str
) -> None:
    for kw in ({"expires_in": -10}, {"token_use": "id"}):
        r = await client.get("/api/v1/me", headers=auth(sub, ["admin"], **kw))
        assert r.status_code == 401
    async with get_sessionmaker()() as session:
        assert await session.scalar(select(func.count()).where(User.sub == sub)) == 0


async def test_guard_403_for_insufficient_role_and_no_group(
    client: httpx.AsyncClient, sub: str
) -> None:
    for groups in (None, [], ["unknown"], ["Admin"]):
        r = await client.get("/probe/researcher", headers=auth(sub, groups))
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "FORBIDDEN"
    r = await client.get("/probe/admin", headers=auth(sub, ["researcher"]))
    assert r.status_code == 403


async def test_admin_satisfies_researcher(client: httpx.AsyncClient, sub: str) -> None:
    assert (await client.get("/probe/researcher", headers=auth(sub, ["admin"]))).status_code == 200
    assert (await client.get("/probe/admin", headers=auth(sub, ["admin"]))).status_code == 200
    assert (
        await client.get("/probe/researcher", headers=auth(sub, ["researcher"]))
    ).status_code == 200


async def test_denied_event_is_written(client: httpx.AsyncClient, sub: str) -> None:
    r = await client.get("/probe/admin", headers=auth(sub, ["researcher"]))
    assert r.status_code == 403
    async with get_sessionmaker()() as session:
        event = (await session.scalars(select(AuditEvent).where(AuditEvent.actor_sub == sub))).one()
    assert event.outcome == "denied"
    assert event.details["method"] == "GET"
    assert event.details["endpoint"] == "/probe/admin"
    assert event.details["required_role"] == "admin"
    assert event.occurred_at is not None


async def test_403_still_returned_when_audit_write_fails(
    client: httpx.AsyncClient, sub: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def broken(**_: Any) -> bool:
        raise RuntimeError("audit down")

    # Simulates the worst case: even the "never raises" helper blows up.
    monkeypatch.setattr(audit, "record_separately", broken)
    r = await client.get("/probe/admin", headers=auth(sub, ["researcher"]))
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "FORBIDDEN"


async def test_403_when_audit_database_write_fails(
    client: httpx.AsyncClient, sub: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_sessionmaker() -> Any:
        raise RuntimeError("no engine")

    monkeypatch.setattr(audit, "get_sessionmaker", no_sessionmaker)
    r = await client.get("/probe/admin", headers=auth(sub, ["researcher"]))
    assert r.status_code == 403


async def test_concurrent_first_requests_create_one_user(
    client: httpx.AsyncClient, sub: str
) -> None:
    responses = await asyncio.gather(
        *(client.get("/api/v1/me", headers=auth(sub, ["researcher"])) for _ in range(10))
    )
    assert {r.status_code for r in responses} == {200}
    async with get_sessionmaker()() as session:
        assert await session.scalar(select(func.count()).where(User.sub == sub)) == 1


async def test_roles_follow_the_current_token(client: httpx.AsyncClient, sub: str) -> None:
    assert (await client.get("/probe/admin", headers=auth(sub, ["admin"]))).status_code == 200
    assert (await client.get("/probe/admin", headers=auth(sub, ["researcher"]))).status_code == 403
    async with get_sessionmaker()() as session:
        user = (await session.scalars(select(User).where(User.sub == sub))).one()
    assert user.roles == ["researcher"]


async def test_email_kept_when_token_has_none(client: httpx.AsyncClient, sub: str) -> None:
    await client.get("/api/v1/me", headers=auth(sub, ["admin"], overrides={"email": "a@x.org"}))
    await client.get("/api/v1/me", headers=auth(sub, ["admin"]))
    async with get_sessionmaker()() as session:
        user = (await session.scalars(select(User).where(User.sub == sub))).one()
    assert user.email == "a@x.org"


def test_guard_metadata() -> None:
    dependency = guard(Permission.USERS_READ)
    assert dependency.permission is Permission.USERS_READ  # type: ignore[attr-defined]
    assert deps.guard_metadata(dependency) is not None
    assert deps.guard_metadata(lambda: None) is None
