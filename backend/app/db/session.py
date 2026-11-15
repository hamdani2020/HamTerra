"""Async engine and one-session-per-request management (Requirements 1.6, 16.6)."""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def init_engine(database_url: str) -> AsyncEngine:
    """Create the process-wide engine. Connections use UTC so timestamps are unambiguous."""
    global _engine, _sessionmaker
    _engine = create_async_engine(
        database_url,
        pool_pre_ping=True,
        connect_args={"server_settings": {"timezone": "UTC"}},
    )
    _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    if _sessionmaker is None:
        raise RuntimeError("Database engine is not initialised")
    return _sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request, rolled back on any error.

    Services call ``commit()`` once at the end of a use case. Anything left
    uncommitted is rolled back when the request ends.
    """
    async with get_sessionmaker()() as session:
        try:
            yield session
        except BaseException:
            await session.rollback()
            raise
        finally:
            if session.in_transaction():
                await session.rollback()
