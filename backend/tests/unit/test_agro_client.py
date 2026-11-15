"""Agro client tests over a mocked HTTPX transport (task 6.5). No network."""

from __future__ import annotations

import io
import logging
from collections.abc import Callable, Iterator
from datetime import UTC, date, datetime
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from app.core.logging import JsonFormatter
from app.core.redaction import RedactionFilter, redact
from app.integrations.agro.client import HttpAgroClient
from app.integrations.agro.errors import (
    AgroClientError,
    AgroTimeoutError,
    AgroUpstreamError,
    InvalidProviderRef,
)
from app.integrations.agro.ratelimit import TokenBucket
from app.integrations.agro.transport import AgroTransport, parse_retry_after

KEY = "SECRET-PROVIDER-KEY-123"
BASE = "https://api.agro.test/agro/1.0"
TS = int(datetime(2026, 3, 16, 10, tzinfo=UTC).timestamp())

Handler = Callable[[httpx.Request], httpx.Response]


class Harness:
    def __init__(self, handler: Handler, **kwargs: Any) -> None:
        self.requests: list[httpx.Request] = []
        self.sleeps: list[float] = []

        def wrapped(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            return handler(request)

        async def sleep(seconds: float) -> None:
            self.sleeps.append(seconds)

        self.http = httpx.AsyncClient(transport=httpx.MockTransport(wrapped))
        transport = AgroTransport(
            base_url=BASE,
            api_key=SecretStr(KEY),
            http_client=self.http,
            sleep=sleep,
            jitter=lambda: 0.25,
            max_rpm=60,
        )
        self.client = HttpAgroClient(transport, **kwargs)


def history_item(**over: Any) -> dict[str, Any]:
    item = {"dt": TS, "source": "s2", "cl": 0.5, "dc": 99, "data": {"mean": 0.6, "max": 0.9}}
    item.update(over)
    return item


D1, D2 = date(2026, 3, 1), date(2026, 3, 31)


async def test_ndvi_history_success_adds_key_once_and_filters_sensor() -> None:
    h = Harness(
        lambda r: httpx.Response(
            200, json=[history_item(), history_item(source="l8", dt=TS + 86400)]
        )
    )
    batch = await h.client.ndvi_history("poly1", "sentinel-2", D1, D2, area_id="a1")
    assert [i.source for i in batch.items] == ["sentinel-2"]
    assert batch.items[0].data_coverage == 99
    (request,) = h.requests
    assert request.url.params["appid"] == KEY
    assert request.url.params["polyid"] == "poly1"
    assert request.url.params["type"] == "s2"
    assert request.url.params["start"] == str(int(datetime(2026, 3, 1, tzinfo=UTC).timestamp()))
    assert request.url.params["end"] == str(int(datetime(2026, 4, 1, tzinfo=UTC).timestamp()) - 1)


async def test_empty_result() -> None:
    h = Harness(lambda r: httpx.Response(200, json=[]))
    batch = await h.client.ndvi_history("p", "sentinel-2", D1, D2)
    assert batch.items == [] and batch.discarded == []


@pytest.mark.parametrize("body", [{"a": 1}, "text", None, 5])
async def test_unexpected_shape_is_upstream_error(body: Any) -> None:
    h = Harness(lambda r: httpx.Response(200, json=body))
    with pytest.raises(AgroUpstreamError):
        await h.client.ndvi_history("p", "sentinel-2", D1, D2)


async def test_non_json_body_is_upstream_error() -> None:
    h = Harness(lambda r: httpx.Response(200, content=b"<html>oops</html>"))
    with pytest.raises(AgroUpstreamError) as info:
        await h.client.ndvi_history("p", "sentinel-2", D1, D2)
    assert "oops" not in info.value.message


async def test_bad_items_are_discarded_and_logged(caplog: pytest.LogCaptureFixture) -> None:
    items = [history_item(), history_item(cl=250, dt=TS + 1), "junk", history_item(data={})]
    h = Harness(lambda r: httpx.Response(200, json=items))
    with caplog.at_level(logging.WARNING):
        batch = await h.client.ndvi_history("p", "sentinel-2", D1, D2, area_id="area-9")
    assert len(batch.items) == 1
    assert {d.field for d in batch.discarded} == {"cl", "item", "data.mean"}
    warnings = [r for r in caplog.records if r.message == "provider_item_discarded"]
    assert len(warnings) == 3
    assert all(r.area_id == "area-9" for r in warnings)  # type: ignore[attr-defined]


async def test_missing_dc_stays_none() -> None:
    item = history_item()
    del item["dc"]
    h = Harness(lambda r: httpx.Response(200, json=[item]))
    (obs,) = (await h.client.ndvi_history("p", "sentinel-2", D1, D2)).items
    assert obs.data_coverage is None


async def test_timeout_retries_then_504() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    h = Harness(handler)
    with pytest.raises(AgroTimeoutError):
        await h.client.probe()
    assert len(h.requests) == 4
    assert h.sleeps == [1.25, 2.25, 4.25]


async def test_429_waits_for_retry_after_then_succeeds() -> None:
    responses = iter(
        [
            httpx.Response(429, headers={"Retry-After": "10"}),
            httpx.Response(429, headers={"Retry-After": "500"}),
            httpx.Response(200, json=[]),
        ]
    )
    h = Harness(lambda r: next(responses))
    await h.client.probe()
    assert len(h.requests) == 3
    assert h.sleeps == [10.0, 60.0]  # second wait is capped at 60 s


@pytest.mark.parametrize("status", [502, 503, 504])
async def test_5xx_stops_after_four_attempts(status: int) -> None:
    h = Harness(lambda r: httpx.Response(status, text=f"secret body {KEY}"))
    with pytest.raises(AgroUpstreamError) as info:
        await h.client.probe()
    assert len(h.requests) == 4
    assert info.value.details == {"upstream_status": status}
    assert "secret body" not in info.value.message
    assert KEY not in repr(info.value.details)


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
async def test_other_4xx_makes_one_request(status: int) -> None:
    h = Harness(lambda r: httpx.Response(status, text="nope"))
    with pytest.raises(AgroClientError) as info:
        await h.client.probe()
    assert len(h.requests) == 1
    assert info.value.upstream_status == status
    assert h.sleeps == []


async def test_500_is_not_retried() -> None:
    h = Harness(lambda r: httpx.Response(500))
    with pytest.raises(AgroUpstreamError):
        await h.client.probe()
    assert len(h.requests) == 1


async def test_connection_error_is_upstream_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"cannot connect {request.url}", request=request)

    h = Harness(handler)
    with pytest.raises(AgroUpstreamError) as info:
        await h.client.probe()
    assert KEY not in info.value.message
    assert info.value.__cause__ is None and info.value.__suppress_context__


