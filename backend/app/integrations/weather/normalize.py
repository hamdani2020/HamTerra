"""Normalise AgroMonitoring historical weather records (candidate provider, design U5).

Assumed record shape, partly unverified: ``dt`` (Unix seconds), ``main.temp`` in Kelvin
(the provider default when no ``units`` parameter is sent), ``wind.speed`` in m/s and an
optional ``rain`` object. Only ``rain["1h"]`` (mm) is used. A record without ``rain`` reports
no precipitation value; a ``rain`` object without a usable ``1h`` value is discarded.
The exact rain field is an open item in the design (U5).
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

from app.integrations.weather.base import WeatherBatch, WeatherRecord

KELVIN_OFFSET = 273.15
_MAX_TS = 253_402_300_799


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def kelvin_to_celsius(kelvin: float) -> float:
    return kelvin - KELVIN_OFFSET


def normalize_record(raw: Any) -> tuple[WeatherRecord | None, int]:
    """Return the record (None when it has no timestamp) and the count of discarded values."""
    if not isinstance(raw, dict):
        return None, 1
    dt = raw.get("dt")
    if isinstance(dt, bool) or not isinstance(dt, int) or not 0 <= dt <= _MAX_TS:
        return None, 1
    discarded = 0

    main = raw.get("main")
    kelvin = _number(main.get("temp")) if isinstance(main, dict) else None
    temperature = kelvin_to_celsius(kelvin) if kelvin is not None and kelvin >= 0 else None
    if temperature is None:
        discarded += 1

    wind = raw.get("wind")
    speed = _number(wind.get("speed")) if isinstance(wind, dict) else None
    if speed is not None and speed < 0:
        speed = None
    if speed is None:
        discarded += 1

    precipitation: float | None = None
    if "rain" in raw:
        rain = raw["rain"]
        value = _number(rain.get("1h")) if isinstance(rain, dict) else None
        if value is None or value < 0:
            discarded += 1
        else:
            precipitation = value

    record = WeatherRecord(
        observed_at=datetime.fromtimestamp(dt, tz=UTC),
        temperature_c=temperature,
        precipitation_mm=precipitation,
        wind_speed_ms=speed,
    )
    return record, discarded


def normalize_records(raw_items: Iterable[Any]) -> WeatherBatch:
    batch = WeatherBatch()
    for raw in raw_items:
        record, discarded = normalize_record(raw)
        batch.discarded_values += discarded
        if record is not None:
            batch.records.append(record)
    return batch
