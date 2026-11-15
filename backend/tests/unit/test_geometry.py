"""Geospatial unit tests (task 7.5) and the boundary loader (task 7.6)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pyproj import Geod
from shapely.geometry import shape
from shapely.prepared import prep

from app.core.boundary import BoundaryError, load_ghana_boundary
from app.domain.geometry import (
    BBoxError,
    Defect,
    GeometryError,
    check_area_range,
    parse_bbox,
    validate_geometry,
)
from tests.fixtures.reference import (
    FIXTURES_DIR,
    OUTSIDE_GHANA_POLYGON_GEOJSON,
    REFERENCE_AREA_HECTARES,
    REFERENCE_POLYGON_GEOJSON,
    load_ghana_boundary_fixture,
)

BOUNDARY = prep(shape(load_ghana_boundary_fixture()["geometry"]))


def defect_of(geojson: Any) -> Defect:
    with pytest.raises(GeometryError) as info:
        validate_geometry(geojson, BOUNDARY)
    return info.value.code


def square(lon: float = -1.0, lat: float = 7.0, size: float = 0.01) -> list[list[float]]:
    return [[lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]]


def test_reference_polygon_is_accepted_and_area_is_within_one_percent() -> None:
    result = validate_geometry(REFERENCE_POLYGON_GEOJSON, BOUNDARY)
    area_m2, _ = Geod(ellps="WGS84").geometry_area_perimeter(result.geometry)
    assert abs(area_m2) / 10_000 == pytest.approx(REFERENCE_AREA_HECTARES, rel=0.01)


def test_multipolygon_accepted() -> None:
    geojson = {"type": "MultiPolygon", "coordinates": [[square()], [square(-0.5, 8.0)]]}
    assert validate_geometry(geojson, BOUNDARY).geojson["type"] == "MultiPolygon"


def test_polygon_with_hole_accepted_and_altitude_dropped() -> None:
    outer = [[-1, 7, 5], [-0.9, 7, 5], [-0.9, 7.1, 5], [-1, 7.1, 5], [-1, 7, 5]]
    hole = [[-0.97, 7.03], [-0.93, 7.03], [-0.93, 7.07], [-0.97, 7.07], [-0.97, 7.03]]
    result = validate_geometry({"type": "Polygon", "coordinates": [outer, hole]}, BOUNDARY)
    assert all(len(p) == 2 for ring in result.geojson["coordinates"] for p in ring)


def test_extra_members_are_not_carried_over() -> None:
    geojson = {"type": "Polygon", "coordinates": [square()], "crs": {"x": 1}, "bbox": [1]}
    assert set(validate_geometry(geojson, BOUNDARY).geojson) == {"type", "coordinates"}


@pytest.mark.parametrize(
    "geojson",
    [None, "x", 5, [], {}, {"type": "Point", "coordinates": [0, 0]}, {"type": "polygon"}],
)
def test_wrong_type(geojson: Any) -> None:
    assert defect_of(geojson) is Defect.INVALID_GEOMETRY_TYPE


@pytest.mark.parametrize(
    "position",
    [
        [200, 7],
        [-181, 7],
        [0, 91],
        [0, -90.5],
        [float("nan"), 7],
        [float("inf"), 7],
        ["a", 7],
        [1],
        [True, 7],
    ],
)
def test_coordinate_out_of_range(position: list[Any]) -> None:
    ring = [position, [-1, 7], [-1, 7.1], position]
    assert defect_of({"type": "Polygon", "coordinates": [ring]}) is Defect.COORDINATE_OUT_OF_RANGE


def test_coordinates_are_checked_before_ring_rules() -> None:
    ring = [[500, 7], [-1, 7]]  # too short and out of range: range wins
    assert defect_of({"type": "Polygon", "coordinates": [ring]}) is Defect.COORDINATE_OUT_OF_RANGE


def test_ring_too_short_and_not_closed() -> None:
    assert (
        defect_of({"type": "Polygon", "coordinates": [[[0, 7], [1, 7], [0, 7]]]})
        is Defect.RING_TOO_SHORT
    )
    open_ring = [[-1, 7], [-0.9, 7], [-0.9, 7.1], [-1, 7.1]]
    assert defect_of({"type": "Polygon", "coordinates": [open_ring]}) is Defect.RING_NOT_CLOSED


def test_self_intersection() -> None:
    bow_tie = [[-1, 7], [-0.9, 7.1], [-0.9, 7], [-1, 7.1], [-1, 7]]
    assert defect_of({"type": "Polygon", "coordinates": [bow_tie]}) is Defect.SELF_INTERSECTION


@pytest.mark.parametrize("coordinates", [[], "x", [5]])
def test_malformed_structure_is_invalid_geometry(coordinates: Any) -> None:
    assert defect_of({"type": "Polygon", "coordinates": coordinates}) is Defect.INVALID_GEOMETRY


def test_outside_ghana() -> None:
    assert defect_of(OUTSIDE_GHANA_POLYGON_GEOJSON) is Defect.GEOMETRY_OUTSIDE_GHANA


def test_partly_outside_ghana() -> None:
    straddling = [[-3.4, 5.0], [-3.0, 5.0], [-3.0, 5.2], [-3.4, 5.2], [-3.4, 5.0]]
    assert (
        defect_of({"type": "Polygon", "coordinates": [straddling]}) is Defect.GEOMETRY_OUTSIDE_GHANA
    )


@pytest.mark.parametrize(
    ("area", "ok"),
    [(0.99, False), (1.0, True), (1.01, True), (2999.99, True), (3000.0, True), (3000.01, False)],
)
def test_area_limits_are_inclusive(area: float, ok: bool) -> None:
    if ok:
        check_area_range(area, 1.0, 3000.0)
    else:
        with pytest.raises(GeometryError) as info:
            check_area_range(area, 1.0, 3000.0)
        assert info.value.code is Defect.AREA_OUT_OF_RANGE


@pytest.mark.parametrize(
    "text",
    [
        "",
        "1,2,3",
        "1,2,3,4,5",
        "a,b,c,d",
        "10,5,5,6",
        "0,10,1,5",
        "-181,0,0,1",
        "0,-91,1,0",
        "nan,0,1,1",
        "1_0,0,20,1",
    ],
)
def test_bad_bbox(text: str) -> None:
    with pytest.raises(BBoxError):
        parse_bbox(text)


def test_good_bbox() -> None:
    box = parse_bbox(" -3.2, 4.7 ,1.3,11.2")
    assert (box.min_lon, box.min_lat, box.max_lon, box.max_lat) == (-3.2, 4.7, 1.3, 11.2)
    assert parse_bbox("0,0,0,0").min_lon == 0


# --- boundary loader ---------------------------------------------------------------


def test_loader_reads_the_fixture() -> None:
    boundary = load_ghana_boundary(str(FIXTURES_DIR / "ghana_boundary_small.geojson"))
    assert boundary.contains(shape(REFERENCE_POLYGON_GEOJSON))
    assert not boundary.contains(shape(OUTSIDE_GHANA_POLYGON_GEOJSON))


def test_loader_missing_file_names_the_path_only() -> None:
    with pytest.raises(BoundaryError, match="not found"):
        load_ghana_boundary("data/does_not_exist.geojson")


@pytest.mark.parametrize(
    "content",
    [
        "not json at all",
        json.dumps({"type": "FeatureCollection", "features": []}),
        json.dumps({"type": "Point", "coordinates": [0, 0]}),
        json.dumps({"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]}),
    ],
)
def test_loader_rejects_unusable_files(tmp_path: Path, content: str) -> None:
    file = tmp_path / "b.geojson"
    file.write_text(content, encoding="utf-8")
    with pytest.raises(BoundaryError):
        load_ghana_boundary(str(file))


def test_loader_unions_features(tmp_path: Path) -> None:
    def feature(x: float) -> dict[str, Any]:
        ring = [[x, 5], [x + 1, 5], [x + 1, 6], [x, 6], [x, 5]]
        return {
            "type": "Feature",
            "properties": {},
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        }

    file = tmp_path / "b.geojson"
    file.write_text(json.dumps({"type": "FeatureCollection", "features": [feature(0), feature(3)]}))
    boundary = load_ghana_boundary(str(file))
    assert boundary.contains(shape({"type": "Point", "coordinates": [3.5, 5.5]}))
