"""Unit tests for startup settings validation (Requirements 17.3, 19.5 to 19.7)."""

from __future__ import annotations

import pytest

from app.core.config import REQUIRED_VARIABLES, ConfigurationError, load_settings

DUMMY = {
    "DATABASE_URL": "postgresql+asyncpg://user:dummy-db-secret@db/test",
    "COGNITO_USER_POOL_ID": "eu-west-1_dummy",
    "COGNITO_REGION": "eu-west-1",
    "COGNITO_APP_CLIENT_ID": "dummy-client",
    "AGRO_API_KEY": "dummy-agro-secret",
    "GHANA_BOUNDARY_PATH": "data/ghana_boundary.geojson",
}

OPTIONAL = (
    "LOG_LEVEL",
    "MAX_BODY_BYTES",
    "AGRO_CONNECT_TIMEOUT_S",
    "AGRO_READ_TIMEOUT_S",
    "AGRO_MAX_CONCURRENCY",
    "AGRO_MAX_RPM",
    "AREA_MIN_HA",
    "AREA_MAX_HA",
    "WEATHER_PROVIDER",
    "WEATHER_API_KEY",
    "WEATHER_BASE_URL",
    "ALLOWED_ORIGINS",
)


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    for name in (*REQUIRED_VARIABLES, *OPTIONAL):
        monkeypatch.delenv(name, raising=False)
    for name, value in DUMMY.items():
        monkeypatch.setenv(name, value)
    return monkeypatch


def test_defaults_load_without_weather(env: pytest.MonkeyPatch) -> None:
    s = load_settings()
    assert s.log_level == "INFO"
    assert s.area_max_ha == 3000
    assert s.agro_max_rpm == 30
    assert s.weather_provider == "none"
    assert s.weather_api_key is None
    assert s.agro_api_key.get_secret_value() == DUMMY["AGRO_API_KEY"]
    assert "dummy-agro-secret" not in repr(s)


def test_all_missing_names_listed_without_values(env: pytest.MonkeyPatch) -> None:
    env.delenv("AGRO_API_KEY")
    env.setenv("COGNITO_REGION", "")
    with pytest.raises(ConfigurationError) as info:
        load_settings()
    msg = str(info.value)
    assert info.value.missing == ["COGNITO_REGION", "AGRO_API_KEY"]
    assert "dummy-db-secret" not in msg


@pytest.mark.parametrize("value", ["debug", "Warning", "CRITICAL"])
def test_log_level_case_insensitive(env: pytest.MonkeyPatch, value: str) -> None:
    env.setenv("LOG_LEVEL", value)
    assert load_settings().log_level == value.upper()


def test_invalid_log_level_names_variable(env: pytest.MonkeyPatch) -> None:
    env.setenv("LOG_LEVEL", "verbose")
    with pytest.raises(ConfigurationError) as info:
        load_settings()
    assert "LOG_LEVEL" in str(info.value)
    assert "verbose" not in str(info.value)


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("AGRO_READ_TIMEOUT_S", "31"),
        ("AGRO_CONNECT_TIMEOUT_S", "0"),
        ("AGRO_MAX_CONCURRENCY", "21"),
        ("AGRO_MAX_RPM", "61"),
        ("MAX_BODY_BYTES", "1023"),
        ("MAX_BODY_BYTES", "10485761"),
        ("AREA_MAX_HA", "3000.01"),
    ],
)
def test_out_of_range_rejected(env: pytest.MonkeyPatch, name: str, value: str) -> None:
    env.setenv(name, value)
    with pytest.raises(ConfigurationError) as info:
        load_settings()
    assert [n for n, _ in info.value.invalid] == [name]


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("AGRO_READ_TIMEOUT_S", "1"),
        ("AGRO_CONNECT_TIMEOUT_S", "30"),
        ("AGRO_MAX_CONCURRENCY", "20"),
        ("AGRO_MAX_RPM", "60"),
        ("MAX_BODY_BYTES", "1024"),
        ("MAX_BODY_BYTES", "10485760"),
        ("AREA_MAX_HA", "3000"),
    ],
)
def test_boundaries_accepted(env: pytest.MonkeyPatch, name: str, value: str) -> None:
    env.setenv(name, value)
    load_settings()


def test_allowed_origins_comma_separated(env: pytest.MonkeyPatch) -> None:
    env.setenv("ALLOWED_ORIGINS", "http://localhost:5173, http://127.0.0.1:5173")
    assert load_settings().allowed_origins == [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
