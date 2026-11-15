"""Pure geometry validation and bounding-box parsing (Requirements 4.2 to 4.5, 4.9, 4.10).

``validate_geometry`` checks, in order and returning the first defect:
type, coordinate range, ring length and closure, validity, Ghana containment.
The area range check needs the PostGIS area, so it is a separate function.
Nothing here performs I/O, and the only exception raised is ``GeometryError``
(or ``BBoxError`` for bounding boxes).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol

import shapely
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry


class Defect(StrEnum):
    INVALID_GEOMETRY_TYPE = "INVALID_GEOMETRY_TYPE"
    COORDINATE_OUT_OF_RANGE = "COORDINATE_OUT_OF_RANGE"
    RING_TOO_SHORT = "RING_TOO_SHORT"
    RING_NOT_CLOSED = "RING_NOT_CLOSED"
    SELF_INTERSECTION = "SELF_INTERSECTION"
    INVALID_GEOMETRY = "INVALID_GEOMETRY"
    GEOMETRY_OUTSIDE_GHANA = "GEOMETRY_OUTSIDE_GHANA"
    AREA_OUT_OF_RANGE = "AREA_OUT_OF_RANGE"


_DETAIL: dict[Defect, str] = {
    Defect.INVALID_GEOMETRY_TYPE: "The geometry must be a Polygon or MultiPolygon.",
    Defect.COORDINATE_OUT_OF_RANGE: (
        "Every coordinate must be a finite [longitude, latitude] pair with "
        "longitude from -180 to 180 and latitude from -90 to 90."
    ),
    Defect.RING_TOO_SHORT: "Every ring needs at least 4 positions.",
    Defect.RING_NOT_CLOSED: "Every ring must end at its first position.",
    Defect.SELF_INTERSECTION: "The geometry intersects itself.",
    Defect.INVALID_GEOMETRY: "The geometry is not valid.",
    Defect.GEOMETRY_OUTSIDE_GHANA: "The geometry is not inside the Ghana boundary.",
    Defect.AREA_OUT_OF_RANGE: "The area is outside the permitted size range.",
}


class GeometryError(Exception):
    def __init__(self, code: Defect, detail: str | None = None) -> None:
        self.code = code
        self.detail = detail or _DETAIL[code]
        super().__init__(f"{code}: {self.detail}")


class Boundary(Protocol):
    """A prepared (or plain) Shapely geometry used for the containment test."""

    def contains(self, other: BaseGeometry) -> bool: ...


@dataclass(frozen=True)
class GeometryResult:
    geometry: BaseGeometry
    geojson: dict[str, Any]  # normalised: type and 2D coordinates only


def _is_number(value: Any) -> bool:
    return not isinstance(value, bool) and isinstance(value, int | float) and math.isfinite(value)


def _position(value: Any) -> list[float]:
    """A finite 2D or 3D position within range, as ``[lon, lat]``. Else COORDINATE_OUT_OF_RANGE."""
    if not isinstance(value, list | tuple) or len(value) not in (2, 3):
        raise GeometryError(Defect.COORDINATE_OUT_OF_RANGE)
    if not all(_is_number(v) for v in value):
        raise GeometryError(Defect.COORDINATE_OUT_OF_RANGE)
    lon, lat = float(value[0]), float(value[1])
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise GeometryError(Defect.COORDINATE_OUT_OF_RANGE)
    return [lon, lat]


def _rings(coordinates: Any) -> list[list[list[float]]]:
    """Positions of one polygon's rings. Structure errors are INVALID_GEOMETRY."""
    if not isinstance(coordinates, list | tuple) or not coordinates:
        raise GeometryError(Defect.INVALID_GEOMETRY)
    rings: list[list[list[float]]] = []
    for ring in coordinates:
        if not isinstance(ring, list | tuple):
            raise GeometryError(Defect.INVALID_GEOMETRY)
        rings.append([_position(p) for p in ring])
    return rings


