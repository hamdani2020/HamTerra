"""Properties 4, 6 and 7: token acceptance, group to role mapping, permission derivation."""

from __future__ import annotations

import asyncio
import time
from typing import Any

import jwt
from hypothesis import given, settings
from hypothesis import strategies as st

from app.core.errors import Unauthenticated
from app.core.permissions import REQUIRED_ROLE, Permission, permissions_for
from app.core.security import Role, role_satisfies, roles_from_groups
from app.integrations.cognito.jwks import JwksCache
from app.integrations.cognito.validator import TokenValidator
from tests.fixtures.jwt_keys import (
    FAKE_CLIENT_ID,
    FAKE_ISSUER,
    FakeKey,
)

# Feature: eco-sentinel-backend, Property 6: Group to role mapping
group_names = st.one_of(
    st.sampled_from(
        ["admin", "researcher", "Admin", "RESEARCHER", " admin", "admin ", "other", ""]
    ),
    st.text(max_size=12),
)
role_sets = st.frozensets(st.sampled_from(list(Role)))


@given(groups=st.lists(group_names, max_size=10))
def test_roles_are_exactly_the_recognised_groups(groups: list[str]) -> None:
    expected = {Role(g) for g in groups if g in ("admin", "researcher")}
    assert roles_from_groups(groups) == expected


@given(roles=role_sets)
def test_role_requirements(roles: frozenset[Role]) -> None:
    assert role_satisfies(roles, Role.researcher) == (
        Role.researcher in roles or Role.admin in roles
    )
    assert role_satisfies(roles, Role.admin) == (Role.admin in roles)


def test_empty_role_set_is_denied_every_guarded_permission() -> None:
    for permission, required in REQUIRED_ROLE.items():
        if permission is Permission.ME:
            continue
        assert required is not None
        assert not role_satisfies(frozenset(), required)


# Feature: eco-sentinel-backend, Property 7: Permission derivation
@given(roles=role_sets)
@settings(max_examples=20)
def test_permissions_are_the_union_without_duplicates(roles: frozenset[Role]) -> None:
    result = permissions_for(roles)
    assert len(result) == len(set(result))
    assert result == sorted(result)
    expected: set[str] = set()
    for role in roles:
        expected |= {p.value for p in Permission if role_satisfies([role], REQUIRED_ROLE[p])}
    assert set(result) == expected
    assert (result == []) == (not roles)


# Feature: eco-sentinel-backend, Property 4: Token acceptance
_GOOD_KEY = FakeKey("kid-good")
_OTHER_KEY = FakeKey("kid-good")  # same kid, different key material: bad signature


async def _fetch() -> dict[str, Any]:
    return _GOOD_KEY.jwks()


def _validator() -> TokenValidator:
    return TokenValidator(cache=JwksCache(_fetch), issuer=FAKE_ISSUER, client_id=FAKE_CLIENT_ID)


@given(
    signature_ok=st.booleans(),
    exp_offset=st.one_of(st.integers(60, 86_400), st.integers(-86_400, -60)),
    issuer_ok=st.booleans(),
    client_ok=st.booleans(),
    token_use=st.sampled_from(["access", "id", "refresh", ""]),
    kid_known=st.booleans(),
)
@settings(max_examples=60, deadline=None)
def test_token_accepted_iff_every_check_passes(
    signature_ok: bool,
    exp_offset: int,
    issuer_ok: bool,
    client_ok: bool,
    token_use: str,
    kid_known: bool,
) -> None:
    now = int(time.time())
    claims = {
        "sub": "user-1",
        "iss": FAKE_ISSUER if issuer_ok else FAKE_ISSUER + "-other",
        "client_id": FAKE_CLIENT_ID if client_ok else "someone-else",
        "token_use": token_use,
        "iat": now,
        "exp": now + exp_offset,
    }
    signer = _GOOD_KEY if signature_ok else _OTHER_KEY
    kid = "kid-good" if kid_known else "kid-unknown"
    token = jwt.encode(claims, signer.private_key, algorithm="RS256", headers={"kid": kid})

    should_accept = (
        signature_ok and exp_offset > 0 and issuer_ok and client_ok
        and token_use == "access"  # noqa: S105
        and kid_known
    )  # fmt: skip

    async def run() -> bool:
        try:
            await _validator().validate(token)
        except Unauthenticated:
            return False
        return True

    assert asyncio.run(run()) is should_accept
