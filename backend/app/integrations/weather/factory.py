"""Build the configured weather provider. A missing key or base URL means not configured."""

from __future__ import annotations

from app.core.config import Settings
from app.integrations.agro.transport import AgroTransport
from app.integrations.weather.agro_weather import AgroWeatherProvider
from app.integrations.weather.base import WeatherProvider
from app.integrations.weather.null import NullWeatherProvider


def build_weather_provider(settings: Settings) -> WeatherProvider:
    key = settings.weather_api_key
    if (
        settings.weather_provider != "agromonitoring"
        or key is None
        or not key.get_secret_value()
        or not settings.weather_base_url
    ):
        return NullWeatherProvider()
    transport = AgroTransport(
        base_url=settings.weather_base_url,
        api_key=key,
        connect_timeout_s=settings.agro_connect_timeout_s,
        read_timeout_s=settings.agro_read_timeout_s,
        max_concurrency=settings.agro_max_concurrency,
        max_rpm=settings.agro_max_rpm,
    )
    return AgroWeatherProvider(transport, max_range_days=settings.weather_max_range_days)
