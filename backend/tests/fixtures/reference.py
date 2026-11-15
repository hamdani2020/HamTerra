"""Reference data reported by the product owner (requirements.md, Introduction).

Polygon-level aggregates only. Values are not independently verified.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any, NamedTuple

FIXTURES_DIR = Path(__file__).parent

REFERENCE_AREA_NAME = "Eco-Sentinel Prestea Test"
REFERENCE_PROVIDER_POLYGON_ID = "6aea6f0f4e13cb67dafaf7d0"
REFERENCE_AREA_HECTARES = 123.36
REFERENCE_SATELLITE = "sentinel-2"


class ReferencePoint(NamedTuple):
    observed_on: date
    ndvi_mean: float
    cloud_coverage: float


# Eight Sentinel-2 points, ascending by date. Data coverage is not reported.
REFERENCE_NDVI_SERIES: tuple[ReferencePoint, ...] = (
    ReferencePoint(date(2026, 1, 25), 0.5198, 4.95),
    ReferencePoint(date(2026, 3, 6), 0.5214, 5.64),
    ReferencePoint(date(2026, 3, 16), 0.5940, 0.06),
    ReferencePoint(date(2026, 3, 21), 0.5858, 0.23),
    ReferencePoint(date(2026, 3, 31), 0.6586, 0.13),
    ReferencePoint(date(2026, 4, 15), 0.6805, 0.0),
    ReferencePoint(date(2026, 4, 22), 0.6303, 0.0),
    ReferencePoint(date(2026, 4, 30), 0.6953, 0.0),
)

# Rectangle near Prestea whose WGS84 geodesic area is about 123.36 ha.
_W = 0.010066
REFERENCE_POLYGON_GEOJSON: dict[str, Any] = {
    "type": "Polygon",
    "coordinates": [
        [
            [-2.14, 5.43],
            [-2.14 + _W, 5.43],
            [-2.14 + _W, 5.44],
            [-2.14, 5.44],
            [-2.14, 5.43],
        ]
    ],
}

# A square well outside Ghana (Gulf of Guinea, far south) for rejection tests.
OUTSIDE_GHANA_POLYGON_GEOJSON: dict[str, Any] = {
    "type": "Polygon",
    "coordinates": [[[10.0, -10.0], [10.01, -10.0], [10.01, -9.99], [10.0, -9.99], [10.0, -10.0]]],
}


def load_ghana_boundary_fixture() -> dict[str, Any]:
    """Coarse Ghana-shaped polygon for tests. Not the production boundary file."""
    data: dict[str, Any] = json.loads(
        (FIXTURES_DIR / "ghana_boundary_small.geojson").read_text(encoding="utf-8")
    )
    return data
