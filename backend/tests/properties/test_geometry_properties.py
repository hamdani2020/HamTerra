"""Properties 8, 9 and 10: geometry validation, inclusive area range, bbox parsing."""

from __future__ import annotations

import math
from typing import Any

import shapely
from hypothesis import given
from hypothesis import strategies as st
from shapely.geometry import Polygon
from shapely.prepared import prep

from app.domain.geometry import (
    BBox,
    BBoxError,
    GeometryError,
    check_area_range,
    format_bbox,
    parse_bbox,
    validate_geometry,
)
from tests.fixtures.reference import load_ghana_boundary_fixture

_BOUNDARY_GEOM = shapely.from_geojson(__import__("json").dumps(load_ghana_boundary_fixture()))
BOUNDARY = prep(_BOUNDARY_GEOM)

# --- Property 8 -----------------------------------------------------------------

json_leaf = st.one_of(
    st.none(),
    st.booleans(),
    st.integers(),
    st.floats(allow_nan=True, allow_infinity=True),
    st.text(max_size=6),
)
junk = st.recursive(
    json_leaf,
    lambda inner: st.one_of(
        st.lists(inner, max_size=4), st.dictionaries(st.text(max_size=6), inner, max_size=4)
    ),
    max_leaves=12,
)

coord = st.one_of(
    st.tuples(st.floats(-3.2, 1.1), st.floats(4.8, 11.0)),  # mostly near Ghana
    st.tuples(st.floats(-200, 200), st.floats(-100, 100)),  # sometimes out of range
    st.tuples(st.floats(-3.2, 1.1), st.floats(4.8, 11.0), st.floats(0, 500)),  # with altitude
)
ring_points = st.lists(coord, min_size=0, max_size=7)


@st.composite
def rings(draw: Any) -> list[list[Any]]:
    points = [list(p) for p in draw(ring_points)]
    if points and draw(st.booleans()):
        points.append(list(points[0]))
    return points


@st.composite
def small_rectangles(draw: st.DrawFn) -> dict[str, Any]:
    lon = draw(st.floats(-2.5, 0.0))
    lat = draw(st.floats(6.0, 10.0))
    w = draw(st.floats(0.001, 0.2))
    h = draw(st.floats(0.001, 0.2))
    ring = [[lon, lat], [lon + w, lat], [lon + w, lat + h], [lon, lat + h], [lon, lat]]
    return {"type": "Polygon", "coordinates": [ring]}


@st.composite
def candidate_geometries(draw: st.DrawFn) -> Any:
    kind = draw(st.sampled_from(["Polygon", "MultiPolygon", "Point", "Other"]))
    if kind == "Polygon":
        return {"type": "Polygon", "coordinates": draw(st.lists(rings(), min_size=0, max_size=2))}
    if kind == "MultiPolygon":
        polygons = draw(st.lists(st.lists(rings(), min_size=1, max_size=2), max_size=2))
        return {"type": "MultiPolygon", "coordinates": polygons}
    if kind == "Point":
        return {"type": "Point", "coordinates": [0, 0]}
    return draw(junk)


def _oracle_accepts(geojson: Any) -> bool:
    """Independent statement of the acceptance rule from Property 8."""
    if not isinstance(geojson, dict) or geojson.get("type") not in ("Polygon", "MultiPolygon"):
        return False
    coords = geojson.get("coordinates")
    polygons = [coords] if geojson["type"] == "Polygon" else coords
    if not isinstance(polygons, list) or not polygons:
        return False
    built = []
    for poly in polygons:
        if not isinstance(poly, list) or not poly:
            return False
        shell = None
        holes = []
        for index, ring in enumerate(poly):
            if not isinstance(ring, list):
                return False
            for pos in ring:
                if not isinstance(pos, list) or len(pos) not in (2, 3):
                    return False
                if not all(isinstance(v, int | float) and math.isfinite(v) for v in pos):
                    return False
                if not (-180 <= pos[0] <= 180 and -90 <= pos[1] <= 90):
                    return False
            if len(ring) < 4 or ring[0] != ring[-1]:
                return False
            xy = [(p[0], p[1]) for p in ring]
            if index == 0:
                shell = xy
            else:
                holes.append(xy)
        built.append(Polygon(shell, holes))
    geometry = built[0] if len(built) == 1 else shapely.MultiPolygon(built)
    return bool(
        shapely.is_valid(geometry) and not geometry.is_empty and _BOUNDARY_GEOM.contains(geometry)
    )


