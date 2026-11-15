"""Default provider (``WEATHER_PROVIDER=none``): not configured, never sends a request."""

from __future__ import annotations

from datetime import date

from app.integrations.weather.base import WeatherBatch


class NullWeatherProvider:
    name = "none"
    configured = False

    async def history(self, lat: float, lon: float, start: date, end: date) -> WeatherBatch:
        raise RuntimeError("weather is not configured")

    async def probe(self) -> None:
        raise RuntimeError("weather is not configured")

    async def aclose(self) -> None:
        return None
