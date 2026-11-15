"""Monitoring area API against PostGIS with a fake provider client (task 7.9)."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

import httpx
import pytest
import pytest_asyncio
from shapely.geometry import shape
from shapely.prepared import prep
from sqlalchemy import func, select, text

from app.core.config import Settings
from app.core.errors import InternalError
from app.db.models.areas import Area
from app.db.models.audit import AuditEvent
from app.db.models.observations import Observation
from app.db.session import dispose_engine, get_sessionmaker, init_engine
from app.integrations.agro.errors import AgroTimeoutError, AgroUpstreamError
from app.integrations.agro.models import ProviderPolygon
from app.integrations.cognito.jwks import JwksCache
from app.integrations.cognito.validator import TokenValidator
from app.main import create_app
from app.services import areas as area_service
from app.services import audit
from tests.fixtures.jwt_keys import FAKE_CLIENT_ID, FAKE_ISSUER, FakeKey
from tests.fixtures.reference import (
    OUTSIDE_GHANA_POLYGON_GEOJSON,
    REFERENCE_AREA_HECTARES,
    REFERENCE_POLYGON_GEOJSON,
    load_ghana_boundary_fixture,
)

KEY = FakeKey("kid-areas")


class FakeAgro:
    def __init__(self) -> None:
        self.created: list[tuple[str, dict[str, Any]]] = []
        self.deleted: list[str] = []
        self.fail: Exception | None = None
        self.delay_s = 0.0
        self.delete_fails = False

    async def create_polygon(self, name: str, geometry: dict[str, Any]) -> ProviderPolygon:
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        if self.fail is not None:
            raise self.fail
        self.created.append((name, geometry))
        return ProviderPolygon(id=f"poly-{len(self.created)}", area_ha=None)

    async def delete_polygon(self, polygon_id: str) -> None:
        if self.delete_fails:
            raise AgroUpstreamError()
        self.deleted.append(polygon_id)


def rect(lon: float, lat: float, w: float = 0.01, h: float = 0.01) -> dict[str, Any]:
    ring = [[lon, lat], [lon + w, lat], [lon + w, lat + h], [lon, lat + h], [lon, lat]]
    return {"type": "Polygon", "coordinates": [ring]}


@dataclass
class Api:
    client: httpx.AsyncClient
    agro: FakeAgro
    tag: str
    sub: str = ""
    extra: list[Any] = field(default_factory=list)

    def headers(self, *groups: str) -> dict[str, str]:
        token = KEY.make_token(sub=self.sub, groups=list(groups))
        return {"Authorization": f"Bearer {token}"}

    @property
    def admin(self) -> dict[str, str]:
        return self.headers("admin")

    @property
    def researcher(self) -> dict[str, str]:
        return self.headers("researcher")

    def name(self, label: str = "a") -> str:
        return f"{self.tag}-{label}"

    async def create(self, label: str = "a", geometry: Any = None, **extra: Any) -> httpx.Response:
        body = {"name": self.name(label), "geometry": geometry or REFERENCE_POLYGON_GEOJSON}
        body.update(extra)
        return await self.client.post("/api/v1/admin/areas", json=body, headers=self.admin)

    async def get(self, url: str, **params: Any) -> httpx.Response:
        return await self.client.get(url, params=params or None, headers=self.researcher)

    async def count_areas(self) -> int:
        async with get_sessionmaker()() as s:
            return int(
                await s.scalar(select(func.count()).where(Area.name.like(f"{self.tag}-%"))) or 0
            )


@pytest_asyncio.fixture
async def api(migrated_database_url: str) -> AsyncIterator[Api]:
    init_engine(migrated_database_url)
    app = create_app(Settings())
    app.state.token_validator = TokenValidator(
        cache=JwksCache(_jwks), issuer=FAKE_ISSUER, client_id=FAKE_CLIENT_ID
    )
    boundary = prep(shape(load_ghana_boundary_fixture()["geometry"]))
    app.state.ghana_boundary = boundary
    agro = FakeAgro()
    app.state.agro_client = agro
    tag = f"t{uuid.uuid4().hex[:10]}"
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield Api(client=client, agro=agro, tag=tag, sub=f"sub-{tag}")
    async with get_sessionmaker()() as s:
        await s.execute(
            text(
                "DELETE FROM observations WHERE area_id IN "
                "(SELECT id FROM areas WHERE name LIKE :p)"
            ),
            {"p": f"{tag}-%"},
        )  # noqa: E501
        await s.execute(text("DELETE FROM areas WHERE name LIKE :p"), {"p": f"{tag}-%"})
        await s.execute(text("DELETE FROM users WHERE sub = :s"), {"s": f"sub-{tag}"})
        await s.commit()
    await dispose_engine()


async def _jwks() -> dict[str, Any]:
    return KEY.jwks()


async def add_observation(area_id: str, day: date, source: str = "sentinel-2") -> None:
    async with get_sessionmaker()() as s:
        s.add(
            Observation(
                area_id=uuid.UUID(area_id),
                source=source,
                acquired_on=day,
                cloud_coverage=Decimal("1.5"),
                ndvi_mean=Decimal("0.5"),
            )
        )
        await s.commit()


async def audit_rows(api: Api) -> list[AuditEvent]:
    async with get_sessionmaker()() as s:
        return list(
            (await s.scalars(select(AuditEvent).where(AuditEvent.actor_sub == api.sub))).all()
        )


# --- create ---------------------------------------------------------------------


async def test_create_area(api: Api) -> None:
    r = await api.create(description="  First area ")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == api.name()
    assert body["description"] == "First area"
    assert body["status"] == "active"
    assert body["area_ha"] == pytest.approx(REFERENCE_AREA_HECTARES, rel=0.01)
    assert body["geometry"]["type"] == "Polygon"
    assert body["external_polygon_id"] == "poly-1"
    assert body["latest_observation_date"] is None
    assert body["created_at"].endswith("Z")
    assert len(api.agro.created) == 1
    async with get_sessionmaker()() as s:
        row = (
            await s.execute(
                text(
                    "SELECT ST_SRID(geom), area_ha, created_by IS NOT NULL FROM areas WHERE id = :i"
                ),
                {"i": body["id"]},
            )
        ).one()
    assert row[0] == 4326
    assert float(row[1]) == body["area_ha"]
    assert row[2] is True
    (event,) = [e for e in await audit_rows(api) if e.action == "area.create"]
    assert event.target_id == body["id"]
    assert event.outcome == "success"
    assert "geometry" not in event.details and "coordinates" not in str(event.details)


async def test_duplicate_name_is_409_without_provider_call(api: Api) -> None:
    assert (await api.create()).status_code == 201
    r = await api.client.post(
        "/api/v1/admin/areas",
        json={"name": api.name().upper(), "geometry": rect(-1.2, 7.2)},
        headers=api.admin,
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "CONFLICT"
    assert len(api.agro.created) == 1


async def test_outside_ghana_and_area_range(api: Api) -> None:
    r = await api.create(geometry=OUTSIDE_GHANA_POLYGON_GEOJSON)
    assert (r.status_code, r.json()["error"]["code"]) == (422, "GEOMETRY_OUTSIDE_GHANA")
    r = await api.create(geometry=rect(-1.0, 7.0, 0.0005, 0.0005))
    assert (r.status_code, r.json()["error"]["code"]) == (422, "AREA_OUT_OF_RANGE")
    assert r.json()["error"]["details"]["area_ha"] < 1
    r = await api.create(geometry=rect(-1.0, 7.0, 0.2, 0.2))
    assert (r.status_code, r.json()["error"]["code"]) == (422, "AREA_OUT_OF_RANGE")
    assert api.agro.created == []
    assert await api.count_areas() == 0


async def test_invalid_input_is_422(api: Api) -> None:
    bow_tie = {
        "type": "Polygon",
        "coordinates": [[[-1, 7], [-0.99, 7.01], [-0.99, 7], [-1, 7.01], [-1, 7]]],
    }
    r = await api.create(geometry=bow_tie)
    assert r.status_code == 422
    assert r.json()["error"]["details"]["defect"] == "SELF_INTERSECTION"
    for body in (
        {"name": "  ", "geometry": rect(-1, 7)},
        {"name": "x" * 101, "geometry": rect(-1, 7)},
        {"name": "x", "geometry": rect(-1, 7), "status": "archived"},
        {"name": "x", "geometry": "not-an-object"},
        {"name": "x"},
    ):
        r = await api.client.post("/api/v1/admin/areas", json=body, headers=api.admin)
        assert r.status_code == 422
    assert await api.count_areas() == 0


async def test_provider_failure_stores_nothing(api: Api) -> None:
    api.agro.fail = AgroUpstreamError()
    r = await api.create()
    assert (r.status_code, r.json()["error"]["code"]) == (502, "UPSTREAM_ERROR")
    api.agro.fail = AgroTimeoutError()
    r = await api.create()
    assert (r.status_code, r.json()["error"]["code"]) == (504, "UPSTREAM_TIMEOUT")
    assert await api.count_areas() == 0


async def test_provider_registration_timeout(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(area_service, "PROVIDER_REGISTRATION_TIMEOUT_S", 0.05)
    api.agro.delay_s = 1.0
    r = await api.create()
    assert r.status_code == 504
    assert await api.count_areas() == 0


async def test_audit_failure_rolls_back_and_removes_provider_polygon(
    api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def broken(*_: Any, **__: Any) -> None:
        raise InternalError(details={"reason": "audit_write_failed"})

    monkeypatch.setattr(audit, "record", broken)
    r = await api.create()
    assert r.status_code == 500
    assert await api.count_areas() == 0
    assert api.agro.deleted == ["poly-1"]


async def test_cleanup_failure_does_not_mask_the_error(
    api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def broken(*_: Any, **__: Any) -> None:
        raise InternalError()

    monkeypatch.setattr(audit, "record", broken)
    api.agro.delete_fails = True
    assert (await api.create()).status_code == 500


# --- update, archive, restore -----------------------------------------------------


async def test_geometry_update_marks_observations_stale(api: Api) -> None:
    created = (await api.create()).json()
    await add_observation(created["id"], date(2026, 3, 1))
    await add_observation(created["id"], date(2026, 3, 1), source="landsat-8")

    r = await api.client.patch(
        f"/api/v1/admin/areas/{created['id']}",
        json={"geometry": rect(-1.1, 7.1, 0.02, 0.02)},
        headers=api.admin,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["external_polygon_id"] == "poly-2"
    assert body["area_ha"] > created["area_ha"] * 3
    assert api.agro.deleted == ["poly-1"]
    async with get_sessionmaker()() as s:
        statuses = (
            await s.scalars(
                select(Observation.geometry_status).where(
                    Observation.area_id == uuid.UUID(created["id"])
                )
            )
        ).all()
    assert list(statuses) == ["stale_geometry", "stale_geometry"]
    event = [e for e in await audit_rows(api) if e.action == "area.update"][0]
    assert event.details == {"changed_fields": ["geometry"]}


async def test_failed_geometry_update_changes_nothing(api: Api) -> None:
    created = (await api.create()).json()
    await add_observation(created["id"], date(2026, 3, 1))
    for geometry in (OUTSIDE_GHANA_POLYGON_GEOJSON, rect(-1, 7, 0.0005, 0.0005)):
        r = await api.client.patch(
            f"/api/v1/admin/areas/{created['id']}", json={"geometry": geometry}, headers=api.admin
        )
        assert r.status_code == 422
    # provider failure on replacement
    api.agro.fail = AgroUpstreamError()
    r = await api.client.patch(
        f"/api/v1/admin/areas/{created['id']}",
        json={"geometry": rect(-1.1, 7.1)},
        headers=api.admin,
    )
    assert r.status_code == 502
    after = (await api.client.get(f"/api/v1/areas/{created['id']}", headers=api.researcher)).json()
    assert after["geometry"] == created["geometry"]
    assert after["external_polygon_id"] == "poly-1"
    assert api.agro.deleted == []
    async with get_sessionmaker()() as s:
        assert (
            await s.scalar(
                select(Observation.geometry_status).where(
                    Observation.area_id == uuid.UUID(created["id"])
                )
            )
            == "current"
        )


async def test_update_name_description_and_conflicts(api: Api) -> None:
    a = (await api.create("a")).json()
    b = (await api.create("b", geometry=rect(-1.3, 7.3))).json()
    url = f"/api/v1/admin/areas/{b['id']}"
    r = await api.client.patch(url, json={"name": api.name("a").upper()}, headers=api.admin)
    assert r.status_code == 409
    r = await api.client.patch(
        url, json={"name": api.name("c"), "description": None}, headers=api.admin
    )
    assert r.status_code == 200
    assert r.json()["name"] == api.name("c")
    assert r.json()["description"] is None
    assert api.agro.created.__len__() == 2  # no provider call for a name-only change
    for body in ({}, {"name": None}, {"geometry": None}, {"status": "archived"}):
        r = await api.client.patch(url, json=body, headers=api.admin)
        assert r.status_code == 422
    missing = f"/api/v1/admin/areas/{uuid.uuid4()}"
    assert (
        await api.client.patch(missing, json={"name": "x"}, headers=api.admin)
    ).status_code == 404
    del a


async def test_archive_hides_and_restore_checks_name_clash(api: Api) -> None:
    a = (await api.create("a")).json()
    base = f"/api/v1/admin/areas/{a['id']}"
    r = await api.client.post(f"{base}/archive", headers=api.admin)
    assert (r.status_code, r.json()["status"]) == (200, "archived")
    listing = f"/api/v1/areas?q={api.tag}"
    assert (await api.client.get(listing, headers=api.researcher)).json()["total"] == 0
    r = await api.client.get(f"{listing}&status=archived", headers=api.researcher)
    assert r.json()["total"] == 1
    assert (await api.client.get(f"{listing}&status=all", headers=api.researcher)).json()[
        "total"
    ] == 1

    assert (
        await api.create("a", geometry=rect(-1.3, 7.3))
    ).status_code == 201  # name is free again
    r = await api.client.post(f"{base}/restore", headers=api.admin)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "CONFLICT")

    other = (await api.create("z", geometry=rect(-1.5, 7.5))).json()
    await api.client.post(f"/api/v1/admin/areas/{other['id']}/archive", headers=api.admin)
    r = await api.client.post(f"/api/v1/admin/areas/{other['id']}/restore", headers=api.admin)
    assert (r.status_code, r.json()["status"]) == (200, "active")
    actions = sorted(e.action for e in await audit_rows(api))
    assert actions.count("area.archive") == 2 and actions.count("area.restore") == 1
    for verb in ("archive", "restore"):
        missing = f"/api/v1/admin/areas/{uuid.uuid4()}/{verb}"
        assert (await api.client.post(missing, headers=api.admin)).status_code == 404


# --- reads ------------------------------------------------------------------------


async def test_list_filters_pagination_and_geometry(api: Api) -> None:
    for i, label in enumerate(["alpha", "beta", "gamma"]):
        await api.create(label, geometry=rect(-1.0 + i * 0.1, 7.0))
    base = f"/api/v1/areas?q={api.tag}"
    page = (await api.client.get(f"{base}&limit=2&offset=2", headers=api.researcher)).json()
    assert (page["total"], page["limit"], page["offset"]) == (3, 2, 2)
    assert [i["name"] for i in page["items"]] == [api.name("gamma")]
    assert "geometry" not in page["items"][0]
    assert "latest_observation_date" in page["items"][0]

    with_geo = (
        await api.client.get(f"{base}&include_geometry=true", headers=api.researcher)
    ).json()
    assert all(i["geometry"]["type"] == "Polygon" for i in with_geo["items"])

    ci = (
        await api.client.get(f"/api/v1/areas?q={api.tag.upper()}-BETA", headers=api.researcher)
    ).json()
    assert ci["total"] == 1
    wildcard = (
        await api.client.get(f"/api/v1/areas?q={api.tag}%25", headers=api.researcher)
    ).json()
    assert wildcard["total"] == 0  # '%' is literal text, not a wildcard

    inside = await api.client.get(f"{base}&bbox=-1.05,6.9,-0.95,7.1", headers=api.researcher)
    assert [i["name"] for i in inside.json()["items"]] == [api.name("alpha")]
    outside = await api.client.get(f"{base}&bbox=0.5,9,0.6,9.1", headers=api.researcher)
    assert outside.json()["total"] == 0


@pytest.mark.parametrize(
    "bbox", ["1,2,3", "a,b,c,d", "5,0,1,1", "0,5,1,1", "-181,0,0,1", "0,-91,1,0", ""]
)
async def test_bad_bbox_is_422_naming_bbox(api: Api, bbox: str) -> None:
    for path in ("/api/v1/areas", "/api/v1/areas/map"):
        r = await api.client.get(path, params={"bbox": bbox}, headers=api.researcher)
        assert r.status_code == 422
        assert r.json()["error"]["details"]["fields"][0]["field"] == "bbox"


async def test_map_features(api: Api) -> None:
    a = (await api.create("a")).json()
    await api.create("b", geometry=rect(-0.5, 8.0))
    await add_observation(a["id"], date(2026, 3, 1))
    await add_observation(a["id"], date(2026, 4, 30), source="landsat-8")
    r = await api.get("/api/v1/areas/map", bbox="-2.2,5.3,0.0,8.2")
    assert r.status_code == 200
    mine = {
        f["properties"]["name"]: f
        for f in r.json()["features"]
        if api.tag in f["properties"]["name"]
    }
    assert r.json()["type"] == "FeatureCollection"
    assert mine[api.name("a")]["properties"]["latest_observation_date"] == "2026-04-30"
    assert mine[api.name("b")]["properties"]["latest_observation_date"] is None
    assert set(mine[api.name("a")]["properties"]) == {
        "id",
        "name",
        "area_ha",
        "latest_observation_date",
    }
    assert mine[api.name("a")]["geometry"]["type"] == "Polygon"


async def test_detail_and_ids(api: Api) -> None:
    a = (await api.create()).json()
    r = await api.client.get(f"/api/v1/areas/{a['id']}", headers=api.researcher)
    assert r.status_code == 200 and r.json()["geometry"]["type"] == "Polygon"
    assert (
        await api.client.get(f"/api/v1/areas/{uuid.uuid4()}", headers=api.researcher)
    ).status_code == 404
    assert (
        await api.client.get("/api/v1/areas/not-a-uuid", headers=api.researcher)
    ).status_code == 422


async def test_roles_are_enforced(api: Api) -> None:
    created = (await api.create()).json()
    admin_calls = [
        ("POST", "/api/v1/admin/areas"),
        ("PATCH", f"/api/v1/admin/areas/{created['id']}"),
        ("POST", f"/api/v1/admin/areas/{created['id']}/archive"),
        ("POST", f"/api/v1/admin/areas/{created['id']}/restore"),
    ]
    for method, url in admin_calls:
        r = await api.client.request(method, url, json={"name": "x"}, headers=api.researcher)
        assert r.status_code == 403
    for url in ("/api/v1/areas", "/api/v1/areas/map", f"/api/v1/areas/{created['id']}"):
        assert (await api.client.get(url, headers=api.headers())).status_code == 403
        assert (await api.client.get(url, headers=api.researcher)).status_code == 200
        assert (await api.client.get(url)).status_code == 401
    assert await api.count_areas() == 1


async def test_bbox_query_uses_the_spatial_index(api: Api) -> None:
    await api.create()
    async with get_sessionmaker()() as s:
        await s.execute(text("SET LOCAL enable_seqscan = off"))
        plan = "\n".join(
            row[0]
            for row in await s.execute(
                text(
                    "EXPLAIN SELECT id FROM areas WHERE "
                    "ST_Intersects(geom, ST_MakeEnvelope(-2, 5, 0, 8, 4326))"
                )
            )
        )
    assert "ix_areas_geom" in plan
