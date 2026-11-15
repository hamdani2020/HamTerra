"""Cognito access-token validation (Requirements 2.1, 2.2, 2.10, 2.13).

Failures raise ``Unauthenticated`` with a fixed message. The internal reason code is
logged without the token.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import jwt

from app.core.errors import Unauthenticated
from app.integrations.cognito.jwks import JwksCache

logger = logging.getLogger(__name__)

ALGORITHM = "RS256"


@dataclass(frozen=True)
class Claims:
    sub: str
    username: str
    groups: tuple[str, ...]
    email: str | None


def issuer_for(region: str, pool_id: str) -> str:
    return f"https://cognito-idp.{region}.amazonaws.com/{pool_id}"


def _reject(reason: str) -> Unauthenticated:
    logger.info("token_rejected", extra={"reason": reason})
    return Unauthenticated()


def _str_claim(claims: dict[str, Any], name: str) -> str | None:
    value = claims.get(name)
    return value if isinstance(value, str) and value else None


class TokenValidator:
    def __init__(self, *, cache: JwksCache, issuer: str, client_id: str) -> None:
        self._cache = cache
        self._issuer = issuer
        self._client_id = client_id

    async def validate(self, token: str) -> Claims:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError:
            raise _reject("malformed") from None
        kid = header.get("kid")
        if header.get("alg") != ALGORITHM or not isinstance(kid, str) or not kid:
            raise _reject("bad_header")

        key = await self._cache.get_key(kid)  # may raise ServiceUnavailable (503)
        if key is None:
            raise _reject("unknown_kid")

        try:
            claims: dict[str, Any] = jwt.decode(
                token,
                key,
                algorithms=[ALGORITHM],
                options={
                    "require": ["exp", "sub"],
                    "verify_aud": False,
                    "verify_iss": False,
                },
            )
        except jwt.ExpiredSignatureError:
            raise _reject("expired") from None
        except jwt.InvalidSignatureError:
            raise _reject("bad_signature") from None
        except jwt.PyJWTError:
            raise _reject("invalid") from None

        if claims.get("iss") != self._issuer:
            raise _reject("wrong_issuer")
        if claims.get("token_use") != "access":
            raise _reject("wrong_token_use")
        if claims.get("client_id") != self._client_id:
            raise _reject("wrong_client")
        sub = _str_claim(claims, "sub")
        if sub is None:
            raise _reject("missing_sub")

        groups_claim = claims.get("cognito:groups")
        groups = (
            tuple(g for g in groups_claim if isinstance(g, str))
            if isinstance(groups_claim, list)
            else ()
        )
        username = _str_claim(claims, "username") or _str_claim(claims, "cognito:username") or sub
        return Claims(sub=sub, username=username, groups=groups, email=_str_claim(claims, "email"))
