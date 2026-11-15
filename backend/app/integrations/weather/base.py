"""Weather provider interface (Requirement 10). Weather is context only."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Protocol


@dataclass(frozen=True)
class WeatherRecord:
    """One normalised provider record. Every value has a fixed internal unit."""

    observed_at: datetime  # UTC
    temperature_c: float | None = None  # degrees Celsius
    precipitation_mm: float | None = None  # millimetres
    wind_speed_ms: float | None = None  # metres per second


@dataclass
class WeatherBatch:
    records: list[WeatherRecord] = field(default_factory=list)
    discarded_values: int = 0


class WeatherProvider(Protocol):
    name: str
    configured: bool

    async def history(self, lat: float, lon: float, start: date, end: date) -> WeatherBatch: ...

    async def probe(self) -> None: ...

    async def aclose(self) -> None: ...
