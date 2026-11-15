"""Liveness and readiness endpoints. Unauthenticated, no provider calls (Requirement 19)."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.db.session import get_sessionmaker

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])

DB_TIMEOUT_S = 2.0
OVERALL_TIMEOUT_S = 3.0
_ALEMBIC_DIR = Path(__file__).resolve().parents[3] / "alembic"


def read_alembic_head() -> str | None:
    """Head revision from the Alembic script directory."""
    config = Config()
    config.set_main_option("script_location", str(_ALEMBIC_DIR))
    return ScriptDirectory.from_config(config).get_current_head()


async def _run_checks(head: str | None, failed: list[str]) -> None:
    try:
        async with get_sessionmaker()() as session:
            async with asyncio.timeout(DB_TIMEOUT_S):
                await session.execute(text("SELECT 1"))
            try:
                result = await session.execute(text("SELECT version_num FROM alembic_version"))
                versions = [row[0] for row in result.all()]
                if head is None or versions != [head]:
                    failed.append("migrations")
            except Exception:
                failed.append("migrations")
    except Exception:
        failed.clear()
        failed.append("database")


@router.get("/health/live")
async def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready", response_model=None)
async def ready(request: Request) -> JSONResponse:
    head = getattr(request.app.state, "alembic_head", None)
    failed: list[str] = []
    try:
        async with asyncio.timeout(OVERALL_TIMEOUT_S):
            await _run_checks(head, failed)
    except TimeoutError:
        failed = ["database"] if "database" in failed or not failed else failed
    if failed:
        logger.warning("readiness failed", extra={"failed_checks": failed})
        return JSONResponse(status_code=503, content={"status": "unavailable", "failed": failed})
    return JSONResponse(
        status_code=200,
        content={"status": "ok", "checks": {"database": "ok", "migrations": "ok"}},
    )
