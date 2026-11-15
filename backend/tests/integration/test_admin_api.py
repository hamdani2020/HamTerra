"""Admin users, roles and operations against PostGIS (tasks 15.2 and 15.5)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
import pytest_asyncio
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from sqlalchemy import delete, select, text, update

from app.core.config import Settings
from app.core.errors import (
    CognitoAdminNotEnabled,
    LastAdmin,
    SelfRoleChange,
    UpstreamError,
    UpstreamTimeout,
)
from app.core.security import Principal, Role
from app.db.models.audit import AuditEvent
from app.db.models.retrievals import RetrievalRecord
from app.db.models.users import User
from app.db.session import dispose_engine, get_sessionmaker, init_engine
from app.integrations.agro.errors import AgroTimeoutError, AgroUpstreamError
from app.integrations.cognito import admin as cognito_admin
from app.services import admin_ops
from app.services import users as user_service
from tests.integration.harness import (
    FakeAgro,
    FakeCognito,
    FakeWeather,
    auth,
    insert_area,
    make_app,
    purge_tagged,
    run_in_rolled_back_session,
)

PROVIDER_KEY = Settings().agro_api_key.get_secret_value()


class ProbingAgro(FakeAgro):
    def __init__(self) -> None:
        super().__init__()
        self.probe_error: Exception | None = None
        self.probes = 0

    async def probe(self) -> None:
        self.probes += 1
        if self.probe_error is not None:
            raise self.probe_error


@dataclass
class Ctx:
    client: httpx.AsyncClient
    cognito: FakeCognito
    agro: ProbingAgro
    weather: FakeWeather
    tag: str

    def sub(self, name: str) -> str:
        return f"{self.tag}-{name}"

    def h(self, name: str, *groups: str) -> dict[str, str]:
        return auth(self.sub(name), *groups)

    @property
    def admin(self) -> dict[str, str]:
        return self.h("root", "admin")

    async def touch(self, name: str, *groups: str) -> None:
        """Create the user's local row by calling /me with their token."""
        r = await self.client.get("/api/v1/me", headers=self.h(name, *groups))
        assert r.status_code == 200

    async def put_roles(self, name: str, roles: list[str], as_: str = "root") -> httpx.Response:
        return await self.client.put(
            f"/api/v1/admin/users/{self.sub(name)}/roles",
            json={"roles": roles},
            headers=self.h(as_, "admin"),
        )

    async def stored_roles(self, name: str) -> list[str]:
        async with get_sessionmaker()() as s:
            return list(await s.scalar(select(User.roles).where(User.sub == self.sub(name))) or [])

    async def events(self, target: str) -> list[AuditEvent]:
        async with get_sessionmaker()() as s:
            return list(
                (
                    await s.scalars(
                        select(AuditEvent)
                        .where(
                            AuditEvent.action == "role.change",
                            AuditEvent.target_id == self.sub(target),
                        )
                        .order_by(AuditEvent.occurred_at)
                    )
                ).all()
            )


@pytest_asyncio.fixture
async def ctx(migrated_database_url: str) -> AsyncIterator[Ctx]:
    init_engine(migrated_database_url)
    tag = f"adm{uuid.uuid4().hex[:10]}"
    cognito, agro, weather = FakeCognito(), ProbingAgro(), FakeWeather()
    app = make_app(agro, weather, cognito)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        c = Ctx(client, cognito, agro, weather, tag)
        await c.touch("root", "admin")
        yield c
    async with get_sessionmaker()() as s:
        await s.execute(delete(RetrievalRecord).where(RetrievalRecord.kind == "probe"))
        await s.commit()
    await purge_tagged(tag)
    await dispose_engine()


# --- users and roles ------------------------------------------------------------------


