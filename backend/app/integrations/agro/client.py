"""AgroMonitoring client implementing the ``AgroClient`` protocol (Requirements 5.x).

Statistics come from ``ndvi/history`` by default. With ``AGRO_STATS_MODE=per_image`` the
client searches images and reads the statistics URL of each one instead.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import replace
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Literal
from urllib.parse import quote, urlsplit, urlunsplit

import httpx

from app.core.config import Settings
from app.integrations.agro.errors import AgroClientError, AgroUpstreamError, InvalidProviderRef
from app.integrations.agro.models import (
    DiscardedItem,
    ImageBytes,
    NdviStats,
    NormalizedBatch,
    NormalizedObservation,
    ProviderPolygon,
    Source,
)
from app.integrations.agro.normalize import normalize_batch, parse_ndvi_stats
from app.integrations.agro.transport import AgroTransport

logger = logging.getLogger(__name__)

StatsMode = Literal["history", "per_image"]
# Provider ``type`` filter for ndvi/history. The exact values are to be validated.
_HISTORY_TYPE: dict[Source, str] = {"sentinel-2": "s2", "landsat-8": "l8"}
_MAX_IMAGE_BYTES = 5 * 1024 * 1024


def _unix_start(day: date) -> int:
    return int(datetime.combine(day, time.min, tzinfo=UTC).timestamp())


def _unix_end(day: date) -> int:
    return int(datetime.combine(day + timedelta(days=1), time.min, tzinfo=UTC).timestamp()) - 1


class HttpAgroClient:
    def __init__(
        self,
        transport: AgroTransport,
        *,
        stats_mode: StatsMode = "history",
    ) -> None:
        self._t = transport
        self._stats_mode = stats_mode
        self._host = (urlsplit(transport.base_url).hostname or "").lower()

    async def aclose(self) -> None:
        await self._t.aclose()

    # -- helpers -----------------------------------------------------------------

    def _url(self, path: str) -> str:
        return f"{self._t.base_url}{path}"

    def _resolve_ref(self, ref: str) -> str:
        """Check a stored provider URL points at the provider host, so the key never leaves it."""
        parts = urlsplit(ref)
        if parts.scheme not in ("http", "https") or (parts.hostname or "").lower() != self._host:
            raise InvalidProviderRef("The reference is not a provider URL.")
        return urlunsplit(("https", parts.netloc, parts.path, parts.query, ""))

    @staticmethod
    def _json(response: httpx.Response) -> Any:
        try:
            return response.json()
        except ValueError:
            raise AgroUpstreamError("The provider returned an unreadable response.") from None

    # -- polygons ----------------------------------------------------------------

    async def create_polygon(self, name: str, geometry: dict[str, Any]) -> ProviderPolygon:
        body = {
            "name": name,
            "geo_json": {"type": "Feature", "properties": {}, "geometry": geometry},
        }
        response = await self._t.request(
            "POST", self._url("/polygons"), json=body, label="create_polygon"
        )
        data = self._json(response)
        polygon_id = data.get("id") if isinstance(data, dict) else None
        if not isinstance(polygon_id, str) or not polygon_id:
            raise AgroUpstreamError("The provider returned an unexpected response.")
        area = data.get("area")
        area_ha = (
            float(area) if isinstance(area, int | float) and not isinstance(area, bool) else None
        )
        return ProviderPolygon(id=polygon_id, area_ha=area_ha)

    async def delete_polygon(self, polygon_id: str) -> None:
        """Delete a polygon. A polygon that is already gone counts as deleted."""
        url = self._url(f"/polygons/{quote(polygon_id, safe='')}")
        try:
            await self._t.request("DELETE", url, label="delete_polygon")
        except AgroClientError as exc:
            if exc.upstream_status != 404:
                raise

    # -- observations ------------------------------------------------------------

    async def _list(self, path: str, params: dict[str, Any], label: str) -> list[Any]:
        response = await self._t.request("GET", self._url(path), params=params, label=label)
        data = self._json(response)
        if not isinstance(data, list):
            raise AgroUpstreamError("The provider returned an unexpected response.")
        return data

    @staticmethod
    def _only(batch: NormalizedBatch, source: Source) -> NormalizedBatch:
        """Keep one sensor per batch. Items of the other sensor are not mixed in."""
        batch.items = [i for i in batch.items if i.source == source]
        return batch

    async def image_search(
        self, polygon_id: str, source: Source, start: date, end: date, *, area_id: str = ""
    ) -> NormalizedBatch:
        raw = await self._list(
            "/image/search",
            {"polyid": polygon_id, "start": _unix_start(start), "end": _unix_end(end)},
            "image_search",
        )
        return self._only(normalize_batch(raw, area_id=area_id, kind="images"), source)

    async def ndvi_history(
        self, polygon_id: str, source: Source, start: date, end: date, *, area_id: str = ""
    ) -> NormalizedBatch:
        if self._stats_mode == "per_image":
            return await self._history_per_image(polygon_id, source, start, end, area_id)
        raw = await self._list(
            "/ndvi/history",
            {
                "polyid": polygon_id,
                "start": _unix_start(start),
                "end": _unix_end(end),
                "type": _HISTORY_TYPE[source],
            },
            "ndvi_history",
        )
        return self._only(normalize_batch(raw, area_id=area_id, kind="history"), source)

    async def _history_per_image(
        self, polygon_id: str, source: Source, start: date, end: date, area_id: str
    ) -> NormalizedBatch:
        batch = await self.image_search(polygon_id, source, start, end, area_id=area_id)
        results = await asyncio.gather(*(self._item_stats(i) for i in batch.items))
        kept: list[NormalizedObservation] = []
        for item, stats in zip(batch.items, results, strict=True):
            if stats is None:
                logger.warning(
                    "provider_item_discarded",
                    extra={"area_id": area_id, "field": "stats", "reason": "unavailable"},
                )
                batch.discarded.append(DiscardedItem(area_id, "stats", "unavailable"))
            else:
                kept.append(replace(item, ndvi=stats))
        batch.items = kept
        batch.scene_metadata = True
        return batch

    async def _item_stats(self, item: NormalizedObservation) -> NdviStats | None:
        if item.stats_ref is None:
            return None
        try:
            url = self._resolve_ref(item.stats_ref)
            response = await self._t.request("GET", url, label="ndvi_stats")
        except (AgroClientError, InvalidProviderRef):
            return None
        return parse_ndvi_stats(self._json(response))

    # -- images and health -------------------------------------------------------

    async def fetch_image(self, image_ref: str) -> ImageBytes:
        """Fetch a preview PNG. Raises ``InvalidProviderRef`` for a non-provider URL."""
        response = await self._t.request("GET", self._resolve_ref(image_ref), label="fetch_image")
        content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
        content = response.content
        if not content_type.startswith("image/") or not content or len(content) > _MAX_IMAGE_BYTES:
            raise AgroUpstreamError("The provider returned an unexpected image response.")
        return ImageBytes(content=content, content_type=content_type)

    async def probe(self) -> None:
        """Cheap authenticated call used for the integration status."""
        await self._t.request("GET", self._url("/polygons"), label="probe")


def build_agro_client(settings: Settings) -> HttpAgroClient:
    transport = AgroTransport(
        base_url=settings.agro_base_url,
        api_key=settings.agro_api_key,
        connect_timeout_s=settings.agro_connect_timeout_s,
        read_timeout_s=settings.agro_read_timeout_s,
        max_concurrency=settings.agro_max_concurrency,
        max_rpm=settings.agro_max_rpm,
    )
    return HttpAgroClient(transport, stats_mode=settings.agro_stats_mode)
