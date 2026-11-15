"""Retrieval record housekeeping."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import CursorResult, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.retrievals import RetrievalRecord

RUNNING_EXPIRY_SECONDS = 150
EXPIRED_CODE = "EXPIRED"


async def expire_stale_running(session: AsyncSession) -> int:
    """Set ``running`` records older than 150 s to ``failed`` with code ``EXPIRED``.

    Returns the number of rows changed. Commits its own transaction.
    """
    stmt = (
        update(RetrievalRecord)
        .where(
            RetrievalRecord.status == "running",
            RetrievalRecord.started_at < func.now() - timedelta(seconds=RUNNING_EXPIRY_SECONDS),
        )
        .values(
            status="failed",
            error_code=EXPIRED_CODE,
            error_message="Retrieval did not finish and was expired.",
            finished_at=func.now(),
        )
    )
    result = await session.execute(stmt)
    await session.commit()
    if not isinstance(result, CursorResult):
        return 0
    return int(result.rowcount)
