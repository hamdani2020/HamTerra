"""Admin user endpoints. There is no endpoint that creates users or grants roles to oneself."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Pagination, admin_page_params, get_cognito_admin, get_session, guard
from app.api.schemas.admin import RoleChangeOut, RoleChangeRequest, RoleName, UserOut
from app.api.schemas.common import Page
from app.core.permissions import Permission
from app.core.security import Principal, Role
from app.db.models.users import User
from app.integrations.cognito.admin import CognitoAdmin
from app.services import users as user_service

router = APIRouter(prefix="/admin/users", tags=["admin-users"])

Session = Annotated[AsyncSession, Depends(get_session)]
Sub = Annotated[str, Path(min_length=1, max_length=200)]


def user_out(user: User) -> UserOut:
    return UserOut(
        sub=user.sub,
        username=user.username,
        email=user.email,
        roles=sorted(user.roles),
        status=user.status,
        last_seen_at=user.last_seen_at,
    )


@router.get("", response_model=Page[UserOut])
async def list_users(
    _: Annotated[Principal, Depends(guard(Permission.USERS_READ))],
    session: Session,
    page: Annotated[Pagination, Depends(admin_page_params(default=50, maximum=100))],
    role: Annotated[RoleName | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
) -> Page[UserOut]:
    users, total = await user_service.list_users(
        session,
        role=Role(role) if role else None,
        q=q,
        limit=page.limit,
        offset=page.offset,
    )
    return Page[UserOut](
        items=[user_out(u) for u in users], total=total, limit=page.limit, offset=page.offset
    )


@router.get("/{sub}", response_model=UserOut)
async def read_user(
    sub: Sub, _: Annotated[Principal, Depends(guard(Permission.USERS_READ))], session: Session
) -> UserOut:
    return user_out(await user_service.get_user(session, sub))


@router.put("/{sub}/roles", response_model=RoleChangeOut)
async def change_roles(
    sub: Sub,
    body: RoleChangeRequest,
    actor: Annotated[Principal, Depends(guard(Permission.USERS_WRITE_ROLES))],
    session: Session,
    cognito: Annotated[CognitoAdmin, Depends(get_cognito_admin)],
) -> RoleChangeOut:
    result = await user_service.change_roles(
        session, cognito, actor, sub, [Role(r) for r in dict.fromkeys(body.roles)]
    )
    return RoleChangeOut(sub=result.sub, roles=result.roles, message=result.message)
