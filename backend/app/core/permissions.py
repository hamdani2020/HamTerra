"""The only module that spells permission strings (Requirement 15.5)."""

from __future__ import annotations

from collections.abc import Iterable
from enum import StrEnum

from app.core.security import Role, role_satisfies


class Permission(StrEnum):
    ME = "me:read"
    AREAS_READ = "areas:read"
    OBSERVATIONS_READ = "observations:read"
    OBSERVATIONS_REFRESH = "observations:refresh"
    TIMESERIES_READ = "timeseries:read"
    COMPARISONS_CREATE = "comparisons:create"
    REPORTS_CREATE = "reports:create"
    REPORTS_READ = "reports:read"  # own reports
    REPORTS_READ_ALL = "reports:read_all"  # used inside the service, admin only
    SETTINGS_READ = "settings:read"
    SETTINGS_WRITE = "settings:write"
    AREAS_WRITE = "areas:write"
    USERS_READ = "users:read"
    USERS_WRITE_ROLES = "users:write_roles"
    OPS_READ = "ops:read"  # retrievals, integrations, activity, dashboard


# None means any authenticated user (only ME).
REQUIRED_ROLE: dict[Permission, Role | None] = {
    Permission.ME: None,
    Permission.AREAS_READ: Role.researcher,
    Permission.OBSERVATIONS_READ: Role.researcher,
    Permission.OBSERVATIONS_REFRESH: Role.researcher,
    Permission.TIMESERIES_READ: Role.researcher,
    Permission.COMPARISONS_CREATE: Role.researcher,
    Permission.REPORTS_CREATE: Role.researcher,
    Permission.REPORTS_READ: Role.researcher,
    Permission.REPORTS_READ_ALL: Role.admin,
    Permission.SETTINGS_READ: Role.researcher,
    Permission.SETTINGS_WRITE: Role.admin,
    Permission.AREAS_WRITE: Role.admin,
    Permission.USERS_READ: Role.admin,
    Permission.USERS_WRITE_ROLES: Role.admin,
    Permission.OPS_READ: Role.admin,
}


def permissions_for(roles: Iterable[Role]) -> list[str]:
    """Deduplicated, sorted union of the permissions of each role.

    A user with no role has no permissions, including ``me:read``.
    """
    held = frozenset(roles)
    granted = {
        permission.value
        for permission in Permission
        if any(role_satisfies([role], REQUIRED_ROLE[permission]) for role in held)
    }
    return sorted(granted)
