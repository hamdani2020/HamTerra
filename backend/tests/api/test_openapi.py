"""OpenAPI lists every endpoint of the API contract (task 16.3, Requirement 1.2)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

# The endpoint index of design.md, "API Contract" (health is unversioned).
CONTRACT: set[tuple[str, str]] = {
    ("get", "/health/live"),
    ("get", "/health/ready"),
    ("get", "/api/v1/me"),
    ("get", "/api/v1/areas"),
    ("get", "/api/v1/areas/map"),
    ("get", "/api/v1/areas/{area_id}"),
    ("get", "/api/v1/areas/{area_id}/observations"),
    ("get", "/api/v1/observations/{observation_id}"),
    ("get", "/api/v1/observations/{observation_id}/preview"),
    ("post", "/api/v1/areas/{area_id}/observations/refresh"),
    ("get", "/api/v1/areas/{area_id}/ndvi/timeseries"),
    ("post", "/api/v1/areas/{area_id}/comparisons"),
    ("post", "/api/v1/reports"),
    ("get", "/api/v1/reports"),
    ("get", "/api/v1/reports/{report_id}"),
    ("get", "/api/v1/settings"),
    ("get", "/api/v1/admin/settings"),
    ("put", "/api/v1/admin/settings/{key}"),
    ("get", "/api/v1/admin/users"),
    ("get", "/api/v1/admin/users/{sub}"),
    ("put", "/api/v1/admin/users/{sub}/roles"),
    ("post", "/api/v1/admin/areas"),
    ("patch", "/api/v1/admin/areas/{area_id}"),
    ("post", "/api/v1/admin/areas/{area_id}/archive"),
    ("post", "/api/v1/admin/areas/{area_id}/restore"),
    ("get", "/api/v1/admin/retrievals"),
    ("get", "/api/v1/admin/integrations/status"),
    ("get", "/api/v1/admin/activity"),
    ("get", "/api/v1/admin/dashboard"),
}


def test_openapi_lists_exactly_the_contract() -> None:
    client = TestClient(create_app(Settings()))
    r = client.get("/api/v1/openapi.json")
    assert r.status_code == 200
    doc = r.json()
    assert doc["openapi"].startswith("3.")
    documented = {(m, p) for p, item in doc["paths"].items() for m in item}
    assert documented == CONTRACT
    assert Settings().agro_api_key.get_secret_value() not in r.text
