"""Sanity checks for shared reference data and fake JWT helpers (Requirements 22.2, 22.8)."""

from __future__ import annotations

import jwt
from pyproj import Geod
from shapely.geometry import Polygon, shape

from tests.fixtures.jwt_keys import FAKE_CLIENT_ID, FakeKey
from tests.fixtures.reference import (
    OUTSIDE_GHANA_POLYGON_GEOJSON,
    REFERENCE_AREA_HECTARES,
    REFERENCE_NDVI_SERIES,
    REFERENCE_POLYGON_GEOJSON,
    load_ghana_boundary_fixture,
)


def test_reference_series_is_eight_ascending_points() -> None:
    dates = [p.observed_on for p in REFERENCE_NDVI_SERIES]
    assert len(dates) == 8
    assert dates == sorted(dates)


def test_reference_polygon_area_within_one_percent_and_inside_boundary() -> None:
    poly = shape(REFERENCE_POLYGON_GEOJSON)
    assert isinstance(poly, Polygon)
    xs, ys = poly.exterior.coords.xy
    hectares = abs(Geod(ellps="WGS84").polygon_area_perimeter(list(xs), list(ys))[0]) / 1e4
    assert abs(hectares - REFERENCE_AREA_HECTARES) / REFERENCE_AREA_HECTARES < 0.01
    boundary = shape(load_ghana_boundary_fixture()["geometry"])
    assert boundary.contains(poly)
    assert not boundary.intersects(shape(OUTSIDE_GHANA_POLYGON_GEOJSON))


def test_fake_key_signs_verifiable_token() -> None:
    key = FakeKey()
    token = key.make_token(groups=["researcher"])
    public = jwt.PyJWK(key.jwk()).key
    claims = jwt.decode(
        token, public, algorithms=["RS256"], options={"verify_iss": False, "verify_aud": False}
    )
    assert claims["client_id"] == FAKE_CLIENT_ID
    assert claims["cognito:groups"] == ["researcher"]
