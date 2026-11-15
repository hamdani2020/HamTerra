"""Admin endpoints for application settings."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session, guard
from app.api.schemas.settings import SettingList, SettingOut, SettingUpdate
from app.core.permissions import Permission
from app.core.security import Principal
from app.domain.app_settings import parse_stored, to_json
from app.services import settings as settings_service
from app.services.settings import SettingRecord

router = APIRouter(prefix="/admin/settings", tags=["admin-settings"])

Session = Annotated[AsyncSession, Depends(get_session)]


def setting_out(record: SettingRecord) -> SettingOut:
    d = record.definition

    def bound(value: object) -> int | float | None:
        if value is None:
            return None
        return int(str(value)) if d.type == "integer" else float(str(value))

    return SettingOut(
        key=d.key,
        value=to_json(record.value),
        type=d.type,
        default=to_json(parse_stored(d, d.default)),
        min=bound(d.minimum),
        max=bound(d.maximum),
        updated_by=record.updated_by,
        updated_at=record.updated_at,
    )


@router.get("", response_model=SettingList)
async def list_settings(
    _: Annotated[Principal, Depends(guard(Permission.SETTINGS_WRITE))], session: Session
) -> SettingList:
    return SettingList(
        items=[setting_out(r) for r in await settings_service.list_settings(session)]
    )


@router.put("/{key}", response_model=SettingOut)
async def update_setting(
    key: str,
    body: SettingUpdate,
    actor: Annotated[Principal, Depends(guard(Permission.SETTINGS_WRITE))],
    session: Session,
) -> SettingOut:
    return setting_out(await settings_service.update_setting(session, actor, key, body.value))
