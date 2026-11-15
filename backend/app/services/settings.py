"""Application settings use cases (Requirements 14.x). Values are read on every call."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound, ValidationFailed
from app.core.security import Principal
from app.db.models.settings import AppSetting
from app.domain.app_settings import (
    SETTING_DEFS,
    SettingDef,
    SettingKeyError,
    SettingValue,
    SettingValueError,
    lookup,
    parse_stored,
    to_json,
    to_text,
    validate_value,
)
from app.services import audit


@dataclass(frozen=True)
class SettingRecord:
    definition: SettingDef
    value: SettingValue
    updated_by: str | None
    updated_at: datetime | None


def _resolve(key: str) -> SettingDef:
    try:
        return lookup(key)
    except SettingKeyError as exc:
        if exc.reason == "key_not_permitted":
            raise ValidationFailed(
                "This setting is not permitted.",
                details={"reason": "key_not_permitted"},
            ) from None
        raise NotFound("The setting is not known.", details={"reason": "unknown_key"}) from None


def _record(definition: SettingDef, row: AppSetting | None) -> SettingRecord:
    if row is None:  # the migration seeds every key; fall back to the default if one is gone
        return SettingRecord(definition, parse_stored(definition, definition.default), None, None)
    return SettingRecord(
        definition, parse_stored(definition, row.value), row.updated_by, row.updated_at
    )


async def list_settings(session: AsyncSession) -> list[SettingRecord]:
    rows = {r.key: r for r in (await session.scalars(select(AppSetting))).all()}
    return [_record(d, rows.get(d.key)) for d in SETTING_DEFS.values()]


async def current_values(session: AsyncSession) -> dict[str, SettingValue]:
    """Every allow-listed setting's current value, read fresh from the database."""
    return {r.definition.key: r.value for r in await list_settings(session)}


async def default_page_size(session: AsyncSession) -> int:
    value = (await current_values(session))["default_page_size"]
    return int(value)


async def update_setting(
    session: AsyncSession, actor: Principal, key: str, value: Any
) -> SettingRecord:
    definition = _resolve(key)
    try:
        new_value = validate_value(definition, value)
    except SettingValueError as exc:
        raise ValidationFailed(
            f"The value for this setting is not valid: {exc.detail}.",
            details={
                "reason": "invalid_value",
                "setting_key": definition.key,
                "constraint": exc.constraint,
            },
        ) from None
    try:
        row = await session.scalar(
            select(AppSetting).where(AppSetting.key == definition.key).with_for_update()
        )
        if row is None:
            raise NotFound("The setting is not known.", details={"reason": "unknown_key"})
        old_value = parse_stored(definition, row.value)
        row.value = to_text(new_value)
        row.updated_by = actor.sub
        await session.flush()
        await audit.record(
            session,
            actor_sub=actor.sub,
            action="setting.update",
            target_type="setting",
            target_id=definition.key,
            details={
                "setting_key": definition.key,
                "old_value": to_json(old_value),
                "new_value": to_json(new_value),
            },
        )
        await session.commit()
    except BaseException:
        await session.rollback()
        raise
    await session.refresh(row)
    return _record(definition, row)
