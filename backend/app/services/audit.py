"""Append-only audit trail (Requirements 18.1 to 18.6).

``record`` writes in the caller's transaction, so the Audit_Event and the action it
describes commit or roll back together. A failure raises ``InternalError`` with
``details.reason="audit_write_failed"`` and the caller's transaction must be rolled back.

``record_separately`` is for failure and denied events, where the main transaction has
rolled back or must not be affected. It never raises: an audit failure there is logged
and the original outcome (for example the 403) is kept (Requirement 3.8).
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Mapping
from typing import Any, Final, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InternalError
from app.core.logging import request_id_var
from app.core.redaction import redact
from app.db.models.audit import AuditEvent
from app.db.session import get_sessionmaker

logger = logging.getLogger(__name__)

Outcome = Literal["success", "failure", "denied"]

SEPARATE_WRITE_TIMEOUT_S: Final = 2.0

# Keys that would carry credentials or request bodies. Dropped, never stored.
_FORBIDDEN_KEY = re.compile(
    r"(token|secret|password|passwd|credential|authorization|api_?key|appid|^key$|"
    r"^body$|^payload$|^request$|^headers?$)",
    re.IGNORECASE,
)
_MAX_DEPTH: Final = 4
_MAX_STRING: Final = 500


def _clean(value: Any, depth: int = 0) -> Any:
    if isinstance(value, Mapping):
        if depth >= _MAX_DEPTH:
            return None
        return {
            str(k): _clean(v, depth + 1)
            for k, v in value.items()
            if not _FORBIDDEN_KEY.search(str(k))
        }
    if isinstance(value, list | tuple | set | frozenset):
        if depth >= _MAX_DEPTH:
            return None
        items = sorted(value, key=str) if isinstance(value, set | frozenset) else value
        return [_clean(v, depth + 1) for v in items]
    if isinstance(value, str):
        return redact(value)[:_MAX_STRING]
    if value is None or isinstance(value, bool | int | float):
        return value
    return redact(str(value))[:_MAX_STRING]


def sanitize_details(details: Mapping[str, Any] | None) -> dict[str, Any]:
    """Return a JSON-safe copy of ``details`` without credential or body-like keys."""
    if not details:
        return {}
    cleaned = _clean(details)
    return cleaned if isinstance(cleaned, dict) else {}


def _build(
    *,
    actor_sub: str | None,
    action: str,
    target_type: str,
    target_id: str | None,
    outcome: Outcome,
    details: Mapping[str, Any] | None,
    request_id: str | None,
) -> AuditEvent:
    return AuditEvent(
        actor_sub=actor_sub,
        action=action,
        target_type=target_type,
        target_id=target_id,
        request_id=request_id or request_id_var.get() or "unknown",
        outcome=outcome,
        details=sanitize_details(details),
    )


async def record(
    session: AsyncSession,
    *,
    actor_sub: str | None,
    action: str,
    target_type: str,
    target_id: str | None = None,
    outcome: Outcome = "success",
    details: Mapping[str, Any] | None = None,
    request_id: str | None = None,
) -> None:
    """Insert an Audit_Event in the caller's transaction (flushed, not committed)."""
    try:
        session.add(
            _build(
                actor_sub=actor_sub,
                action=action,
                target_type=target_type,
                target_id=target_id,
                outcome=outcome,
                details=details,
                request_id=request_id,
            )
        )
        await session.flush()
    except Exception as exc:
        logger.error("Audit write failed for action %s", action, exc_info=exc)
        raise InternalError(
            "The audit record could not be written; the action was not completed.",
            details={"reason": "audit_write_failed"},
        ) from exc


async def record_separately(
    *,
    actor_sub: str | None,
    action: str,
    target_type: str,
    target_id: str | None = None,
    outcome: Literal["failure", "denied"],
    details: Mapping[str, Any] | None = None,
    request_id: str | None = None,
    timeout_s: float = SEPARATE_WRITE_TIMEOUT_S,
) -> bool:
    """Write a failure or denied event in its own session and transaction.

    Returns True when persisted. Never raises; failures are logged only.
    """
    event = _build(
        actor_sub=actor_sub,
        action=action,
        target_type=target_type,
        target_id=target_id,
        outcome=outcome,
        details=details,
        request_id=request_id,
    )
    try:
        async with asyncio.timeout(timeout_s):
            async with get_sessionmaker()() as session:
                session.add(event)
                await session.commit()
        return True
    except Exception as exc:  # includes TimeoutError and a missing engine
        logger.error("Separate audit write failed for action %s", action, exc_info=exc)
        return False
