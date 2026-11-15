"""Concurrency cap and request-rate cap for provider calls (Requirement 5.11)."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable


class TokenBucket:
    """Refills ``rpm / 60`` tokens per second. Burst is bounded by ``capacity``."""

    def __init__(
        self,
        rpm: int,
        *,
        capacity: int = 1,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if rpm < 1:
            raise ValueError("rpm must be at least 1")
        self._rate = rpm / 60.0
        self._capacity = float(max(1, capacity))
        self._tokens = self._capacity
        self._clock = clock
        self._sleep = sleep
        self._updated = clock()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        # Waiters queue on the lock, so they are served in arrival order.
        async with self._lock:
            while True:
                now = self._clock()
                self._tokens = min(
                    self._capacity, self._tokens + (now - self._updated) * self._rate
                )
                self._updated = now
                if self._tokens >= 1:
                    self._tokens -= 1
                    return
                await self._sleep((1 - self._tokens) / self._rate)


class RateLimiter:
    """Semaphore for in-flight requests plus a token bucket for the rate."""

    def __init__(
        self,
        max_concurrency: int,
        max_rpm: int,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._bucket = TokenBucket(
            max_rpm, capacity=min(max_rpm, max_concurrency), clock=clock, sleep=sleep
        )

    async def __aenter__(self) -> None:
        await self._semaphore.acquire()
        try:
            await self._bucket.acquire()
        except BaseException:
            self._semaphore.release()
            raise

    async def __aexit__(self, *exc: object) -> None:
        self._semaphore.release()
