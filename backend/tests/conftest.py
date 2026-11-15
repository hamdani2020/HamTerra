"""Test configuration.

Sets dummy environment values before any application import so that real
credentials are never read. Network access is blocked by pytest-socket
(``--allow-hosts=postgis`` in pyproject.toml).
"""

import os

import pytest

DUMMY_ENV: dict[str, str] = {
    "APP_ENV": "development",
    "LOG_LEVEL": "INFO",
    "DATABASE_URL": "postgresql+asyncpg://test:test@postgis:5432/eco_test",
    "COGNITO_USER_POOL_ID": "eu-west-1_dummy",
    "COGNITO_REGION": "eu-west-1",
    "COGNITO_APP_CLIENT_ID": "dummy-client-id",
    "AGRO_API_KEY": "dummy-agro-key",
    "GHANA_BOUNDARY_PATH": "data/ghana_boundary.geojson",
    "WEATHER_PROVIDER": "none",
    "COGNITO_ADMIN_ENABLED": "false",
    "MIGRATE_ON_START": "false",
    # Credentials are forced to dummy values so real ones are never picked up.
    "AWS_ACCESS_KEY_ID": "dummy",
    "AWS_SECRET_ACCESS_KEY": "dummy",
    "AWS_SESSION_TOKEN": "dummy",
    "AWS_PROFILE": "",
    "AWS_EC2_METADATA_DISABLED": "true",
    "WEATHER_API_KEY": "",
}


def _default_test_database_url() -> str | None:
    """In the backend container, use the Compose database server with a separate
    ``eco_test`` database, so ``make test`` also runs the PostGIS integration tests.
    The application database itself is never used by the tests."""
    real = os.environ.get("DATABASE_URL")
    if not real or "TEST_DATABASE_URL" in os.environ:
        return None
    from sqlalchemy.engine import make_url

    try:
        url = make_url(real)
    except Exception:  # noqa: BLE001 - an unusable URL just means no default
        return None
    if url.host != "postgis" or not url.drivername.startswith("postgresql+asyncpg"):
        return None
    return url.set(database="eco_test").render_as_string(hide_password=False)


_test_db = _default_test_database_url()
if _test_db is not None:
    os.environ["TEST_DATABASE_URL"] = _test_db

# Applied at import time so module-level Settings loading sees dummy values.
os.environ.update(DUMMY_ENV)


@pytest.fixture(autouse=True)
def _dummy_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in DUMMY_ENV.items():
        monkeypatch.setenv(key, value)
