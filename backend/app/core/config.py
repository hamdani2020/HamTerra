"""Application settings loaded from the environment with fail-fast validation.

Errors raised here list variable names only, never values (Requirement 17.3).
"""

from __future__ import annotations

import sys
from functools import lru_cache
from typing import Annotated, Any, Literal

from pydantic import Field, SecretStr, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")
AREA_MAX_HA_LIMIT = 3000.0

REQUIRED_VARIABLES = (
    "DATABASE_URL",
    "COGNITO_USER_POOL_ID",
    "COGNITO_REGION",
    "COGNITO_APP_CLIENT_ID",
    "AGRO_API_KEY",
    "GHANA_BOUNDARY_PATH",
)


class ConfigurationError(Exception):
    """Startup configuration is missing or invalid. The message never contains values."""

    def __init__(self, missing: list[str], invalid: list[tuple[str, str]]) -> None:
        self.missing = missing
        self.invalid = invalid
        parts: list[str] = []
        if missing:
            parts.append("Missing required environment variables: " + ", ".join(missing))
        if invalid:
            parts.append(
                "Invalid environment variables: "
                + "; ".join(f"{name} ({reason})" for name, reason in invalid)
            )
        super().__init__(". ".join(parts))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        extra="ignore",
        env_ignore_empty=True,
        case_sensitive=False,
        hide_input_in_errors=True,
    )

    app_env: str = "development"
    log_level: str = "INFO"
    database_url: SecretStr
    allowed_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)
    max_body_bytes: int = Field(default=1_048_576, ge=1024, le=10_485_760)

    cognito_user_pool_id: str = Field(min_length=1)
    cognito_region: str = Field(min_length=1)
    cognito_app_client_id: str = Field(min_length=1)
    jwks_fetch_timeout_s: float = Field(default=5, ge=1, le=30)
    jwks_min_refresh_interval_s: float = Field(default=60, ge=1)
    cognito_admin_enabled: bool = False
    aws_access_key_id: SecretStr | None = None
    aws_secret_access_key: SecretStr | None = None
    aws_session_token: SecretStr | None = None

    agro_api_key: SecretStr
    agro_base_url: str = "https://api.agromonitoring.com/agro/1.0"
    agro_connect_timeout_s: float = Field(default=5, ge=1, le=30)
    agro_read_timeout_s: float = Field(default=30, ge=1, le=30)
    agro_max_concurrency: int = Field(default=4, ge=1, le=20)
    agro_max_rpm: int = Field(default=30, ge=1, le=60)
    agro_stats_mode: Literal["history", "per_image"] = "history"

    weather_provider: Literal["none", "agromonitoring"] = "none"
    weather_api_key: SecretStr | None = None
    weather_base_url: str | None = None
    weather_max_range_days: int = Field(default=30, ge=1)

    ghana_boundary_path: str = Field(min_length=1)
    area_min_ha: float = Field(default=1, gt=0)
    area_max_ha: float = Field(default=AREA_MAX_HA_LIMIT, gt=0, le=AREA_MAX_HA_LIMIT)
    refresh_max_range_days: int = Field(default=366, ge=1)

    resolution_class_sentinel_2: str = "10 m nominal sensor resolution"
    resolution_class_landsat_8: str = "30 m nominal sensor resolution"

    migrate_on_start: bool = True
    pdf_enabled: bool = False

    @field_validator("log_level", mode="before")
    @classmethod
    def _normalise_log_level(cls, value: Any) -> Any:
        if isinstance(value, str):
            upper = value.strip().upper()
            if upper in LOG_LEVELS:
                return upper
        raise ValueError("must be one of DEBUG, INFO, WARNING, ERROR, CRITICAL")

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: Any) -> Any:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def _check_area_bounds(self) -> Settings:
        if self.area_min_ha > self.area_max_ha:
            raise ValueError("AREA_MIN_HA must not exceed AREA_MAX_HA")
        return self


def load_settings() -> Settings:
    """Build Settings from the environment, or raise ConfigurationError (names only)."""
    try:
        return Settings()
    except ValidationError as exc:
        missing: list[str] = []
        invalid: list[tuple[str, str]] = []
        for err in exc.errors(include_input=False, include_url=False):
            loc = err["loc"]
            name = str(loc[0]).upper() if loc else "SETTINGS"
            if name in REQUIRED_VARIABLES and err["type"] in ("missing", "string_too_short"):
                if name not in missing:
                    missing.append(name)
            else:
                reason = str(err["msg"]).removeprefix("Value error, ")
                invalid.append((name, reason))
        ordered = [n for n in REQUIRED_VARIABLES if n in missing]
        raise ConfigurationError(ordered, invalid) from None


@lru_cache
def get_settings() -> Settings:
    return load_settings()


def load_settings_or_exit() -> Settings:
    """Startup helper: print the names-only message to stderr and exit non-zero."""
    try:
        return get_settings()
    except ConfigurationError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        raise SystemExit(1) from None
