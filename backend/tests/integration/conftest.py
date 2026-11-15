"""PostGIS integration fixtures (Requirements 22.2, 22.8).

A throwaway test database is created on the configured host, migrated to head
once per session, and every test gets a session whose work is rolled back.
When the database is unreachable the tests are skipped with a clear message.
Set ``TEST_DATABASE_URL`` to point at a different test database. It must be an
``postgresql+asyncpg`` URL and the host must be allowed by pytest-socket.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

DEFAULT_TEST_DATABASE_URL = "postgresql+asyncpg://test:test@postgis:5432/eco_test"
BACKEND_DIR = Path(__file__).resolve().parents[2]


def _test_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)


async def _prepare_database(url: str) -> None:
    """Create the test database if missing. Raises OSError-like errors when unreachable."""
    parsed = make_url(url)
    admin = create_async_engine(
        parsed.set(database="postgres"), poolclass=NullPool, isolation_level="AUTOCOMMIT"
    )
    try:
        async with admin.connect() as conn:
            exists = await conn.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": parsed.database}
            )
            if not exists:
                # Identifier comes from our own configuration, quoted by the dialect.
                quoted = admin.dialect.identifier_preparer.quote(str(parsed.database))
                await conn.execute(text(f"CREATE DATABASE {quoted}"))
    finally:
        await admin.dispose()
    engine = create_async_engine(url, poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
            await conn.commit()
    finally:
        await engine.dispose()


@pytest.fixture(scope="session")
def migrated_database_url() -> Iterator[str]:
    url = _test_url()
    try:
        asyncio.run(_prepare_database(url))
    except Exception as exc:  # noqa: BLE001 - any connection failure means "skip"
        host = make_url(url).host
        pytest.skip(
            f"PostGIS test database unreachable at host '{host}' ({type(exc).__name__}). "
            "Start it with `docker compose up -d postgis` and run the tests in the backend "
            "container, or set TEST_DATABASE_URL."
        )
    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = url
    try:
        cfg = Config(str(BACKEND_DIR / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
        command.upgrade(cfg, "head")
    finally:
        if previous is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous
    yield url


@pytest_asyncio.fixture
async def db_engine(migrated_database_url: str) -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(
        migrated_database_url,
        poolclass=NullPool,
        connect_args={"server_settings": {"timezone": "UTC"}},
    )
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    """Session inside an outer transaction that is always rolled back.

    ``commit()`` calls made by code under test only release a savepoint.
    """
    async with db_engine.connect() as conn:
        outer = await conn.begin()
        session = AsyncSession(
            bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        try:
            yield session
        finally:
            await session.close()
            if outer.is_active:
                await outer.rollback()
