"""Token validator and JWKS cache tests with locally generated keys (task 5.6)."""

from __future__ import annotations

import logging
from typing import Any

import jwt
import pytest

from app.core.errors import ServiceUnavailable, Unauthenticated
from app.integrations.cognito.jwks import JwksCache
from app.integrations.cognito.validator import TokenValidator
from tests.fixtures.jwt_keys import FAKE_CLIENT_ID, FAKE_ISSUER, FakeKey


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class FakeFetcher:
    def __init__(self, *bodies: dict[str, Any] | Exception) -> None:
        self.bodies = list(bodies)
        self.calls = 0

    async def __call__(self) -> dict[str, Any]:
        self.calls += 1
        body = self.bodies[min(self.calls, len(self.bodies)) - 1]
        if isinstance(body, Exception):
            raise body
        return body


def make_validator(fetcher: FakeFetcher, clock: FakeClock | None = None) -> TokenValidator:
    cache = JwksCache(fetcher, min_refresh_interval_s=60, clock=clock or FakeClock())
    return TokenValidator(cache=cache, issuer=FAKE_ISSUER, client_id=FAKE_CLIENT_ID)


@pytest.fixture(scope="module")
def key() -> FakeKey:
    return FakeKey("kid-a")


async def test_valid_token(key: FakeKey) -> None:
    v = make_validator(FakeFetcher(key.jwks()))
    claims = await v.validate(
        key.make_token(groups=["admin", "x"], overrides={"username": "ama", "email": "a@x.org"})
    )
    assert (claims.sub, claims.username, claims.email) == (
        "00000000-0000-0000-0000-000000000001",
        "ama",
        "a@x.org",
    )
    assert claims.groups == ("admin", "x")


async def test_missing_email_and_groups(key: FakeKey) -> None:
    claims = await make_validator(FakeFetcher(key.jwks())).validate(key.make_token())
    assert claims.email is None
    assert claims.groups == ()
    assert claims.username == claims.sub


@pytest.mark.parametrize(
    ("kwargs", "reason"),
    [
        ({"expires_in": -10}, "expired"),
        ({"overrides": {"iss": "https://evil.example/pool"}}, "wrong_issuer"),
        ({"overrides": {"client_id": "other"}}, "wrong_client"),
        ({"token_use": "id"}, "wrong_token_use"),
        ({"drop": ("client_id",)}, "wrong_client"),
        ({"drop": ("exp",)}, "invalid"),
    ],
)
async def test_rejected_tokens(
    key: FakeKey, kwargs: dict[str, Any], reason: str, caplog: pytest.LogCaptureFixture
) -> None:
    v = make_validator(FakeFetcher(key.jwks()))
    token = key.make_token(**kwargs)
    with caplog.at_level(logging.INFO), pytest.raises(Unauthenticated) as info:
        await v.validate(token)
    assert info.value.message == Unauthenticated.default_message
    assert info.value.headers["WWW-Authenticate"] == "Bearer"
    record = next(r for r in caplog.records if r.message == "token_rejected")
    assert record.reason == reason  # type: ignore[attr-defined]
    assert token not in caplog.text


async def test_bad_signature(key: FakeKey) -> None:
    forged = FakeKey("kid-a").make_token()
    with pytest.raises(Unauthenticated):
        await make_validator(FakeFetcher(key.jwks())).validate(forged)


async def test_unknown_kid(key: FakeKey) -> None:
    token = FakeKey("kid-zzz").make_token()
    with pytest.raises(Unauthenticated):
        await make_validator(FakeFetcher(key.jwks())).validate(token)


async def test_non_rs256_and_garbage_rejected(key: FakeKey) -> None:
    v = make_validator(FakeFetcher(key.jwks()))
    hs = jwt.encode({"sub": "x"}, "k" * 32, algorithm="HS256", headers={"kid": "kid-a"})
    none_alg = jwt.encode({"sub": "x"}, "", algorithm="none", headers={"kid": "kid-a"})
    no_kid = jwt.encode({"sub": "x"}, key.private_key, algorithm="RS256")
    for bad in (hs, none_alg, no_kid, "not-a-jwt", ""):
        with pytest.raises(Unauthenticated):
            await v.validate(bad)


async def test_jwks_refresh_limited_to_once_per_interval(key: FakeKey) -> None:
    clock = FakeClock()
    fetcher = FakeFetcher(key.jwks())
    v = make_validator(fetcher, clock)
    unknown = FakeKey("kid-new").make_token()

    await v.validate(key.make_token())  # first fetch
    assert fetcher.calls == 1
    clock.now += 30
    with pytest.raises(Unauthenticated):
        await v.validate(unknown)  # refresh not permitted yet
    assert fetcher.calls == 1
    clock.now += 31  # 61 s after the first attempt
    with pytest.raises(Unauthenticated):
        await v.validate(unknown)
    assert fetcher.calls == 2
    with pytest.raises(Unauthenticated):
        await v.validate(unknown)  # immediately again: no new fetch
    assert fetcher.calls == 2


async def test_known_kid_never_refetches(key: FakeKey) -> None:
    clock = FakeClock()
    fetcher = FakeFetcher(key.jwks())
    v = make_validator(fetcher, clock)
    for _ in range(3):
        clock.now += 1000
        await v.validate(key.make_token())
    assert fetcher.calls == 1


async def test_cache_used_when_refresh_fails(key: FakeKey) -> None:
    clock = FakeClock()
    fetcher = FakeFetcher(key.jwks(), RuntimeError("boom"))
    v = make_validator(fetcher, clock)
    await v.validate(key.make_token())
    clock.now += 61
    with pytest.raises(Unauthenticated):
        await v.validate(FakeKey("kid-new").make_token())  # refresh fails
    assert fetcher.calls == 2
    await v.validate(key.make_token())  # cached key still works


async def test_503_when_nothing_cached(key: FakeKey) -> None:
    clock = FakeClock()
    fetcher = FakeFetcher(RuntimeError("down"), key.jwks())
    v = make_validator(fetcher, clock)
    with pytest.raises(ServiceUnavailable):
        await v.validate(key.make_token())
    # Within the interval, no new fetch and still 503.
    with pytest.raises(ServiceUnavailable):
        await v.validate(key.make_token())
    assert fetcher.calls == 1
    clock.now += 61
    await v.validate(key.make_token())  # recovered


async def test_concurrent_requests_cause_one_fetch(key: FakeKey) -> None:
    import asyncio

    fetcher = FakeFetcher(key.jwks())
    v = make_validator(fetcher)
    await asyncio.gather(*(v.validate(key.make_token()) for _ in range(10)))
    assert fetcher.calls == 1
