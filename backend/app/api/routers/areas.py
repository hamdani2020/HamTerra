"""Read endpoints for monitoring areas (researcher and admin)."""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Pagination, get_session, guard, pagination_params
from app.api.schemas.areas import AreaOut
from app.api.schemas.common import Page
from app.core.errors import ValidationFailed
from app.core.permissions import Permission
from app.core.security import Principal
from app.domain.geometry import BBox, BBoxError, parse_bbox
from app.services import areas as area_service
from app.services.areas import AreaView, StatusFilter

router = APIRouter(tags=["areas"])


def area_out(view: AreaView, *, with_geometry: bool) -> AreaOut:
    area = view.area
    fields: dict[str, Any] = {
        "id": area.id,
        "name": area.name,
        "description": area.description,
        "status": area.status,
        "area_ha": float(area.area_ha),
        "external_polygon_id": area.external_polygon_id,
        "latest_observation_date": view.latest_observation_date,
        "created_at": area.created_at,
        "updated_at": area.updated_at,
    }
    if with_geometry:
        fields["geometry"] = view.geometry
    return AreaOut(**fields)


def bbox_param(bbox: Annotated[str | None, Query(max_length=200)] = None) -> BBox | None:
    if bbox is None:
        return None
    try:
        return parse_bbox(bbox)
    except BBoxError as exc:
        raise ValidationFailed(
            details={
                "fields": [{"field": "bbox", "reason": str(exc)}],
            }
        ) from None


Reader = Annotated[Principal, Depends(guard(Permission.AREAS_READ))]
Session = Annotated[AsyncSession, Depends(get_session)]
Box = Annotated[BBox | None, Depends(bbox_param)]


@router.get("/areas", response_model=Page[AreaOut], response_model_exclude_unset=True)
async def list_areas(
    _: Reader,
    session: Session,
    page: Annotated[Pagination, Depends(pagination_params)],
    bbox: Box,
    status: Annotated[StatusFilter, Query()] = "active",
    q: Annotated[str | None, Query(max_length=100)] = None,
    include_geometry: bool = False,
) -> Page[AreaOut]:
    views, total = await area_service.list_areas(
        session,
        status=status,
        q=q,
        bbox=bbox,
        include_geometry=include_geometry,
        limit=page.limit,
        offset=page.offset,
    )
    return Page[AreaOut](
        items=[area_out(v, with_geometry=include_geometry) for v in views],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.get("/areas/map")
async def areas_map(
    _: Reader,
    session: Session,
    bbox: Box,
    status: Annotated[StatusFilter, Query()] = "active",
) -> dict[str, Any]:
    return await area_service.map_features(session, status=status, bbox=bbox)


@router.get("/areas/{area_id}", response_model=AreaOut, response_model_exclude_unset=True)
async def read_area(area_id: uuid.UUID, _: Reader, session: Session) -> AreaOut:
    return area_out(await area_service.get_area(session, area_id), with_geometry=True)