@pytest.fixture
def app_log() -> Iterator[io.StringIO]:
    """The app's handler setup (JSON, redaction filter, quiet httpx) writing to a buffer."""
    buffer = io.StringIO()
    handler = logging.StreamHandler(buffer)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RedactionFilter([KEY]))
    root = logging.getLogger()
    previous = root.level
    quiet = {n: logging.getLogger(n).level for n in ("httpx", "httpcore")}
    root.addHandler(handler)
    root.setLevel(logging.DEBUG)
    for name in quiet:
        logging.getLogger(name).setLevel(logging.WARNING)
    yield buffer
    root.removeHandler(handler)
    root.setLevel(previous)
    for name, level in quiet.items():
        logging.getLogger(name).setLevel(level)


async def test_no_key_in_logs_or_errors(app_log: io.StringIO) -> None:
    h = Harness(lambda r: httpx.Response(503, text=KEY))
    with pytest.raises(AgroUpstreamError) as info:
        await h.client.probe()
    out = app_log.getvalue()
    assert "agro_retry" in out
    assert KEY not in out
    assert KEY not in str(info.value)


async def test_create_polygon() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(201, json={"id": "abc123", "area": 123.4, "name": "x"})

    h = Harness(handler)
    geometry = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}
    polygon = await h.client.create_polygon("Area", geometry)
    assert (polygon.id, polygon.area_ha) == ("abc123", 123.4)
    request = h.requests[0]
    assert request.method == "POST"
    assert b'"geo_json"' in request.content and b'"Feature"' in request.content
    assert KEY.encode() not in request.content  # key goes in the query string only


async def test_create_polygon_without_id_fails() -> None:
    h = Harness(lambda r: httpx.Response(200, json={"area": 3}))
    with pytest.raises(AgroUpstreamError):
        await h.client.create_polygon("A", {})


