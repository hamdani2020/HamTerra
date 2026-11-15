"""User administration (Requirements 12.x). Users are read from the local ``users`` table."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, CognitoAdminNotEnabled, LastAdmin, NotFound, SelfRoleChange
from app.core.security import Principal, Role
from app.db.models.users import User
from app.integrations.cognito.admin import CognitoAdmin
from app.services import audit

logger = logging.getLogger(__name__)

ROLE_CHANGE_MESSAGE = (
    "The change takes effect after the user obtains a new token (sign in again or refresh)."
)


@dataclass(frozen=True)
class RoleChangeResult:
    sub: str
    roles: list[str]
    message: str


async def list_users(
    session: AsyncSession, *, role: Role | None, q: str | None, limit: int, offset: int
) -> tuple[list[User], int]:
    conditions: list[Any] = []
    if role is not None:
        conditions.append(User.roles.contains([role.value]))
    if q:
        conditions.append(
            or_(
                User.username.icontains(q, autoescape=True),
                User.email.icontains(q, autoescape=True),
                User.sub.icontains(q, autoescape=True),
            )
        )
    total = await session.scalar(select(func.count(User.id)).where(*conditions))
    rows = (
        await session.scalars(
            select(User)
            .where(*conditions)
            .order_by(func.lower(User.username), User.sub)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return list(rows), int(total or 0)


async def get_user(session: AsyncSession, sub: str) -> User:
    user = await session.scalar(select(User).where(User.sub == sub))
    if user is None:
        raise NotFound("The user was not found.")
    return user


async def _other_admins(session: AsyncSession, sub: str) -> int:
    count = await session.scalar(
        select(func.count(User.id)).where(
            User.roles.contains([Role.admin.value]), User.status == "active", User.sub != sub
        )
    )
    return int(count or 0)


async def change_roles(
    session: AsyncSession,
    cognito: CognitoAdmin,
    actor: Principal,
    sub: str,
    roles: list[Role],
) -> RoleChangeResult:
    """Check order: 501 not enabled, 404 unknown user, 409 self change, 409 last admin."""
    if not cognito.enabled:
        raise CognitoAdminNotEnabled()
    user = await get_user(session, sub)
    if sub == actor.sub:
        raise SelfRoleChange()

    current = {Role(r) for r in user.roles}
    wanted = set(roles)
    if (
        Role.admin in current
        and Role.admin not in wanted
        and await _other_admins(session, sub) == 0
    ):
        raise LastAdmin()

    changes = [(g, True) for g in sorted(wanted - current)] + [
        (g, False) for g in sorted(current - wanted)
    ]
    if not changes:
        return RoleChangeResult(sub, sorted(r.value for r in current), ROLE_CHANGE_MESSAGE)

    applied: list[tuple[Role, bool]] = []
    details = {
        "target_sub": sub,
        "changes": [{"group": g.value, "action": "add" if add else "remove"} for g, add in changes],
    }
    try:
        for group, add in changes:
            await cognito.set_group_membership(user.username, group, add)
            applied.append((group, add))
    except AppError as exc:
        await _undo(cognito, user.username, applied)
        await audit.record_separately(
            actor_sub=actor.sub,
            action="role.change",
            target_type="user",
            target_id=sub,
            outcome="failure",
            details={**details, "error_code": str(exc.code)},
        )
        raise

    try:
        user.roles = sorted(r.value for r in wanted)
        await session.flush()
        await audit.record(
            session,
            actor_sub=actor.sub,
            action="role.change",
            target_type="user",
            target_id=sub,
            details=details,
        )
        await session.commit()
    except BaseException:
        await session.rollback()
        await _undo(cognito, user.username, applied)
        raise
    return RoleChangeResult(sub, sorted(r.value for r in wanted), ROLE_CHANGE_MESSAGE)


async def _undo(cognito: CognitoAdmin, username: str, applied: list[tuple[Role, bool]]) -> None:
    """Best effort: reverse group changes already applied so Cognito matches the local roles."""
    for group, add in reversed(applied):
        try:
            await cognito.set_group_membership(username, group, not add)
        except Exception:
            logger.error("cognito_group_change_undo_failed", extra={"group": group.value})