@given(geojson=st.one_of(candidate_geometries(), small_rectangles()))
def test_validate_geometry_is_total_and_correct(geojson: Any) -> None:
    try:
        result = validate_geometry(geojson, BOUNDARY)
    except GeometryError:
        accepted = False
    else:
        accepted = True
        assert result.geojson["type"] == geojson["type"]
    assert accepted is _oracle_accepts(geojson)


@given(geojson=junk)
def test_arbitrary_json_never_raises_other_errors(geojson: Any) -> None:
    try:
        validate_geometry(geojson, BOUNDARY)
    except GeometryError:
        pass


@given(geojson=small_rectangles())
def test_rectangles_inside_ghana_are_accepted(geojson: dict[str, Any]) -> None:
    assert _oracle_accepts(geojson)
    validate_geometry(geojson, BOUNDARY)


# --- Property 9 -----------------------------------------------------------------


@given(
    area=st.floats(0, 10_000),
    low=st.floats(0, 5_000),
    span=st.floats(0, 5_000),
)
def test_area_range_is_inclusive(area: float, low: float, span: float) -> None:
    high = low + span
    try:
        check_area_range(area, low, high)
        accepted = True
    except GeometryError:
        accepted = False
    assert accepted == (low <= area <= high)


@given(low=st.floats(0, 5_000), span=st.floats(0, 5_000))
def test_bounds_themselves_are_accepted(low: float, span: float) -> None:
    check_area_range(low, low, low + span)
    check_area_range(low + span, low, low + span)


# --- Property 10 ----------------------------------------------------------------

number_text = st.one_of(
    st.floats(-400, 400).map(repr),
    st.integers(-400, 400).map(str),
    st.sampled_from(
        [
            "1e1",
            "-1E1",
            ".5",
            "5.",
            "+3",
            " 7 ",
            "abc",
            "",
            "nan",
            "inf",
            "-inf",
            "1_0",
            "0x10",
            "1,5",
        ]
    ),
)
bbox_text = st.one_of(
    st.lists(number_text, min_size=0, max_size=6).map(",".join),
    st.text(max_size=20),
)


def _oracle(text: str) -> bool:
    parts = text.split(",")
    if len(parts) != 4:
        return False
    values = []
    for part in parts:
        token = part.strip()
        if (
            "_" in token
            or token.lower().lstrip("+-") in ("nan", "inf", "infinity")
            or token.lower().startswith("0x")
        ):
            return False
        try:
            value = float(token)
        except ValueError:
            return False
        if not math.isfinite(value):
            return False
        values.append(value)
    a, b, c, d = values
    return (
        -180 <= a <= 180
        and -180 <= c <= 180
        and -90 <= b <= 90
        and -90 <= d <= 90
        and a <= c
        and b <= d
    )


@given(text=bbox_text)
def test_parse_bbox_accepts_iff_valid(text: str) -> None:
    try:
        parse_bbox(text)
        accepted = True
    except BBoxError:
        accepted = False
    assert accepted is _oracle(text)


@given(
    lon=st.tuples(st.floats(-180, 180), st.floats(-180, 180)).map(sorted),
    lat=st.tuples(st.floats(-90, 90), st.floats(-90, 90)).map(sorted),
)
def test_format_then_parse_round_trips(lon: list[float], lat: list[float]) -> None:
    box = BBox(lon[0], lat[0], lon[1], lat[1])
    assert parse_bbox(format_bbox(box)) == box
