"""In-memory JWKS cache (Requirements 2.3 to 2.7).

One fetch at a time (``asyncio.Lock``), at most one refresh attempt per
``min_refresh_interval_s``. A failed refresh keeps the cached keys. With no cached
keys, a failed or not-permitted refresh raises ``ServiceUnavailable``.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import jwt

from app.core.errors import ServiceUnavailable

logger = logging.getLogger(__name__)

JwksFetcher = Callable[[], Awaitable[dict[str, Any]]]


def jwks_url(region: str, pool_id: str) -> str:
    return f"https://cognito-idp.{region}.amazonaws.com/{pool_id}/.well-known/jwks.json"


def http_fetcher(url: str, timeout_s: float) -> JwksFetcher:
    async def fetch() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.get(url)
            response.raise_for_status()
            body = response.json()
        if not isinstance(body, dict):
            raise ValueError("JWKS body is not an object")
        return body

    return fetch


def _parse_keys(body: dict[str, Any]) -> dict[str, Any]:
    keys: dict[str, Any] = {}
    raw = body.get("keys")
    if not isinstance(raw, list):
        raise ValueError("JWKS has no keys list")
    for item in raw:
        if not isinstance(item, dict):
            continue
        kid = item.get("kid")
        if not isinstance(kid, str) or item.get("kty") != "RSA":
            continue
        try:
            keys[kid] = jwt.PyJWK(item).key
        except jwt.PyJWTError:
            logger.warning("jwks_key_skipped")
    return keys


class JwksCache:
    def __init__(
        self,
        fetcher: JwksFetcher,
        *,
        min_refresh_interval_s: float = 60.0,
        timeout_s: float = 5.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._fetcher = fetcher
        self._min_interval = min_refresh_interval_s
        self._timeout_s = timeout_s
        self._clock = clock
        self._keys: dict[str, Any] = {}
        self._last_attempt: float | None = None
        self._lock = asyncio.Lock()

    def _refresh_allowed(self) -> bool:
        if self._last_attempt is None:
            return True
        return self._clock() - self._last_attempt >= self._min_interval

    async def get_key(self, kid: str) -> Any | None:
        """Return the public key for ``kid``, or None when it is unknown.

        Raises ``ServiceUnavailable`` when no keys are cached and none can be fetched.
        """
        key = self._keys.get(kid)
        if key is not None:
            return key
        async with self._lock:
            # Another request may have refreshed while this one waited.
            key = self._keys.get(kid)
            if key is not None:
                return key
            if not self._refresh_allowed():
                if not self._keys:
                    raise ServiceUnavailable()
                return None
            self._last_attempt = self._clock()
            try:
                async with asyncio.timeout(self._timeout_s):
                    fresh = _parse_keys(await self._fetcher())
            except Exception as exc:  # network, timeout, HTTP status, bad body
                logger.warning("jwks_refresh_failed", extra={"reason": type(exc).__name__})
                if not self._keys:
                    raise ServiceUnavailable() from exc
                return None
            if fresh:
                self._keys = fresh
            elif not self._keys:
                raise ServiceUnavailable()
            return self._keys.get(kid)
