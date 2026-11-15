"""Ghana boundary loader (Requirement 4.3).

The project owner supplies ``data/ghana_boundary.geojson``. A missing or unusable
file stops startup. The boundary is coarse by choice, so a geometry very close to
the border can be accepted slightly beyond it (a documented limitation).
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import shapely
from shapely.geometry.base import BaseGeometry
from shapely.prepared import PreparedGeometry, prep

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class BoundaryError(RuntimeError):
    """The boundary file cannot be used. The message never includes file contents."""


def resolve_path(path: str) -> Path:
    candidate = Path(path)
    return candidate if candidate.is_absolute() else BACKEND_ROOT / candidate


def load_ghana_boundary(path: str) -> PreparedGeometry[BaseGeometry]:
    """Read the file into one prepared Polygon or MultiPolygon in EPSG:4326."""
    file = resolve_path(path)
    if not file.is_file():
        raise BoundaryError(
            f"Ghana boundary file not found at '{path}'. "
            "Supply a GeoJSON Polygon or MultiPolygon there (see the README)."
        )
    try:
        frame = gpd.read_file(file)
        if frame.empty:
            raise BoundaryError("Ghana boundary file has no features.")
        if frame.crs is not None and frame.crs.to_epsg() != 4326:
            frame = frame.to_crs(4326)
        geometry = shapely.union_all(frame.geometry.values)
    except BoundaryError:
        raise
    except Exception as exc:
        raise BoundaryError(f"Ghana boundary file at '{path}' could not be read.") from exc
    if geometry.is_empty or geometry.geom_type not in ("Polygon", "MultiPolygon"):
        raise BoundaryError("Ghana boundary must be a Polygon or MultiPolygon.")
    if not shapely.is_valid(geometry):
        raise BoundaryError("Ghana boundary geometry is not valid.")
    return prep(geometry)
