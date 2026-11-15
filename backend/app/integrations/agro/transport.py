"""HTTP transport: shared client, rate limits, retries, and the one place the key is added.

Requirements 5.1, 5.3 to 5.6, 5.10, 5.11, 23.4. Errors carry a status and fixed text,
never the upstream body or the URL.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any

import httpx
from pydantic import SecretStr

from app.integrations.agro.errors import AgroClientError, AgroTimeoutError, AgroUpstreamError
from app.integrations.agro.ratelimit import RateLimiter

logger = logging.getLogger(__name__)

RETRY_STATUSES = frozenset({429, 502, 503, 504})
MAX_RETRIES = 3
BACKOFF_CAP_S = 30.0
RETRY_AFTER_CAP_S = 60.0
OVERALL_DEADLINE_S = 120.0


def backoff_seconds(retry: int, jitter: float) -> float:
    """``min(2^(n-1), 30) + jitter`` for retry number ``n`` (1 to 3), jitter in 0 to 1."""
    return min(2.0 ** (retry - 1), BACKOFF_CAP_S) + jitter


def parse_retry_after(value: str | None, *, now: datetime | None = None) -> float | None:
    """Seconds from a ``Retry-After`` header (number or HTTP date), or None."""
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    try:
        seconds = float(text)
    except ValueError:
        try:
            when = parsedate_to_datetime(text)
        except (TypeError, ValueError):
            return None
        if when.tzinfo is None:
            when = when.replace(tzinfo=UTC)
        seconds = (when - (now or datetime.now(UTC))).total_seconds()
    if seconds != seconds:  # NaN
        return None
    return max(0.0, seconds)


def retry_wait_seconds(retry: int, jitter: float, retry_after: float | None) -> float:
    """``max(backoff, min(Retry-After, 60))`` when a header applies, else the backoff."""
    wait = backoff_seconds(retry, jitter)
    if retry_after is not None:
        wait = max(wait, min(retry_after, RETRY_AFTER_CAP_S))
    return wait


class AgroTransport:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: SecretStr,
        connect_timeout_s: float = 5,
        read_timeout_s: float = 30,
        max_concurrency: int = 4,
        max_rpm: int = 30,
        http_client: httpx.AsyncClient | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        jitter: Callable[[], float] = random.random,  # noqa: S311 - jitter, not security
        clock: Callable[[], float] = time.monotonic,
        overall_deadline_s: float = OVERALL_DEADLINE_S,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._key = api_key
        self._client = http_client or httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=connect_timeout_s, read=read_timeout_s, write=5.0, pool=5.0
            ),
            follow_redirects=False,
        )
        self._owns_client = http_client is None
        self._sleep = sleep
        self._jitter = jitter
        self._limiter = RateLimiter(max_concurrency, max_rpm, clock=clock, sleep=sleep)
        self._deadline_s = overall_deadline_s

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def request(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        label: str = "request",
    ) -> httpx.Response:
        """Send with retries. ``url`` is absolute. ``label`` is a safe name for logs."""
        try:
            async with asyncio.timeout(self._deadline_s):
                return await self._with_retries(method, url, params, json, label)
        except TimeoutError:
            raise AgroTimeoutError() from None

    async def _with_retries(
        self, method: str, url: str, params: dict[str, Any] | None, json: Any, label: str
    ) -> httpx.Response:
        last_status: int | None = None
        timed_out = False
        for attempt in range(MAX_RETRIES + 1):
            retry_after: float | None = None
            try:
                async with self._limiter:
                    response = await self._send(method, url, params, json)
                timed_out = False
                status = response.status_code
                if 200 <= status < 300:
                    return response
                if status not in RETRY_STATUSES:
                    if 400 <= status < 500:
                        raise AgroClientError(status)
                    raise AgroUpstreamError(status=status)
                last_status = status
                retry_after = parse_retry_after(response.headers.get("Retry-After"))
            except httpx.TimeoutException:
                timed_out = True
                last_status = None
            except httpx.TransportError:
                raise AgroUpstreamError() from None
            if attempt == MAX_RETRIES:
                break
            wait = retry_wait_seconds(attempt + 1, self._jitter(), retry_after)
            logger.warning(
                "agro_retry",
                extra={
                    "call": label,
                    "attempt": attempt + 1,
                    "status": last_status,
                    "wait_s": wait,
                },
            )
            await self._sleep(wait)
        if timed_out:
            raise AgroTimeoutError()
        raise AgroUpstreamError(status=last_status)

    async def _send(
        self, method: str, url: str, params: dict[str, Any] | None, json: Any
    ) -> httpx.Response:
        # The only place the key is attached.
        merged = dict(params or {})
        merged["appid"] = self._key.get_secret_value()
        return await self._client.request(method, url, params=merged, json=json)