def _polygons(geojson: dict[str, Any], kind: str) -> list[list[list[list[float]]]]:
    coordinates = geojson.get("coordinates")
    if kind == "Polygon":
        return [_rings(coordinates)]
    if not isinstance(coordinates, list | tuple) or not coordinates:
        raise GeometryError(Defect.INVALID_GEOMETRY)
    return [_rings(polygon) for polygon in coordinates]


def validate_geometry(geojson: Any, boundary: Boundary) -> GeometryResult:
    """Validate a GeoJSON geometry. Raises only ``GeometryError``."""
    try:
        return _validate(geojson, boundary)
    except GeometryError:
        raise
    except Exception:  # any other failure in a library is an invalid geometry
        raise GeometryError(Defect.INVALID_GEOMETRY) from None


def _validate(geojson: Any, boundary: Boundary) -> GeometryResult:
    # 1. type
    if not isinstance(geojson, dict) or geojson.get("type") not in ("Polygon", "MultiPolygon"):
        raise GeometryError(Defect.INVALID_GEOMETRY_TYPE)
    kind: str = geojson["type"]

    # 2. coordinates (all of them, before any ring rule)
    polygons = _polygons(geojson, kind)

    # 3. rings
    for rings in polygons:
        for ring in rings:
            if len(ring) < 4:
                raise GeometryError(Defect.RING_TOO_SHORT)
            if ring[0] != ring[-1]:
                raise GeometryError(Defect.RING_NOT_CLOSED)

    geometry: BaseGeometry
    parts = [Polygon(rings[0], rings[1:]) for rings in polygons]
    geometry = parts[0] if kind == "Polygon" else MultiPolygon(parts)

    # 4. validity
    if not shapely.is_valid(geometry):
        reason = shapely.is_valid_reason(geometry)
        if "Self-intersection" in reason:
            raise GeometryError(Defect.SELF_INTERSECTION)
        raise GeometryError(Defect.INVALID_GEOMETRY)
    if geometry.is_empty:
        raise GeometryError(Defect.INVALID_GEOMETRY)

    # 5. Ghana containment
    if not boundary.contains(geometry):
        raise GeometryError(Defect.GEOMETRY_OUTSIDE_GHANA)

    normalised: dict[str, Any] = {
        "type": kind,
        "coordinates": polygons[0] if kind == "Polygon" else polygons,
    }
    return GeometryResult(geometry=geometry, geojson=normalised)


def check_area_range(area_ha: float, min_ha: float, max_ha: float) -> None:
    """Inclusive range check on the PostGIS area (Requirement 4.5)."""
    if not (min_ha <= area_ha <= max_ha):
        raise GeometryError(Defect.AREA_OUT_OF_RANGE)


# --- bounding box -------------------------------------------------------------


class BBoxError(ValueError):
    """The ``bbox`` text is not a valid ``minLon,minLat,maxLon,maxLat`` box."""


@dataclass(frozen=True)
class BBox:
    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float


_NUMBER = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?")


def parse_bbox(text: str) -> BBox:
    parts = text.split(",")
    if len(parts) != 4:
        raise BBoxError("bbox needs exactly four comma-separated numbers")
    values: list[float] = []
    for part in parts:
        token = part.strip()
        if not _NUMBER.fullmatch(token):
            raise BBoxError("bbox values must be numbers")
        number = float(token)
        if not math.isfinite(number):
            raise BBoxError("bbox values must be finite")
        values.append(number)
    min_lon, min_lat, max_lon, max_lat = values
    if not (-180 <= min_lon <= 180 and -180 <= max_lon <= 180):
        raise BBoxError("bbox longitude must be from -180 to 180")
    if not (-90 <= min_lat <= 90 and -90 <= max_lat <= 90):
        raise BBoxError("bbox latitude must be from -90 to 90")
    if min_lon > max_lon or min_lat > max_lat:
        raise BBoxError("bbox minimum must not exceed maximum")
    return BBox(min_lon, min_lat, max_lon, max_lat)


def format_bbox(box: BBox) -> str:
    return ",".join(repr(v) for v in (box.min_lon, box.min_lat, box.max_lon, box.max_lat))
