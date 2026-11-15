"""Properties 11 and 12: retry wait schedule and provider item normalisation."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

import httpx
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import SecretStr

from app.integrations.agro.client import HttpAgroClient
from app.integrations.agro.errors import AgroUpstreamError
from app.integrations.agro.normalize import normalize_batch
from app.integrations.agro.transport import AgroTransport, retry_wait_seconds

# Feature: eco-sentinel-backend, Property 12: Provider item normalisation
maybe = st.one_of(
    st.none(),
    st.booleans(),
    st.integers(-200, 200),
    st.floats(allow_nan=True, allow_infinity=True),
    st.text(max_size=8),
    st.lists(st.integers(), max_size=2),
)
percent = st.one_of(st.floats(0, 100), maybe)
ndvi_data = st.one_of(
    maybe,
    st.fixed_dictionaries(
        {"mean": st.one_of(st.floats(-1, 1), maybe)},
        optional={"min": maybe, "max": maybe, "std": maybe, "median": maybe},
    ),
)
raw_item = st.one_of(
    maybe,
    st.fixed_dictionaries(
        {},
        optional={
            "type": st.sampled_from(["Sentinel 2", "Landsat 8", "Other", None, 3]),
            "dt": st.one_of(st.integers(1_700_000_000, 1_800_000_000), maybe),
            "cl": percent,
            "dc": percent,
            "data": ndvi_data,
        },
    ),
)


@given(items=st.lists(raw_item, max_size=25), kind=st.sampled_from(["history", "images"]))
def test_normalisation_is_total_and_valid(items: list[Any], kind: str) -> None:
    batch = normalize_batch(items, area_id="area-1", kind=kind)  # type: ignore[arg-type]
    assert len(batch.items) + len(batch.discarded) + batch.skipped_duplicates == len(items)
    keys = [(i.source, i.acquired_on) for i in batch.items]
    assert len(keys) == len(set(keys))
    for item in batch.items:
        assert item.source in ("sentinel-2", "landsat-8")
        assert 0 <= item.cloud_coverage <= 100
        assert item.data_coverage is None or 0 <= item.data_coverage <= 100
        assert item.ndvi is None or -1 <= item.ndvi.mean <= 1
        if kind == "history":
            assert item.ndvi is not None


@given(cl=st.floats(0, 100))
def test_missing_dc_is_never_derived_from_cloud(cl: float) -> None:
    raw = {"type": "Sentinel 2", "dt": 1_770_000_000, "cl": cl, "data": {"mean": 0.5}}
    (item,) = normalize_batch([raw], area_id="a", kind="history").items
    assert item.data_coverage is None


@given(a=st.floats(0, 100), b=st.floats(0, 100))
def test_duplicate_keeps_lower_cloud(a: float, b: float) -> None:
    def raw(cl: float) -> dict[str, Any]:
        return {"type": "Landsat 8", "dt": 1_770_000_000, "cl": cl, "data": {"mean": 0.1}}

    batch = normalize_batch([raw(a), raw(b)], area_id="a", kind="history")
    assert len(batch.items) == 1
    assert batch.skipped_duplicates == 1
    assert batch.items[0].cloud_coverage == min(a, b)


def test_unix_seconds_become_utc_date() -> None:
    ts = int(datetime(2026, 3, 16, 23, 59, 59, tzinfo=UTC).timestamp())
    raw = {"type": "Sentinel 2", "dt": ts, "cl": 1, "data": {"mean": 0.5}}
    (item,) = normalize_batch([raw], area_id="a", kind="history").items
    assert item.acquired_on.isoformat() == "2026-03-16"


# Feature: eco-sentinel-backend, Property 11: Retry wait schedule
@given(
    retry=st.integers(1, 3),
    jitter=st.floats(0, 1),
    retry_after=st.one_of(st.none(), st.floats(0, 10_000)),
)
def test_wait_bounds(retry: int, jitter: float, retry_after: float | None) -> None:
    base = min(2 ** (retry - 1), 30)
    wait = retry_wait_seconds(retry, jitter, retry_after)
    assert wait >= base
    if retry_after is None:
        assert base <= wait <= base + 1
    else:
        assert wait >= min(retry_after, 60)
        assert wait <= max(base + 1, 60)


@given(
    retry_after=st.one_of(st.none(), st.integers(0, 500).map(str), st.just("garbage")),
    status=st.sampled_from([429, 502, 503, 504]),
)
@settings(max_examples=25, deadline=None)
def test_at_most_four_requests_per_call(retry_after: str | None, status: int) -> None:
    calls = 0
    sleeps: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        headers = {"Retry-After": retry_after} if retry_after is not None else {}
        return httpx.Response(status, headers=headers)

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    async def run() -> None:
        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        transport = AgroTransport(
            base_url="https://agro.test/agro/1.0",
            api_key=SecretStr("dummy"),
            http_client=http,
            sleep=fake_sleep,
            jitter=lambda: 0.5,
            max_rpm=60,
        )
        try:
            await HttpAgroClient(transport).probe()
        except AgroUpstreamError:
            pass
        await http.aclose()

    asyncio.run(run())
    assert calls == 4
    assert len([s for s in sleeps if s > 0]) >= 3
