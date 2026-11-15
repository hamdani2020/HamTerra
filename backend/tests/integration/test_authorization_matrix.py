"""Authorization matrix over every registered endpoint (task 16.1, Requirements 3.2, 3.3, 22.5).

Every non-health route must appear in MATRIX, carry exactly one ``guard`` with the documented
role, and answer 401 without a token, the documented status for a Researcher and an Admin, and
403 for a valid token without a recognised group (except ``/me``).
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx
import pytest
import pytest_asyncio
from fastapi.routing import APIRoute

from app.api.deps import guard_metadata
from app.core.security import Role
from app.db.session import dispose_engine, init_engine
from app.main import API_PREFIX, UNVERSIONED_ROUTERS, discover_routers
from tests.integration.harness import FakeAgro, FakeCognito, FakeWeather, auth, make_app

U = str(uuid.uuid4())
DATES = {"date_from": "2026-01-01", "date_to": "2026-01-31"}
CMP = {"source": "sentinel-2", "date_a": "2026-01-01", "date_b": "2026-02-01"}
REPORT = {"area_id": U, "source": "sentinel-2", **DATES}

R, A, ANY = Role.researcher, Role.admin, None

# (method, template) -> (required role, url, json body, researcher status, admin status)
MATRIX: dict[tuple[str, str], tuple[Role | None, str, Any, int, int]] = {
    ("GET", "/api/v1/me"): (ANY, "/api/v1/me", None, 200, 200),
    ("GET", "/api/v1/areas"): (R, "/api/v1/areas", None, 200, 200),
    ("GET", "/api/v1/areas/map"): (R, "/api/v1/areas/map", None, 200, 200),
    ("GET", "/api/v1/areas/{area_id}"): (R, f"/api/v1/areas/{U}", None, 404, 404),
    ("GET", "/api/v1/areas/{area_id}/observations"): (
        R, f"/api/v1/areas/{U}/observations", None, 404, 404,
    ),
    ("POST", "/api/v1/areas/{area_id}/observations/refresh"): (
        R, f"/api/v1/areas/{U}/observations/refresh", DATES, 404, 404,
    ),
    ("GET", "/api/v1/observations/{observation_id}"): (
        R, f"/api/v1/observations/{U}", None, 404, 404,
    ),
    ("GET", "/api/v1/observations/{observation_id}/preview"): (
        R, f"/api/v1/observations/{U}/preview", None, 404, 404,
    ),
    ("GET", "/api/v1/areas/{area_id}/ndvi/timeseries"): (
        R, f"/api/v1/areas/{U}/ndvi/timeseries?source=sentinel-2", None, 404, 404,
    ),
    ("POST", "/api/v1/areas/{area_id}/comparisons"): (
        R, f"/api/v1/areas/{U}/comparisons", CMP, 404, 404,
    ),
    ("POST", "/api/v1/reports"): (R, "/api/v1/reports", REPORT, 404, 404),
    ("GET", "/api/v1/reports"): (R, "/api/v1/reports", None, 200, 200),
    ("GET", "/api/v1/reports/{report_id}"): (R, f"/api/v1/reports/{U}", None, 404, 404),
    ("GET", "/api/v1/settings"): (R, "/api/v1/settings", None, 200, 200),
    ("GET", "/api/v1/admin/settings"): (A, "/api/v1/admin/settings", None, 403, 200),
    ("PUT", "/api/v1/admin/settings/{key}"): (
        A, "/api/v1/admin/settings/not_a_setting", {"value": 1}, 403, 404,
    ),
    ("GET", "/api/v1/admin/users"): (A, "/api/v1/admin/users", None, 403, 200),
    ("GET", "/api/v1/admin/users/{sub}"): (A, "/api/v1/admin/users/nobody-xyz", None, 403, 404),
    ("PUT", "/api/v1/admin/users/{sub}/roles"): (
        A, "/api/v1/admin/users/nobody-xyz/roles", {"roles": ["researcher"]}, 403, 404,
    ),
    ("POST", "/api/v1/admin/areas"): (A, "/api/v1/admin/areas", {}, 403, 422),
    ("PATCH", "/api/v1/admin/areas/{area_id}"): (
        A, f"/api/v1/admin/areas/{U}", {"name": "x"}, 403, 404,
    ),
    ("POST", "/api/v1/admin/areas/{area_id}/archive"): (
        A, f"/api/v1/admin/areas/{U}/archive", None, 403, 404,
    ),
    ("POST", "/api/v1/admin/areas/{area_id}/restore"): (
        A, f"/api/v1/admin/areas/{U}/restore", None, 403, 404,
    ),
    ("GET", "/api/v1/admin/retrievals"): (A, "/api/v1/admin/retrievals", None, 403, 200),
    ("GET", "/api/v1/admin/integrations/status"): (
        A, "/api/v1/admin/integrations/status", None, 403, 200,
    ),
    ("GET", "/api/v1/admin/activity"): (A, "/api/v1/admin/activity", None, 403, 200),
    ("GET", "/api/v1/admin/dashboard"): (A, "/api/v1/admin/dashboard", None, 403, 200),
}  # fmt: skip


def registered_routes() -> Iterator[tuple[str, str, APIRoute]]:
    """Every (method, full template, route) from the discovered routers, health excluded."""
    for name, router in discover_routers():
        if name in UNVERSIONED_ROUTERS:
            continue
        for route in router.routes:
            assert isinstance(route, APIRoute)
            for method in sorted(route.methods or ()):
                yield method, f"{API_PREFIX}{route.path}", route


def guards_of(route: APIRoute) -> list[tuple[Any, Role | None]]:
    found: list[tuple[Any, Role | None]] = []
    stack = list(route.dependant.dependencies)
    while stack:
        dep = stack.pop()
        meta = guard_metadata(dep.call)
        if meta is not None:
            found.append(meta)
        stack.extend(dep.dependencies)
    return found


def test_every_route_is_in_the_matrix_and_guarded() -> None:
    seen = set()
    for method, path, route in registered_routes():
        key = (method, path)
        seen.add(key)
        assert key in MATRIX, f"{method} {path} is not covered by the authorization matrix"
        guards = guards_of(route)
        assert len(guards) == 1, f"{method} {path} must declare exactly one guard"
        assert guards[0][1] == MATRIX[key][0], f"{method} {path} declares the wrong role"
    assert seen == set(MATRIX), f"stale matrix entries: {set(MATRIX) - seen}"


def test_matrix_matches_openapi() -> None:
    app = make_app(FakeAgro())
    documented = {
        (method.upper(), path)
        for path, item in app.openapi()["paths"].items()
        if not path.startswith("/health")
        for method in item
    }
    assert documented == set(MATRIX)


@pytest_asyncio.fixture
async def client(migrated_database_url: str) -> AsyncIterator[httpx.AsyncClient]:
    init_engine(migrated_database_url)
    app = make_app(FakeAgro(), FakeWeather(), FakeCognito())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c
    await dispose_engine()


@pytest.mark.parametrize("key", sorted(MATRIX), ids=lambda k: f"{k[0]} {k[1]}")
async def test_documented_status(client: httpx.AsyncClient, key: tuple[str, str]) -> None:
    role, url, body, researcher_status, admin_status = MATRIX[key]
    method = key[0]
    kwargs = {"json": body} if body is not None else {}

    async def call(headers: dict[str, str]) -> int:
        r = await client.request(method, url, headers=headers, **kwargs)
        return r.status_code

    assert await call({}) == 401
    assert await call(auth("matrix-norole")) == (200 if role is None else 403)
    assert await call(auth("matrix-researcher", "researcher")) == researcher_status
    assert await call(auth("matrix-admin", "admin")) == admin_status
