"""Candidate weather provider over a mocked transport, and provider selection."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.integrations.agro.errors import AgroUpstreamError
from app.integrations.agro.transport import AgroTransport
from app.integrations.weather.agro_weather import AgroWeatherProvider
from app.integrations.weather.factory import build_weather_provider
from app.integrations.weather.null import NullWeatherProvider

KEY = "WEATHER-KEY-123"


def provider(handler: Any, max_days: int = 30) -> tuple[AgroWeatherProvider, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        result: httpx.Response = handler(request)
        return result

    async def no_sleep(_: float) -> None:
        return None

    transport = AgroTransport(
        base_url="https://weather.test/agro/1.0",
        api_key=SecretStr(KEY),
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(wrapped)),
        sleep=no_sleep,
        max_rpm=60,
    )
    return AgroWeatherProvider(transport, max_range_days=max_days), seen


async def test_history_request_and_conversion() -> None:
    ts = int(datetime(2026, 3, 6, 12, tzinfo=UTC).timestamp())
    body = [{"dt": ts, "main": {"temp": 300.15}, "wind": {"speed": 3.5}, "rain": {"1h": 0.4}}]
    p, seen = provider(lambda r: httpx.Response(200, json=body))
    batch = await p.history(5.43, -2.14, date(2026, 3, 6), date(2026, 3, 6))
    (record,) = batch.records
    assert record.temperature_c == pytest.approx(27.0)
    assert (record.wind_speed_ms, record.precipitation_mm) == (3.5, 0.4)
    request = seen[0]
    assert request.url.path.endswith("/weather/history")
    assert request.url.params["appid"] == KEY
    assert request.url.params["start"] == str(int(datetime(2026, 3, 6, tzinfo=UTC).timestamp()))
    assert request.url.params["end"] == str(int(datetime(2026, 3, 7, tzinfo=UTC).timestamp()) - 1)


@pytest.mark.parametrize("body", [{"x": 1}, "text"])
async def test_unexpected_body(body: Any) -> None:
    p, _ = provider(lambda r: httpx.Response(200, json=body))
    with pytest.raises(AgroUpstreamError):
        await p.history(0, 0, date(2026, 1, 1), date(2026, 1, 1))


async def test_retries_follow_requirement_5() -> None:
    p, seen = provider(lambda r: httpx.Response(503, text=KEY))
    with pytest.raises(AgroUpstreamError) as info:
        await p.history(0, 0, date(2026, 1, 1), date(2026, 1, 1))
    assert len(seen) == 4
    assert KEY not in str(info.value)


def test_chunks() -> None:
    p, _ = provider(lambda r: httpx.Response(200, json=[]), max_days=30)
    pieces = p.chunks(date(2026, 1, 1), date(2026, 3, 2))
    assert pieces == [
        (date(2026, 1, 1), date(2026, 1, 30)),
        (date(2026, 1, 31), date(2026, 3, 1)),
        (date(2026, 3, 2), date(2026, 3, 2)),
    ]
    assert p.chunks(date(2026, 1, 1), date(2026, 1, 1)) == [(date(2026, 1, 1), date(2026, 1, 1))]


@pytest.mark.parametrize(
    "overrides",
    [
        {"weather_provider": "none"},
        {
            "weather_provider": "agromonitoring",
            "weather_api_key": "",
            "weather_base_url": "https://x",
        },
        {"weather_provider": "agromonitoring", "weather_api_key": "k", "weather_base_url": ""},
        {"weather_provider": "agromonitoring", "weather_api_key": None, "weather_base_url": None},
    ],
)
def test_not_configured_means_null_provider(overrides: dict[str, Any]) -> None:
    built = build_weather_provider(Settings(**overrides))
    assert isinstance(built, NullWeatherProvider)
    assert built.configured is False


async def test_configured_provider() -> None:
    built = build_weather_provider(
        Settings(
            weather_provider="agromonitoring",
            weather_api_key="dummy-weather",
            weather_base_url="https://weather.test/agro/1.0",
        )
    )
    assert isinstance(built, AgroWeatherProvider) and built.configured
    await built.aclose()
