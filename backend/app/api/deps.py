"""Shared FastAPI dependencies: session, principal, authorization guard, pagination."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated, Any, cast

from fastapi import Depends, Query, Request
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import Forbidden, Unauthenticated
from app.core.permissions import REQUIRED_ROLE, Permission
from app.core.security import Principal, Role, role_satisfies, roles_from_groups
from app.db.models.users import User
from app.db.session import get_session
from app.domain.geometry import Boundary
from app.integrations.agro.models import AgroClient
from app.integrations.cognito.admin import CognitoAdmin, DisabledCognitoAdmin
from app.integrations.cognito.jwks import JwksCache, http_fetcher, jwks_url
from app.integrations.cognito.validator import TokenValidator, issuer_for
from app.integrations.weather.base import WeatherProvider
from app.integrations.weather.null import NullWeatherProvider
from app.services import audit
from app.services import settings as settings_service

logger = logging.getLogger(__name__)

__all__ = [
    "Pagination",
    "default_page_size",
    "admin_page_params",
    "get_agro_client",
    "get_cognito_admin",
    "get_ghana_boundary",
    "get_principal",
    "get_session",
    "get_settings",
    "get_token_validator",
    "get_weather_provider",
    "guard",
    "pagination_params",
]

MAX_PAGE_SIZE = 200


def get_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def get_ghana_boundary(request: Request) -> Boundary:
    """The prepared Ghana boundary loaded at startup. Tests set ``app.state.ghana_boundary``."""
    return cast(Boundary, request.app.state.ghana_boundary)


def get_agro_client(request: Request) -> AgroClient:
    """The provider client created at startup. Tests override this dependency."""
    return cast(AgroClient, request.app.state.agro_client)


def get_weather_provider(request: Request) -> WeatherProvider:
    """The provider built at startup; without one, weather is simply not configured."""
    provider = getattr(request.app.state, "weather_provider", None)
    return cast(WeatherProvider, provider) if provider is not None else NullWeatherProvider()


def get_cognito_admin(request: Request) -> CognitoAdmin:
    """Built at startup from ``COGNITO_ADMIN_ENABLED``; without one, changes are refused."""
    admin = getattr(request.app.state, "cognito_admin", None)
    return cast(CognitoAdmin, admin) if admin is not None else DisabledCognitoAdmin()


def get_token_validator(request: Request) -> TokenValidator:
    """One validator (and JWKS cache) per application, created on first use.

    Tests can set ``app.state.token_validator`` or override this dependency.
    """
    existing = getattr(request.app.state, "token_validator", None)
    if isinstance(existing, TokenValidator):
        return existing
    settings = cast(Settings, request.app.state.settings)
    cache = JwksCache(
        http_fetcher(
            jwks_url(settings.cognito_region, settings.cognito_user_pool_id),
            settings.jwks_fetch_timeout_s,
        ),
        min_refresh_interval_s=settings.jwks_min_refresh_interval_s,
        timeout_s=settings.jwks_fetch_timeout_s,
    )
    validator = TokenValidator(
        cache=cache,
        issuer=issuer_for(settings.cognito_region, settings.cognito_user_pool_id),
        client_id=settings.cognito_app_client_id,
    )
    request.app.state.token_validator = validator
    return validator


def _bearer_token(request: Request) -> str:
    header = request.headers.get("authorization")
    if header is None:
        raise Unauthenticated()
    parts = header.split(" ")
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1]:
        raise Unauthenticated()
    return parts[1]


async def _upsert_user(session: AsyncSession, principal: Principal) -> None:
    """Create or refresh the local user row. Safe under concurrent first requests."""
    roles = sorted(role.value for role in principal.roles)
    stmt = insert(User).values(
        sub=principal.sub,
        username=principal.username,
        email=principal.email,
        roles=roles,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[User.sub],
        set_={
            "username": stmt.excluded.username,
            "email": func.coalesce(stmt.excluded.email, User.email),
            "roles": stmt.excluded.roles,
            "last_seen_at": func.now(),
            "updated_at": func.now(),
        },
    )
    await session.execute(stmt)
    await session.commit()


async def get_principal(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    validator: Annotated[TokenValidator, Depends(get_token_validator)],
) -> Principal:
    """Validate the access token, derive roles from it and record the user."""
    claims = await validator.validate(_bearer_token(request))
    principal = Principal(
        sub=claims.sub,
        username=claims.username,
        email=claims.email,
        roles=roles_from_groups(claims.groups),
    )
    await _upsert_user(session, principal)
    return principal


GuardDependency = Callable[..., Awaitable[Principal]]


def _route_template(request: Request) -> str:
    """The full route template, for example ``/api/v1/areas/{area_id}``.

    The matched route's ``path`` is relative to the prefix the router was included with,
    so the prefix is taken from the request path.
    """
    route = request.scope.get("route")
    template = getattr(route, "path", None)
    path = request.url.path
    if not isinstance(template, str):
        return path
    params = {k: str(v) for k, v in request.path_params.items()}
    try:
        rendered = template.format(**params)
    except (KeyError, IndexError, ValueError):
        return template
    prefix = path[: len(path) - len(rendered)] if path.endswith(rendered) else ""
    return prefix + template


def guard(permission: Permission) -> GuardDependency:
    """Dependency that authenticates and requires the role mapped to ``permission``.

    Roles are read from the current request's token only, so nothing is cached
    between requests (Requirement 3.6). The returned function carries
    ``permission`` and ``required_role`` so a test can check every route has a guard.
    """
    required: Role | None = REQUIRED_ROLE[permission]

    async def dependency(
        request: Request,
        principal: Annotated[Principal, Depends(get_principal)],
    ) -> Principal:
        if role_satisfies(principal.roles, required):
            return principal
        # The audit write never changes the 403 outcome (Requirement 3.8).
        try:
            await audit.record_separately(
                actor_sub=principal.sub,
                action="authz.denied",
                target_type="endpoint",
                target_id=f"{request.method} {_route_template(request)}",
                outcome="denied",
                details={
                    "endpoint": _route_template(request),
                    "method": request.method,
                    "required_role": required.value if required else None,
                    "permission": permission.value,
                },
            )
        except Exception:
            logger.error("denied_audit_failed", exc_info=True)
        raise Forbidden()

    dependency.permission = permission  # type: ignore[attr-defined]
    dependency.required_role = required  # type: ignore[attr-defined]
    return dependency


@dataclass(frozen=True)
class Pagination:
    limit: int
    offset: int


async def default_page_size(session: Annotated[AsyncSession, Depends(get_session)]) -> int:
    """The ``default_page_size`` setting, read on every request (Requirement 14)."""
    return await settings_service.default_page_size(session)


async def pagination_params(
    default: Annotated[int, Depends(default_page_size)],
    limit: Annotated[int | None, Query(ge=1, le=MAX_PAGE_SIZE)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Pagination:
    return Pagination(limit=limit if limit is not None else default, offset=offset)


def admin_page_params(default: int, maximum: int = 100) -> Callable[..., Awaitable[Pagination]]:
    """Pagination for admin lists, which have their own default and maximum (12.1, 13.1)."""

    async def dependency(
        limit: int = Query(default, ge=1, le=maximum),
        offset: int = Query(0, ge=0),
    ) -> Pagination:
        return Pagination(limit=limit, offset=offset)

    return dependency


def guard_metadata(dependency: Any) -> tuple[Permission, Role | None] | None:
    """Return ``(permission, required_role)`` for a ``guard`` dependency, else None."""
    permission = getattr(dependency, "permission", None)
    if isinstance(permission, Permission):
        return permission, getattr(dependency, "required_role", None)
    return None
