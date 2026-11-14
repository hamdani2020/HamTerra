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

# Applied at import time so module-level Settings loading sees dummy values.
os.environ.update(DUMMY_ENV)


@pytest.fixture(autouse=True)
def _dummy_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in DUMMY_ENV.items():
        monkeypatch.setenv(key, value)