async def test_list_and_get_users(ctx: Ctx) -> None:
    await ctx.touch("ana", "researcher")
    await ctx.touch("ben")
    r = await ctx.client.get("/api/v1/admin/users", params={"q": ctx.tag}, headers=ctx.admin)
    body = r.json()
    assert (body["total"], body["limit"], body["offset"]) == (3, 50, 0)
    assert {u["sub"] for u in body["items"]} == {ctx.sub("root"), ctx.sub("ana"), ctx.sub("ben")}
    assert set(body["items"][0]) == {"sub", "username", "email", "roles", "status", "last_seen_at"}
    only = await ctx.client.get(
        "/api/v1/admin/users", params={"q": ctx.tag, "role": "researcher"}, headers=ctx.admin
    )
    assert [u["sub"] for u in only.json()["items"]] == [ctx.sub("ana")]
    one = await ctx.client.get(f"/api/v1/admin/users/{ctx.sub('ana')}", headers=ctx.admin)
    assert one.json()["roles"] == ["researcher"]
    missing = await ctx.client.get(f"/api/v1/admin/users/{ctx.sub('nobody')}", headers=ctx.admin)
    assert missing.status_code == 404
    for limit in (0, 101):
        r = await ctx.client.get("/api/v1/admin/users", params={"limit": limit}, headers=ctx.admin)
        assert r.status_code == 422
    assert "token" not in r.text.lower()


