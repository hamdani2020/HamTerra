"""``GET /settings``: the values a researcher may see."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session, guard
from app.api.schemas.settings import ResearcherSettings
from app.core.permissions import Permission
from app.core.security import Principal
from app.domain.app_settings import SETTING_DEFS, to_json
from app.services import settings as settings_service

router = APIRouter(tags=["settings"])


@router.get("/settings", response_model=ResearcherSettings)
async def read_settings(
    _: Annotated[Principal, Depends(guard(Permission.SETTINGS_READ))],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, bool | int | float]:
    values = await settings_service.current_values(session)
    return {
        key: to_json(value) for key, value in values.items() if SETTING_DEFS[key].researcher_visible
    }
