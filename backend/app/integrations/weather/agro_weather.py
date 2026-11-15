"""Candidate provider: AgroMonitoring historical weather (``WEATHER_PROVIDER=agromonitoring``).

Not validated against the owner's account (design U5). It reuses the Agro transport, so the
timeout, retry, rate limit and redaction rules of Requirement 5 apply unchanged.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta

from app.integrations.agro.errors import AgroUpstreamError
from app.integrations.agro.transport import AgroTransport
from app.integrations.weather.base import WeatherBatch
from app.integrations.weather.normalize import normalize_records


def _unix(day: date, *, end: bool = False) -> int:
    moment = datetime.combine(day + timedelta(days=1) if end else day, time.min, tzinfo=UTC)
    return int(moment.timestamp()) - (1 if end else 0)


class AgroWeatherProvider:
    name = "agromonitoring"
    configured = True

    def __init__(self, transport: AgroTransport, *, max_range_days: int = 30) -> None:
        self._t = transport
        self._max_range_days = max_range_days

    def chunks(self, start: date, end: date) -> list[tuple[date, date]]:
        """Split ``start..end`` (inclusive) into pieces of at most ``max_range_days`` days."""
        pieces: list[tuple[date, date]] = []
        cursor = start
        while cursor <= end:
            last = min(end, cursor + timedelta(days=self._max_range_days - 1))
            pieces.append((cursor, last))
            cursor = last + timedelta(days=1)
        return pieces

    async def history(self, lat: float, lon: float, start: date, end: date) -> WeatherBatch:
        response = await self._t.request(
            "GET",
            f"{self._t.base_url}/weather/history",
            params={"lat": lat, "lon": lon, "start": _unix(start), "end": _unix(end, end=True)},
            label="weather_history",
        )
        try:
            data = response.json()
        except ValueError:
            raise AgroUpstreamError(
                "The weather provider returned an unreadable response."
            ) from None
        if not isinstance(data, list):
            raise AgroUpstreamError("The weather provider returned an unexpected response.")
        return normalize_records(data)

    async def probe(self) -> None:
        today = datetime.now(UTC).date()
        await self.history(0.0, 0.0, today - timedelta(days=1), today - timedelta(days=1))

    async def aclose(self) -> None:
        await self._t.aclose()