async def test_role_change_success(ctx: Ctx) -> None:
    await ctx.touch("ana", "researcher")
    r = await ctx.put_roles("ana", ["admin", "researcher"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["roles"] == ["admin", "researcher"]
    assert body["effective_after_next_login"] is True
    assert "new token" in body["message"]
    assert ctx.cognito.calls == [(ctx.sub("ana"), "admin", True)]
    assert await ctx.stored_roles("ana") == ["admin", "researcher"]
    (event,) = await ctx.events("ana")
    assert event.outcome == "success" and event.actor_sub == ctx.sub("root")
    assert event.details["changes"] == [{"group": "admin", "action": "add"}]

    r = await ctx.put_roles("ana", [])
    assert r.json()["roles"] == []
    assert ctx.cognito.calls[1:] == [
        (ctx.sub("ana"), "admin", False),
        (ctx.sub("ana"), "researcher", False),
    ]


async def test_no_change_makes_no_call(ctx: Ctx) -> None:
    await ctx.touch("ana", "researcher")
    r = await ctx.put_roles("ana", ["researcher", "researcher"])
    assert r.status_code == 200 and r.json()["roles"] == ["researcher"]
    assert ctx.cognito.calls == []


@pytest.mark.parametrize(
    ("error", "status"),
    [(UpstreamError(), 502), (UpstreamTimeout(), 504), (CognitoAdminNotEnabled(), 501)],
)
async def test_cognito_failure_keeps_roles(ctx: Ctx, error: Exception, status: int) -> None:
    await ctx.touch("ana", "researcher")
    ctx.cognito.error = error
    ctx.cognito.fail_on = 1  # the second call fails after the first was applied
    r = await ctx.put_roles("ana", ["admin"])
    assert r.status_code == status
    assert await ctx.stored_roles("ana") == ["researcher"]
    # The applied add of admin was reversed so Cognito matches the local roles again.
    assert ctx.cognito.calls[-1] == (ctx.sub("ana"), "admin", False)
    (event,) = await ctx.events("ana")
    assert event.outcome == "failure"


async def test_real_client_timeout_is_10_seconds(monkeypatch: pytest.MonkeyPatch) -> None:
    assert cognito_admin.COGNITO_TIMEOUT_S == 10.0
    client = cognito_admin.BotoCognitoAdmin(Settings(cognito_admin_enabled=True), timeout_s=0.05)

    def slow(*_: Any) -> None:
        import time

        time.sleep(0.5)

    monkeypatch.setattr(client, "_call", slow)
    with pytest.raises(UpstreamTimeout):
        await client.set_group_membership("u", Role.admin, True)


async def test_not_enabled_is_501_and_reads_work(ctx: Ctx, migrated_database_url: str) -> None:
    await ctx.touch("ana", "researcher")
    app = make_app(ProbingAgro(), FakeWeather(), cognito_admin.DisabledCognitoAdmin())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        r = await c.put(
            f"/api/v1/admin/users/{ctx.sub('ana')}/roles",
            json={"roles": ["admin"]},
            headers=ctx.admin,
        )
        assert (r.status_code, r.json()["error"]["code"]) == (501, "COGNITO_ADMIN_NOT_ENABLED")
        assert (await c.get("/api/v1/admin/users", headers=ctx.admin)).status_code == 200
    assert await ctx.stored_roles("ana") == ["researcher"]


async def test_self_change_and_unknown_user(ctx: Ctx) -> None:
    r = await ctx.put_roles("root", ["researcher"])
    assert (r.status_code, r.json()["error"]["code"]) == (409, "SELF_ROLE_CHANGE")
    r = await ctx.put_roles("ghost", ["admin"])
    assert r.status_code == 404
    assert ctx.cognito.calls == []


async def isolate_admins(session: Any) -> None:
    """Inside the rolled-back transaction, drop admin from every other user so the test's
    users are the whole user set. Rows left by other tests would otherwise count."""
    await session.execute(text("UPDATE users SET roles = array_remove(roles, 'admin')"))


def test_last_admin_is_kept(migrated_database_url: str) -> None:
    """Through the API the caller's own row always holds admin (it is synced from the token),
    so the guard is exercised at the service level with a caller that has no local row."""

    async def work(session: Any) -> None:
        await isolate_admins(session)
        session.add(User(sub="p-last-admin", username="p-last-admin", roles=["admin"]))
        await session.flush()
        cognito = FakeCognito()
        caller = Principal("p-elsewhere", "p-elsewhere", None, frozenset({Role.admin}))
        with pytest.raises(LastAdmin):
            await user_service.change_roles(
                session, cognito, caller, "p-last-admin", [Role.researcher]
            )
        assert cognito.calls == []
        stored = await session.scalar(select(User.roles).where(User.sub == "p-last-admin"))
        assert stored == ["admin"]

    run_in_rolled_back_session(migrated_database_url, work)


@pytest.mark.parametrize(
    "body", [{"roles": ["owner"]}, {"roles": ["admin"], "sub": "x"}, {}, {"roles": "admin"}]
)
async def test_invalid_role_bodies(ctx: Ctx, body: dict[str, Any]) -> None:
    await ctx.touch("ana", "researcher")
    r = await ctx.client.put(
        f"/api/v1/admin/users/{ctx.sub('ana')}/roles", json=body, headers=ctx.admin
    )
    assert r.status_code == 422


async def test_roles_in_non_admin_bodies_are_rejected(ctx: Ctx) -> None:
    r = await ctx.client.post(
        "/api/v1/reports",
        json={
            "area_id": str(uuid.uuid4()),
            "source": "sentinel-2",
            "date_from": "2026-01-01",
            "date_to": "2026-01-02",
            "roles": ["admin"],
        },
        headers=ctx.h("ana", "researcher"),
    )
    assert r.status_code == 422
    assert "roles" in [f["field"] for f in r.json()["error"]["details"]["fields"]]


async def test_researcher_gets_403_on_every_admin_route(ctx: Ctx) -> None:
    researcher = ctx.h("ana", "researcher")
    calls = [
        ("GET", "/api/v1/admin/users"),
        ("GET", f"/api/v1/admin/users/{ctx.sub('root')}"),
        ("PUT", f"/api/v1/admin/users/{ctx.sub('root')}/roles"),
        ("GET", "/api/v1/admin/retrievals"),
        ("GET", "/api/v1/admin/integrations/status?probe=true"),
        ("GET", "/api/v1/admin/activity"),
        ("GET", "/api/v1/admin/dashboard"),
    ]
    for method, url in calls:
        r = await ctx.client.request(method, url, json={"roles": ["admin"]}, headers=researcher)
        assert r.status_code == 403, url
    assert ctx.agro.probes == 0 and ctx.cognito.calls == []
    assert await ctx.stored_roles("root") == ["admin"]


# --- Property 31 ------------------------------------------------------------------


@settings(
    max_examples=100, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    initial=st.lists(
        st.frozensets(st.sampled_from(["admin", "researcher"])), min_size=1, max_size=4
    ),
    requests=st.lists(
        st.tuples(
            st.integers(0, 3),
            st.integers(0, 3),
            st.frozensets(st.sampled_from([Role.admin, Role.researcher])),
        ),
        max_size=8,
    ),
)
def test_admin_count_never_reaches_zero(
    migrated_database_url: str, initial: list[frozenset[str]], requests: list[Any]
) -> None:
    if not any("admin" in roles for roles in initial):
        initial = [frozenset({"admin"}), *initial[1:]]
    tag = uuid.uuid4().hex[:8]

    async def work(session: Any) -> None:
        await isolate_admins(session)
        subs = [f"p31-{tag}-{i}" for i in range(len(initial))]
        for sub, roles in zip(subs, initial, strict=True):
            session.add(User(sub=sub, username=sub, roles=sorted(roles)))
        await session.flush()
        cognito = FakeCognito()

        async def admins() -> int:
            rows = (await session.scalars(select(User.roles).where(User.sub.in_(subs)))).all()
            return sum("admin" in r for r in rows)

        for actor_i, target_i, roles in requests:
            actor = subs[actor_i % len(subs)]
            target = subs[target_i % len(subs)]
            principal = Principal(actor, actor, None, frozenset({Role.admin}))
            try:
                await user_service.change_roles(session, cognito, principal, target, list(roles))
            except SelfRoleChange:
                assert actor == target
                continue
            except LastAdmin:
                continue
            assert actor != target
            assert await admins() >= 1

    run_in_rolled_back_session(migrated_database_url, work)


# --- operations ---------------------------------------------------------------------


async def _seed_records(ctx: Ctx) -> uuid.UUID:
    async with get_sessionmaker()() as s:
        area = await insert_area(s, f"{ctx.tag}-area")
        now = datetime.now(UTC)
        rows = [
            ("agromonitoring", "refresh", "success", now - timedelta(hours=1), None),
            ("agromonitoring", "refresh", "failed", now - timedelta(hours=2), "UPSTREAM_ERROR"),
            ("agromonitoring", "refresh", "partial", now - timedelta(days=3), "UPSTREAM_ERROR"),
            ("weather", "weather", "empty", now - timedelta(days=10), None),
        ]
        for provider, kind, status, started, code in rows:
            s.add(
                RetrievalRecord(
                    provider=provider, kind=kind, area_id=area.id, status=status,
                    started_at=started, finished_at=started, error_code=code,
                    error_message="The provider failed." if code else None,
                    requested_from=started.date(), requested_to=started.date(),
                )
            )  # fmt: skip
        await s.commit()
        return area.id


async def test_retrievals_filters(ctx: Ctx) -> None:
    area_id = await _seed_records(ctx)
    base = {"area_id": str(area_id)}

    async def get(**params: Any) -> dict[str, Any]:
        r = await ctx.client.get(
            "/api/v1/admin/retrievals", params={**base, **params}, headers=ctx.admin
        )
        assert r.status_code == 200, r.text
        return dict(r.json())

    everything = await get()
    assert everything["total"] == 4 and everything["limit"] == 25
    started = [i["started_at"] for i in everything["items"]]
    assert started == sorted(started, reverse=True)
    item = everything["items"][1]
    assert item["error"] == {"code": "UPSTREAM_ERROR", "message": "The provider failed."}
    assert set(item["requested_range"]) == {"from", "to"}
    assert (await get(provider="weather"))["total"] == 1
    assert (await get(status="failed"))["total"] == 1
    today = datetime.now(UTC).date()
    assert (await get(date_from=(today - timedelta(days=4)).isoformat()))["total"] == 3
    assert (await get(date_to=(today - timedelta(days=5)).isoformat()))["total"] == 1
    for bad in (
        {"status": "weird"},
        {"provider": "x"},
        {"date_from": "2026-13-01"},
        {"date_from": "2026-02-02", "date_to": "2026-02-01"},
        {"limit": 101},
    ):
        r = await ctx.client.get("/api/v1/admin/retrievals", params=bad, headers=ctx.admin)
        assert r.status_code == 422, bad
        assert "items" not in r.json()


async def test_integration_status_and_probe(ctx: Ctx) -> None:
    await _seed_records(ctx)
    r = await ctx.client.get("/api/v1/admin/integrations/status", headers=ctx.admin)
    body = r.json()
    agro = body["agromonitoring"]
    assert agro["configured"] is True and agro["enabled"] is True
    assert agro["probe"] is None
    assert agro["last_error"] == "UPSTREAM_ERROR: The provider failed."
    assert agro["failures_24h"] >= 1
    assert body["weather"]["configured"] is True
    assert body["weather"]["enabled"] is False  # the weather_enabled setting defaults to false
    assert ctx.agro.probes == 0

    before = agro["failures_24h"]
    ctx.agro.probe_error = AgroUpstreamError()
    r = await ctx.client.get("/api/v1/admin/integrations/status?probe=true", headers=ctx.admin)
    body = r.json()
    assert r.status_code == 200
    assert body["agromonitoring"]["probe"]["ok"] is False
    assert body["agromonitoring"]["probe"]["outcome"] == "failure"
    assert body["agromonitoring"]["failures_24h"] == before + 1
    assert body["weather"]["probe"] == {
        "ok": True,
        "latency_ms": body["weather"]["probe"]["latency_ms"],
        "outcome": "success",
    }
    assert ctx.agro.probes == 1
    assert PROVIDER_KEY not in r.text and "appid" not in r.text

    ctx.agro.probe_error = AgroTimeoutError()
    probe = (
        await ctx.client.get("/api/v1/admin/integrations/status?probe=true", headers=ctx.admin)
    ).json()
    assert probe["agromonitoring"]["probe"]["outcome"] == "timeout"


async def test_probe_timeout_is_10_seconds(ctx: Ctx, monkeypatch: pytest.MonkeyPatch) -> None:
    assert admin_ops.PROBE_TIMEOUT_S == 10.0
    import asyncio

    async def slow() -> None:
        await asyncio.sleep(2)

    async with get_sessionmaker()() as s:
        result = await admin_ops._probe(s, "agromonitoring", slow, 0.05)
    assert (result.ok, result.outcome) == (False, "timeout")


async def test_activity_filters(ctx: Ctx) -> None:
    await ctx.touch("ana", "researcher")
    await ctx.put_roles("ana", ["admin"])
    await ctx.client.get("/api/v1/admin/dashboard", headers=ctx.h("ana", "researcher"))  # denied
    r = await ctx.client.get(
        "/api/v1/admin/activity", params={"actor": ctx.sub("root")}, headers=ctx.admin
    )
    body = r.json()
    assert body["limit"] == 25
    assert {e["action"] for e in body["items"]} == {"role.change"}
    denied = await ctx.client.get(
        "/api/v1/admin/activity",
        params={"actor": ctx.sub("ana"), "action": "authz.denied"},
        headers=ctx.admin,
    )
    (event,) = denied.json()["items"]
    assert (
        event["outcome"] == "denied" and event["details"]["endpoint"] == "/api/v1/admin/dashboard"
    )
    today = datetime.now(UTC).date().isoformat()
    r = await ctx.client.get(
        "/api/v1/admin/activity",
        params={"actor": ctx.sub("root"), "date_from": today, "date_to": today},
        headers=ctx.admin,
    )
    assert r.json()["total"] == 1
    r = await ctx.client.get(
        "/api/v1/admin/activity",
        params={"date_from": "2026-02-02", "date_to": "2026-02-01"},
        headers=ctx.admin,
    )
    assert r.status_code == 422


async def test_dashboard_counts(ctx: Ctx) -> None:
    first = (await ctx.client.get("/api/v1/admin/dashboard", headers=ctx.admin)).json()
    assert set(first["retrievals_7d_by_status"]) == {
        "running",
        "success",
        "partial",
        "empty",
        "failed",
    }
    await _seed_records(ctx)
    await ctx.touch("ana", "researcher")
    second = (await ctx.client.get("/api/v1/admin/dashboard", headers=ctx.admin)).json()
    assert second["areas_active"] == first["areas_active"] + 1
    assert second["users_by_role"]["researcher"] == first["users_by_role"]["researcher"] + 1
    delta = {
        k: second["retrievals_7d_by_status"][k] - first["retrievals_7d_by_status"][k]
        for k in first["retrievals_7d_by_status"]
    }
    assert delta == {
        "running": 0,
        "success": 1,
        "partial": 1,
        "empty": 0,
        "failed": 1,
    }  # 10-day-old row excluded
    async with get_sessionmaker()() as s:
        await s.execute(update(User).where(User.sub == ctx.sub("ana")).values(status="disabled"))
        await s.commit()
    third = (await ctx.client.get("/api/v1/admin/dashboard", headers=ctx.admin)).json()
    assert third["users_by_role"]["researcher"] == first["users_by_role"]["researcher"]
