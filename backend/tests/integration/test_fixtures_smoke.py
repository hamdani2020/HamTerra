"""Checks the integration fixtures themselves (Requirements 22.2, 22.8)."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def test_postgis_and_rollback(db_session: AsyncSession) -> None:
    assert await db_session.scalar(text("SELECT PostGIS_Version()"))
    await db_session.execute(text("CREATE TEMP TABLE t_rollback (x int) ON COMMIT DROP"))
    await db_session.commit()


async def test_session_state_is_isolated(db_session: AsyncSession) -> None:
    exists = await db_session.scalar(text("SELECT to_regclass('pg_temp.t_rollback')"))
    assert exists is None
