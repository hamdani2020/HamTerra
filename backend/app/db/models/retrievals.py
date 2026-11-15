from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, Integer, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, tstz, uuid_pk


class RetrievalRecord(Base):
    __tablename__ = "retrieval_records"
    __table_args__ = (
        CheckConstraint("provider IN ('agromonitoring','weather')", name="ck_retrieval_provider"),
        CheckConstraint(
            "kind IN ('refresh','probe','polygon','weather')", name="ck_retrieval_kind"
        ),
        CheckConstraint(
            "status IN ('running','success','partial','empty','failed')",
            name="ck_retrieval_status",
        ),
        CheckConstraint("item_count >= 0", name="ck_retrieval_item_count"),
        CheckConstraint("duration_ms IS NULL OR duration_ms >= 0", name="ck_retrieval_duration"),
        CheckConstraint(
            "error_message IS NULL OR char_length(error_message) <= 500",
            name="ck_retrieval_error_message_len",
        ),
        CheckConstraint(
            "raw_payload IS NULL OR octet_length(raw_payload) <= 65536",
            name="ck_retrieval_raw_payload_size",
        ),
        Index(
            "uq_retrieval_one_running",
            "area_id",
            unique=True,
            postgresql_where=text("status = 'running' AND kind = 'refresh'"),
        ),
        Index("ix_retrieval_started", text("started_at DESC")),
        Index("ix_retrieval_provider_status", "provider", "status", "started_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False, server_default="refresh")
    area_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("areas.id", ondelete="SET NULL"), nullable=True
    )
    requested_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    requested_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    item_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = tstz()
    finished_at: Mapped[datetime | None] = tstz(nullable=True, default_now=False)