async def test_delete_polygon_treats_404_as_done_and_quotes_id() -> None:
    h = Harness(lambda r: httpx.Response(404))
    await h.client.delete_polygon("a/b")
    assert h.requests[0].url.raw_path.split(b"?")[0].endswith(b"/polygons/a%2Fb")
    h = Harness(lambda r: httpx.Response(403))
    with pytest.raises(AgroClientError):
        await h.client.delete_polygon("x")


async def test_image_search_strips_key_from_refs() -> None:
    item = {
        "dt": TS,
        "type": "Sentinel 2",
        "dc": 80,
        "cl": 2,
        "image": {"ndvi": "http://api.agro.test/image/1.0/abc/xyz?appid=LEAKED&size=117"},
        "stats": {"ndvi": f"{BASE}/stats/1?appid=LEAKED"},
    }
    h = Harness(lambda r: httpx.Response(200, json=[item]))
    (obs,) = (await h.client.image_search("p", "sentinel-2", D1, D2)).items
    assert obs.ndvi is None
    assert obs.preview_ref is not None and "LEAKED" not in obs.preview_ref
    assert "size=117" in obs.preview_ref
    assert obs.stats_ref is not None and "appid" not in obs.stats_ref


async def test_fetch_image_attaches_key_and_checks_host() -> None:
    h = Harness(
        lambda r: httpx.Response(200, content=b"\x89PNG", headers={"content-type": "image/png"})
    )
    image = await h.client.fetch_image("http://api.agro.test/image/1.0/abc?size=117")
    assert image.content_type == "image/png"
    request = h.requests[0]
    assert request.url.scheme == "https"
    assert request.url.params["appid"] == KEY
    with pytest.raises(InvalidProviderRef):
        await h.client.fetch_image("https://evil.example/x.png")
    assert len(h.requests) == 1  # the key was never sent to the other host


async def test_fetch_image_rejects_non_image() -> None:
    h = Harness(lambda r: httpx.Response(200, text="<html>", headers={"content-type": "text/html"}))
    with pytest.raises(AgroUpstreamError):
        await h.client.fetch_image(f"{BASE}/img")


async def test_per_image_stats_mode() -> None:
    def item(day: int, stats: str) -> dict[str, Any]:
        return {
            "dt": TS + day * 86400,
            "type": "Sentinel 2",
            "cl": 1,
            "dc": 90,
            "stats": {"ndvi": f"{BASE}/stats/{stats}"},
        }

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/image/search"):
            return httpx.Response(200, json=[item(0, "ok"), item(1, "bad"), item(2, "missing")])
        if path.endswith("/stats/ok"):
            return httpx.Response(200, json={"mean": 0.42, "min": 0.1, "max": 0.8, "num": 5})
        if path.endswith("/stats/bad"):
            return httpx.Response(200, json={"mean": "n/a"})
        return httpx.Response(404)

    h = Harness(handler, stats_mode="per_image")
    batch = await h.client.ndvi_history("p", "sentinel-2", D1, D2, area_id="a")
    assert [i.ndvi.mean for i in batch.items if i.ndvi] == [0.42]
    assert len(batch.items) == 1
    assert len(batch.discarded) == 2
    assert all(r.url.params["appid"] == KEY for r in h.requests)


def test_parse_retry_after() -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    assert parse_retry_after("12") == 12
    assert parse_retry_after("Thu, 01 Jan 2026 00:00:30 GMT", now=now) == 30
    assert parse_retry_after("Wed, 31 Dec 2025 00:00:00 GMT", now=now) == 0
    assert parse_retry_after("soon") is None
    assert parse_retry_after(None) is None
    assert parse_retry_after("nan") is None


async def test_token_bucket_waits_when_empty() -> None:
    now = [0.0]
    slept: list[float] = []

    async def sleep(seconds: float) -> None:
        slept.append(seconds)
        now[0] += seconds

    bucket = TokenBucket(30, capacity=1, clock=lambda: now[0], sleep=sleep)
    await bucket.acquire()
    await bucket.acquire()
    assert slept == [pytest.approx(2.0)]  # 30 per minute is one every 2 s


def test_redact_helper_still_hides_key() -> None:
    assert KEY not in redact(f"GET {BASE}?appid={KEY}")
