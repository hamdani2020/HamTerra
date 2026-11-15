"""Admin endpoints that change monitoring areas."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_agro_client,
    get_ghana_boundary,
    get_session,
    get_settings,
    guard,
)
from app.api.routers.areas import area_out
from app.api.schemas.areas import AreaCreate, AreaOut, AreaUpdate
from app.core.config import Settings
from app.core.permissions import Permission
from app.core.security import Principal
from app.domain.geometry import Boundary
from app.integrations.agro.models import AgroClient
from app.services import areas as area_service

router = APIRouter(prefix="/admin/areas", tags=["admin-areas"])

Admin = Annotated[Principal, Depends(guard(Permission.AREAS_WRITE))]
Session = Annotated[AsyncSession, Depends(get_session)]
Agro = Annotated[AgroClient, Depends(get_agro_client)]
Ghana = Annotated[Boundary, Depends(get_ghana_boundary)]
Config = Annotated[Settings, Depends(get_settings)]


@router.post("", response_model=AreaOut, status_code=201, response_model_exclude_unset=True)
async def create_area(
    body: AreaCreate, actor: Admin, session: Session, agro: Agro, boundary: Ghana, settings: Config
) -> AreaOut:
    view = await area_service.create_area(
        session,
        agro,
        boundary,
        settings,
        actor,
        name=body.name,
        description=body.description,
        geometry=body.geometry,
    )
    return area_out(view, with_geometry=True)


@router.patch("/{area_id}", response_model=AreaOut, response_model_exclude_unset=True)
async def update_area(
    area_id: uuid.UUID,
    body: AreaUpdate,
    actor: Admin,
    session: Session,
    agro: Agro,
    boundary: Ghana,
    settings: Config,
) -> AreaOut:
    changes = body.model_dump(exclude_unset=True)
    view = await area_service.update_area(
        session, agro, boundary, settings, actor, area_id, changes=changes
    )
    return area_out(view, with_geometry=True)


@router.post("/{area_id}/archive", response_model=AreaOut, response_model_exclude_unset=True)
async def archive_area(area_id: uuid.UUID, actor: Admin, session: Session) -> AreaOut:
    return area_out(await area_service.archive_area(session, actor, area_id), with_geometry=True)


@router.post("/{area_id}/restore", response_model=AreaOut, response_model_exclude_unset=True)
async def restore_area(area_id: uuid.UUID, actor: Admin, session: Session) -> AreaOut:
    return area_out(await area_service.restore_area(session, actor, area_id), with_geometry=True)
