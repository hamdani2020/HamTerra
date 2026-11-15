"""Fake Cognito signing keys and token helpers. Keys are generated per process, never real."""

from __future__ import annotations

import base64
import time
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

FAKE_REGION = "eu-west-1"
FAKE_POOL_ID = "eu-west-1_dummy"
FAKE_CLIENT_ID = "dummy-client-id"
FAKE_ISSUER = f"https://cognito-idp.{FAKE_REGION}.amazonaws.com/{FAKE_POOL_ID}"


class FakeKey:
    def __init__(self, kid: str = "test-key-1") -> None:
        self.kid = kid
        self.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def jwk(self) -> dict[str, str]:
        numbers = self.private_key.public_key().public_numbers()

        def b64(value: int) -> str:
            raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
            return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

        return {
            "kty": "RSA",
            "kid": self.kid,
            "use": "sig",
            "alg": "RS256",
            "n": b64(numbers.n),
            "e": b64(numbers.e),
        }

    def jwks(self) -> dict[str, list[dict[str, str]]]:
        return {"keys": [self.jwk()]}

    def make_token(
        self,
        *,
        sub: str = "00000000-0000-0000-0000-000000000001",
        groups: list[str] | None = None,
        token_use: str = "access",  # noqa: S107
        expires_in: int = 3600,
        overrides: dict[str, Any] | None = None,
        drop: tuple[str, ...] = (),
    ) -> str:
        now = int(time.time())
        claims: dict[str, Any] = {
            "sub": sub,
            "iss": FAKE_ISSUER,
            "client_id": FAKE_CLIENT_ID,
            "token_use": token_use,
            "iat": now,
            "exp": now + expires_in,
        }
        if groups is not None:
            claims["cognito:groups"] = groups
        claims.update(overrides or {})
        for name in drop:
            claims.pop(name, None)
        return jwt.encode(claims, self.private_key, algorithm="RS256", headers={"kid": self.kid})
