"""``GET /api/v1/me``: the signed-in user's identity, roles and permissions."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.deps import guard
from app.core.permissions import Permission, permissions_for
from app.core.security import Principal

router = APIRouter(tags=["me"])


class MeResponse(BaseModel):
    sub: str
    username: str
    email: str | None
    roles: list[str]
    permissions: list[str]


@router.get("/me", response_model=MeResponse)
async def read_me(
    principal: Annotated[Principal, Depends(guard(Permission.ME))],
) -> MeResponse:
    return MeResponse(
        sub=principal.sub,
        username=principal.username,
        email=principal.email,
        roles=sorted(role.value for role in principal.roles),
        permissions=permissions_for(principal.roles),
    )
