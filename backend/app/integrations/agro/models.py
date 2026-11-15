"""Internal shapes for provider data. Services see only these, never raw provider JSON."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal, Protocol

Source = Literal["sentinel-2", "landsat-8"]
SOURCES: tuple[Source, ...] = ("sentinel-2", "landsat-8")


@dataclass(frozen=True)
class ProviderPolygon:
    id: str
    area_ha: float | None


@dataclass(frozen=True)
class NdviStats:
    """Polygon-level NDVI aggregate. Says nothing about where inside the polygon."""

    mean: float
    min: float | None = None
    max: float | None = None
    std: float | None = None
    median: float | None = None


@dataclass(frozen=True)
class NormalizedObservation:
    source: Source
    acquired_on: date
    cloud_coverage: float
    data_coverage: float | None  # None when the provider did not report it
    ndvi: NdviStats | None  # None for image-search items until statistics are merged
    preview_ref: str | None = None  # provider URL without the key
    stats_ref: str | None = None  # provider URL without the key


@dataclass(frozen=True)
class DiscardedItem:
    area_id: str
    field: str
    reason: str


@dataclass
class NormalizedBatch:
    items: list[NormalizedObservation] = field(default_factory=list)
    discarded: list[DiscardedItem] = field(default_factory=list)
    skipped_duplicates: int = 0


@dataclass(frozen=True)
class ImageBytes:
    content: bytes
    content_type: str


class AgroClient(Protocol):
    async def create_polygon(self, name: str, geometry: dict[str, Any]) -> ProviderPolygon: ...

    async def delete_polygon(self, polygon_id: str) -> None: ...

    async def ndvi_history(
        self, polygon_id: str, source: Source, start: date, end: date, *, area_id: str = ""
    ) -> NormalizedBatch: ...

    async def image_search(
        self, polygon_id: str, source: Source, start: date, end: date, *, area_id: str = ""
    ) -> NormalizedBatch: ...

    async def fetch_image(self, image_ref: str) -> ImageBytes: ...

    async def probe(self) -> None: ...
