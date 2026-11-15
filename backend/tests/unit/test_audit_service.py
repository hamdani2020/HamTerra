from __future__ import annotations

import asyncio
from typing import Any

import pytest
from pytest import MonkeyPatch

from app.core.errors import InternalError
from app.db.models.audit import AuditEvent
from app.services import audit


class FakeSession:
    def __init__(self, fail: bool = False, slow: bool = False) -> None:
        self.added: list[AuditEvent] = []
        self.fail = fail
        self.slow = slow
        self.committed = False

    def add(self, obj: AuditEvent) -> None:
        self.added.append(obj)

    async def flush(self) -> None:
        if self.fail:
            raise RuntimeError("db down")

    async def commit(self) -> None:
        if self.slow:
            await asyncio.sleep(1)
        if self.fail:
            raise RuntimeError("db down")
        self.committed = True

    async def __aenter__(self) -> FakeSession:
        return self

    async def __aexit__(self, *args: object) -> None:
        return None


def test_sanitize_drops_credentials_and_bodies() -> None:
    out = audit.sanitize_details(
        {
            "changed_fields": ["name"],
            "Authorization": "Bearer abc",
            "body": {"x": 1},
            "nested": {"api_key": "k", "ok": "Bearer tok.en"},
            "old": 0.1,
        }
    )
    assert out["changed_fields"] == ["name"]
    assert out["old"] == 0.1
    assert "Authorization" not in out and "body" not in out
    assert "api_key" not in out["nested"]
    assert "tok.en" not in out["nested"]["ok"]


async def test_record_adds_event_in_callers_session() -> None:
    session = FakeSession()
    await audit.record(
        session,  # type: ignore[arg-type]
        actor_sub="u1",
        action="area.create",
        target_type="area",
        target_id="a1",
        request_id="r1",
    )
    assert len(session.added) == 1
    event = session.added[0]
    assert (event.actor_sub, event.outcome, event.request_id) == ("u1", "success", "r1")
    assert not session.committed


async def test_record_failure_raises_internal_error() -> None:
    with pytest.raises(InternalError) as info:
        await audit.record(
            FakeSession(fail=True),  # type: ignore[arg-type]
            actor_sub="u1",
            action="x",
            target_type="t",
        )
    assert info.value.details["reason"] == "audit_write_failed"


def _patch_session(monkeypatch: MonkeyPatch, session: FakeSession) -> None:
    def factory() -> Any:
        return lambda: session

    monkeypatch.setattr(audit, "get_sessionmaker", factory)


async def test_record_separately_commits(monkeypatch: MonkeyPatch) -> None:
    session = FakeSession()
    _patch_session(monkeypatch, session)
    ok = await audit.record_separately(
        actor_sub=None, action="authz.denied", target_type="route", outcome="denied"
    )
    assert ok and session.committed and session.added[0].outcome == "denied"


async def test_record_separately_swallows_failure_and_timeout(monkeypatch: MonkeyPatch) -> None:
    _patch_session(monkeypatch, FakeSession(fail=True))
    assert not await audit.record_separately(
        actor_sub=None, action="a", target_type="t", outcome="failure"
    )
    _patch_session(monkeypatch, FakeSession(slow=True))
    assert not await audit.record_separately(
        actor_sub=None, action="a", target_type="t", outcome="denied", timeout_s=0.05
    )
