"""Provider item normalisation (Requirements 5.7, 5.8, 5.9).

An item becomes a ``NormalizedObservation`` or a ``DiscardedItem``. A missing ``dc``
stays ``None``: it is never derived from ``100 - cl``.
"""

from __future__ import annotations

import logging
import math
import re
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.core.redaction import is_sensitive_param
from app.integrations.agro.models import (
    DiscardedItem,
    NdviStats,
    NormalizedBatch,
    NormalizedObservation,
    Source,
)

logger = logging.getLogger(__name__)

ItemKind = Literal["history", "images"]

_SOURCE_ALIASES: dict[str, Source] = {
    "sentinel2": "sentinel-2",
    "s2": "sentinel-2",
    "landsat8": "landsat-8",
    "l8": "landsat-8",
}
_MAX_TIMESTAMP = 253_402_300_799  # 9999-12-31T23:59:59Z


class _Discard(Exception):
    def __init__(self, field: str, reason: str) -> None:
        self.field = field
        self.reason = reason


def parse_source(value: Any) -> Source | None:
    if not isinstance(value, str):
        return None
    return _SOURCE_ALIASES.get(re.sub(r"[^a-z0-9]", "", value.lower()))


def _number(value: Any) -> float | None:
    """A finite number, or None. Booleans and strings are not numbers."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _required_percent(raw: dict[str, Any], name: str) -> float:
    if name not in raw:
        raise _Discard(name, "missing")
    number = _number(raw[name])
    if number is None:
        raise _Discard(name, "not_a_number")
    if not 0 <= number <= 100:
        raise _Discard(name, "out_of_range")
    return number


def _optional_percent(raw: dict[str, Any], name: str) -> float | None:
    if raw.get(name) is None:
        return None
    return _required_percent(raw, name)


def _acquired_on(raw: dict[str, Any]) -> Any:
    value = raw.get("dt")
    if value is None:
        raise _Discard("dt", "missing")
    if isinstance(value, bool) or not isinstance(value, int):
        raise _Discard("dt", "not_an_integer")
    if not 0 <= value <= _MAX_TIMESTAMP:
        raise _Discard("dt", "out_of_range")
    return datetime.fromtimestamp(value, tz=UTC).date()


def _optional_stat(data: dict[str, Any], name: str) -> float | None:
    return _number(data.get(name))


def _ndvi(raw: dict[str, Any], *, required: bool) -> NdviStats | None:
    data = raw.get("data")
    if not isinstance(data, dict):
        if required:
            raise _Discard("data", "missing")
        return None
    mean = _number(data.get("mean"))
    if mean is None or not -1 <= mean <= 1:
        raise _Discard("data.mean", "missing_or_out_of_range")
    return NdviStats(
        mean=mean,
        min=_optional_stat(data, "min"),
        max=_optional_stat(data, "max"),
        std=_optional_stat(data, "std"),
        median=_optional_stat(data, "median"),
    )


def parse_ndvi_stats(data: Any) -> NdviStats | None:
    """NDVI statistics from a provider ``stats`` payload, or None when unusable."""
    try:
        return _ndvi({"data": data}, required=True)
    except _Discard:
        return None


def strip_credentials(url: Any) -> str | None:
    """Return the URL with its ``appid`` (and similar) query values removed entirely."""
    if not isinstance(url, str) or not url:
        return None
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    kept = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not is_sensitive_param(k)
    ]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(kept), ""))


def _nested_ref(raw: dict[str, Any], group: str) -> str | None:
    value = raw.get(group)
    return strip_credentials(value.get("ndvi")) if isinstance(value, dict) else None


def normalize_item(raw: Any, kind: ItemKind) -> NormalizedObservation:
    """Normalise one provider item or raise ``_Discard``."""
    if not isinstance(raw, dict):
        raise _Discard("item", "not_an_object")
    source = parse_source(raw.get("source") if "source" in raw else raw.get("type"))
    if source is None:
        raise _Discard("source", "unknown_or_missing")
    return NormalizedObservation(
        source=source,
        acquired_on=_acquired_on(raw),
        # ndvi/history reports cl and dc as 100 for every scene (verified against the API),
        # so only image/search scenes supply them; history values are not used.
        cloud_coverage=_required_percent(raw, "cl") if kind == "images" else None,
        data_coverage=_optional_percent(raw, "dc") if kind == "images" else None,
        # In image/search items ``data`` is a group of GeoTIFF URLs, not statistics; their
        # statistics come from the ``stats.ndvi`` URL instead (verified against the API).
        ndvi=_ndvi(raw, required=True) if kind == "history" else None,
        preview_ref=_nested_ref(raw, "image"),
        stats_ref=_nested_ref(raw, "stats"),
    )


def _cloud_rank(item: NormalizedObservation) -> float:
    return math.inf if item.cloud_coverage is None else item.cloud_coverage


def normalize_batch(raw_items: Iterable[Any], *, area_id: str, kind: ItemKind) -> NormalizedBatch:
    """Normalise a list. For duplicate ``(source, date)`` keep the lower cloud coverage."""
    batch = NormalizedBatch()
    best: dict[tuple[str, Any], NormalizedObservation] = {}
    for raw in raw_items:
        try:
            item = normalize_item(raw, kind)
        except _Discard as exc:
            logger.warning(
                "provider_item_discarded",
                extra={"area_id": area_id, "field": exc.field, "reason": exc.reason},
            )
            batch.discarded.append(DiscardedItem(area_id, exc.field, exc.reason))
            continue
        key = (item.source, item.acquired_on)
        current = best.get(key)
        batch.skipped_duplicates += current is not None
        if current is None or _cloud_rank(item) < _cloud_rank(current):
            best[key] = item
    batch.items = sorted(best.values(), key=lambda i: (i.source, i.acquired_on))
    return batch
