"""Monitoring area use cases (Requirements 4.x, 13.9, 13.10, 18.1)."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Literal

from sqlalchemy import Select, func, select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import (
    AreaOutOfRange,
    Conflict,
    GeometryOutsideGhana,
    NotFound,
    ValidationFailed,
)
from app.core.security import Principal
from app.db.models.areas import Area
from app.db.models.observations import Observation
from app.db.models.users import User
from app.domain.geometry import (
    BBox,
    Boundary,
    Defect,
    GeometryError,
    GeometryResult,
    check_area_range,
    validate_geometry,
)
from app.integrations.agro.errors import AgroTimeoutError
from app.integrations.agro.models import AgroClient
from app.services import audit

logger = logging.getLogger(__name__)

PROVIDER_REGISTRATION_TIMEOUT_S = 10.0
StatusFilter = Literal["active", "archived", "all"]

_NAME_CONFLICT = "An active monitoring area with this name already exists."


@dataclass(frozen=True)
class AreaView:
    area: Area
    geometry: dict[str, Any] | None
    latest_observation_date: date | None


# --- validation -----------------------------------------------------------------


def _to_app_error(exc: GeometryError) -> Exception:
    if exc.code is Defect.GEOMETRY_OUTSIDE_GHANA:
        return GeometryOutsideGhana(details={"defect": exc.code.value})
    if exc.code is Defect.AREA_OUT_OF_RANGE:
        return AreaOutOfRange(details={"defect": exc.code.value})
    return ValidationFailed(
        f"The geometry is not valid. {exc.detail}", details={"defect": exc.code.value}
    )


async def _compute_area_ha(session: AsyncSession, geojson: dict[str, Any]) -> Decimal:
    """Geodesic area in hectares, rounded to 2 decimals, computed by PostGIS."""
    try:
        value = await session.scalar(
            text(
                "SELECT round((ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(:g), 4326)::geography)"
                " / 10000)::numeric, 2)"
            ),
            {"g": json.dumps(geojson)},
        )
    except DBAPIError:
        await session.rollback()
        raise _to_app_error(GeometryError(Defect.INVALID_GEOMETRY)) from None
    return Decimal(value)


async def _validated(
    session: AsyncSession, raw: Any, boundary: Boundary, settings: Settings
) -> tuple[GeometryResult, Decimal]:
    try:
        result = validate_geometry(raw, boundary)
    except GeometryError as exc:
        raise _to_app_error(exc) from None
    area_ha = await _compute_area_ha(session, result.geojson)
    try:
        check_area_range(float(area_ha), settings.area_min_ha, settings.area_max_ha)
    except GeometryError as exc:
        raise AreaOutOfRange(
            details={
                "defect": exc.code.value,
                "area_ha": float(area_ha),
                "min_ha": settings.area_min_ha,
                "max_ha": settings.area_max_ha,
            }
        ) from None
    return result, area_ha


def _geom_expr(geojson: dict[str, Any]) -> Any:
    return func.ST_SetSRID(func.ST_GeomFromGeoJSON(json.dumps(geojson)), 4326)


# --- helpers --------------------------------------------------------------------


async def _name_taken(session: AsyncSession, name: str, *, exclude: uuid.UUID | None) -> bool:
    stmt = select(Area.id).where(func.lower(Area.name) == name.lower(), Area.status == "active")
    if exclude is not None:
        stmt = stmt.where(Area.id != exclude)
    return (await session.scalar(stmt.limit(1))) is not None


async def _provider_create(agro: AgroClient, name: str, geojson: dict[str, Any]) -> str:
    try:
        async with asyncio.timeout(PROVIDER_REGISTRATION_TIMEOUT_S):
            polygon = await agro.create_polygon(name, geojson)
    except TimeoutError:
        raise AgroTimeoutError() from None
    return polygon.id


async def _provider_delete_quietly(agro: AgroClient, polygon_id: str | None, why: str) -> None:
    if not polygon_id:
        return
    try:
        await agro.delete_polygon(polygon_id)
    except Exception:  # best effort; never mask the original outcome
        logger.warning("provider_polygon_cleanup_failed", extra={"reason": why})


async def _user_id(session: AsyncSession, sub: str) -> uuid.UUID | None:
    return await session.scalar(select(User.id).where(User.sub == sub))


async def _load(session: AsyncSession, area_id: uuid.UUID) -> Area:
    area = await session.get(Area, area_id)
    if area is None:
        raise NotFound("The monitoring area was not found.")
    return area


def _latest_date_subquery() -> Any:
    return (
        select(func.max(Observation.acquired_on))
        .where(Observation.area_id == Area.id)
        .correlate(Area)
        .scalar_subquery()
    )


async def _view(session: AsyncSession, area: Area, *, geometry: bool = True) -> AreaView:
    await session.refresh(area)
    latest = await session.scalar(
        select(func.max(Observation.acquired_on)).where(Observation.area_id == area.id)
    )
    geo = None
    if geometry:
        raw = await session.scalar(select(func.ST_AsGeoJSON(Area.geom)).where(Area.id == area.id))
        geo = json.loads(raw) if raw else None
    return AreaView(area, geo, latest)


# --- commands -------------------------------------------------------------------


async def create_area(
    session: AsyncSession,
    agro: AgroClient,
    boundary: Boundary,
    settings: Settings,
    actor: Principal,
    *,
    name: str,
    description: str | None,
    geometry: Any,
) -> AreaView:
    result, area_ha = await _validated(session, geometry, boundary, settings)
    if await _name_taken(session, name, exclude=None):
        raise Conflict(_NAME_CONFLICT)

    polygon_id = await _provider_create(agro, name, result.geojson)
    try:
        area = Area(
            name=name,
            description=description,
            status="active",
            geom=_geom_expr(result.geojson),
            area_ha=area_ha,
            external_polygon_id=polygon_id,
            created_by=await _user_id(session, actor.sub),
        )
        session.add(area)
        await session.flush()
        await audit.record(
            session,
            actor_sub=actor.sub,
            action="area.create",
            target_type="area",
            target_id=str(area.id),
            details={"name": name, "area_ha": float(area_ha)},
        )
        await session.commit()
    except BaseException as exc:
        await session.rollback()
        await _provider_delete_quietly(agro, polygon_id, "create_failed")
        if isinstance(exc, IntegrityError):
            raise Conflict(_NAME_CONFLICT) from None
        raise
    return await _view(session, area)


async def update_area(
    session: AsyncSession,
    agro: AgroClient,
    boundary: Boundary,
    settings: Settings,
    actor: Principal,
    area_id: uuid.UUID,
    *,
    changes: dict[str, Any],
) -> AreaView:
    """Apply the fields present in ``changes`` (name, description, geometry)."""
    area = await _load(session, area_id)
    if "name" in changes and area.status == "active":
        if await _name_taken(session, changes["name"], exclude=area.id):
            raise Conflict(_NAME_CONFLICT)

    new_polygon_id: str | None = None
    old_polygon_id = area.external_polygon_id
    geometry_changed = "geometry" in changes
    try:
        if geometry_changed:
            result, area_ha = await _validated(session, changes["geometry"], boundary, settings)
            name_for_provider = changes.get("name", area.name)
            new_polygon_id = await _provider_create(agro, name_for_provider, result.geojson)
            area.geom = _geom_expr(result.geojson)
            area.area_ha = area_ha
            area.external_polygon_id = new_polygon_id
            await session.execute(
                update(Observation)
                .where(Observation.area_id == area.id)
                .values(geometry_status="stale_geometry")
            )
        if "name" in changes:
            area.name = changes["name"]
        if "description" in changes:
            area.description = changes["description"]
        await session.flush()
        await audit.record(
            session,
            actor_sub=actor.sub,
            action="area.update",
            target_type="area",
            target_id=str(area.id),
            details={"changed_fields": sorted(changes)},
        )
        await session.commit()
    except BaseException as exc:
        await session.rollback()
        await _provider_delete_quietly(agro, new_polygon_id, "update_failed")
        if isinstance(exc, IntegrityError):
            raise Conflict(_NAME_CONFLICT) from None
        raise
    if geometry_changed and old_polygon_id and old_polygon_id != new_polygon_id:
        await _provider_delete_quietly(agro, old_polygon_id, "geometry_replaced")
    return await _view(session, area)


async def archive_area(session: AsyncSession, actor: Principal, area_id: uuid.UUID) -> AreaView:
    area = await _load(session, area_id)
    if area.status != "archived":
        area.status = "archived"
        await _audited_status_change(session, actor, area, "area.archive")
    return await _view(session, area)


async def restore_area(session: AsyncSession, actor: Principal, area_id: uuid.UUID) -> AreaView:
    area = await _load(session, area_id)
    if area.status != "active":
        if await _name_taken(session, area.name, exclude=area.id):
            raise Conflict(_NAME_CONFLICT)
        area.status = "active"
        await _audited_status_change(session, actor, area, "area.restore")
    return await _view(session, area)


async def _audited_status_change(
    session: AsyncSession, actor: Principal, area: Area, action: str
) -> None:
    try:
        await session.flush()
        await audit.record(
            session,
            actor_sub=actor.sub,
            action=action,
            target_type="area",
            target_id=str(area.id),
            details={"changed_fields": ["status"]},
        )
        await session.commit()
    except BaseException as exc:
        await session.rollback()
        if isinstance(exc, IntegrityError):
            raise Conflict(_NAME_CONFLICT) from None
        raise


# --- queries --------------------------------------------------------------------


def _filtered(
    stmt: Select[Any], *, status: StatusFilter, q: str | None, bbox: BBox | None
) -> Select[Any]:
    if status != "all":
        stmt = stmt.where(Area.status == status)
    if q:
        stmt = stmt.where(Area.name.icontains(q, autoescape=True))
    if bbox is not None:
        stmt = stmt.where(
            func.ST_Intersects(
                Area.geom,
                func.ST_MakeEnvelope(bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat, 4326),
            )
        )
    return stmt


async def list_areas(
    session: AsyncSession,
    *,
    status: StatusFilter,
    q: str | None,
    bbox: BBox | None,
    include_geometry: bool,
    limit: int,
    offset: int,
) -> tuple[list[AreaView], int]:
    total = await session.scalar(
        _filtered(select(func.count(Area.id)), status=status, q=q, bbox=bbox)
    )
    columns: list[Any] = [Area, _latest_date_subquery()]
    if include_geometry:
        columns.append(func.ST_AsGeoJSON(Area.geom))
    stmt = _filtered(select(*columns), status=status, q=q, bbox=bbox)
    stmt = stmt.order_by(func.lower(Area.name), Area.id).limit(limit).offset(offset)
    rows = (await session.execute(stmt)).all()
    views = [
        AreaView(row[0], json.loads(row[2]) if include_geometry and row[2] else None, row[1])
        for row in rows
    ]
    return views, int(total or 0)


async def get_area(session: AsyncSession, area_id: uuid.UUID) -> AreaView:
    stmt = select(Area, _latest_date_subquery(), func.ST_AsGeoJSON(Area.geom)).where(
        Area.id == area_id
    )
    row = (await session.execute(stmt)).first()
    if row is None:
        raise NotFound("The monitoring area was not found.")
    return AreaView(row[0], json.loads(row[2]) if row[2] else None, row[1])


async def map_features(
    session: AsyncSession, *, status: StatusFilter, bbox: BBox | None
) -> dict[str, Any]:
    stmt = _filtered(
        select(Area, _latest_date_subquery(), func.ST_AsGeoJSON(Area.geom)),
        status=status,
        q=None,
        bbox=bbox,
    ).order_by(func.lower(Area.name), Area.id)
    features: list[dict[str, Any]] = []
    for area, latest, geo in (await session.execute(stmt)).all():
        features.append(
            {
                "type": "Feature",
                "id": str(area.id),
                "geometry": json.loads(geo),
                "properties": {
                    "id": str(area.id),
                    "name": area.name,
                    "area_ha": float(area.area_ha),
                    "latest_observation_date": latest.isoformat() if latest else None,
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}
