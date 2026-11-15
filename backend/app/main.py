"""Application factory."""

from __future__ import annotations

import importlib
import logging
import pkgutil
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp

from app.api.middleware import BodySizeLimitMiddleware, RequestIdMiddleware
from app.api.routers.health import read_alembic_head
from app.core.boundary import BoundaryError, load_ghana_boundary
from app.core.config import Settings, load_settings_or_exit
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.db.session import dispose_engine, get_sessionmaker, init_engine
from app.integrations.agro.client import build_agro_client
from app.services.retrievals import expire_stale_running

API_PREFIX = "/api/v1"
ROUTERS_PACKAGE = "app.api.routers"
UNVERSIONED_ROUTERS = frozenset({"health"})

logger = logging.getLogger(__name__)


class EcoSentinelApp(FastAPI):
    """FastAPI app with RequestIdMiddleware outermost, so it also covers 500 responses."""

    def build_middleware_stack(self) -> ASGIApp:
        return RequestIdMiddleware(super().build_middleware_stack())


def _secret_values(settings: Settings) -> list[str]:
    candidates = (
        settings.database_url,
        settings.agro_api_key,
        settings.weather_api_key,
        settings.aws_access_key_id,
        settings.aws_secret_access_key,
        settings.aws_session_token,
    )
    return [c.get_secret_value() for c in candidates if c is not None]


def discover_routers() -> list[tuple[str, APIRouter]]:
    """Import every module in ``app.api.routers`` that exposes ``router``."""
    try:
        package = importlib.import_module(ROUTERS_PACKAGE)
    except ModuleNotFoundError:
        return []
    found: list[tuple[str, APIRouter]] = []
    for info in sorted(pkgutil.iter_modules(package.__path__), key=lambda i: i.name):
        if info.name.startswith("_"):
            continue
        module = importlib.import_module(f"{ROUTERS_PACKAGE}.{info.name}")
        router = getattr(module, "router", None)
        if isinstance(router, APIRouter):
            found.append((info.name, router))
    return found


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the app. Pass ``settings`` to override environment loading (tests)."""
    resolved = settings if settings is not None else load_settings_or_exit()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        configure_logging(resolved.log_level, _secret_values(resolved))
        app.state.settings = resolved
        try:
            app.state.ghana_boundary = load_ghana_boundary(resolved.ghana_boundary_path)
        except BoundaryError as exc:
            logger.critical("startup_failed", extra={"reason": str(exc)})
            raise
        init_engine(resolved.database_url.get_secret_value())
        try:
            app.state.alembic_head = read_alembic_head()
        except Exception:
            app.state.alembic_head = None
            logger.warning("alembic head could not be read")
        try:
            async with get_sessionmaker()() as session:
                expired = await expire_stale_running(session)
            logger.info(
                "startup", extra={"app_env": resolved.app_env, "expired_retrievals": expired}
            )
        except Exception:
            logger.warning("stale retrieval cleanup skipped")
        agro_client = build_agro_client(resolved)
        app.state.agro_client = agro_client
        try:
            yield
        finally:
            await agro_client.aclose()
            await dispose_engine()

    app = EcoSentinelApp(
        title="Eco-Sentinel Ghana API",
        lifespan=lifespan,
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=f"{API_PREFIX}/redoc",
    )
    app.state.settings = resolved
    register_exception_handlers(app)

    # Added innermost first: CORS, then body limit, (request id wraps both).
    if resolved.allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=resolved.allowed_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
            expose_headers=["X-Request-ID"],
        )
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=resolved.max_body_bytes)

    for name, router in discover_routers():
        if name in UNVERSIONED_ROUTERS:
            app.include_router(router)
        else:
            app.include_router(router, prefix=API_PREFIX)

    return app


def _build_default_app() -> FastAPI:
    return create_app()
