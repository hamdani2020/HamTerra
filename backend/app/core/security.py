"""Roles and the authenticated principal (Requirements 3.1, 3.4, 3.5).

Roles come only from the ``cognito:groups`` claim of a validated token. Group names
other than ``admin`` and ``researcher`` are ignored, and matching is case-sensitive.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from enum import StrEnum


class Role(StrEnum):
    admin = "admin"
    researcher = "researcher"


@dataclass(frozen=True)
class Principal:
    sub: str
    username: str
    email: str | None
    roles: frozenset[Role]


_KNOWN_ROLES: dict[str, Role] = {role.value: role for role in Role}


def roles_from_groups(groups: Iterable[str]) -> frozenset[Role]:
    """Map Cognito group names to roles. Unknown or differently cased names are dropped."""
    return frozenset(_KNOWN_ROLES[g] for g in groups if g in _KNOWN_ROLES)


def role_satisfies(roles: Iterable[Role], required: Role | None) -> bool:
    """``admin`` satisfies every requirement. ``None`` means any authenticated user."""
    if required is None:
        return True
    held = set(roles)
    if Role.admin in held:
        return True
    return required in held
