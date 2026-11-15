from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, tstz, uuid_pk


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (
        CheckConstraint("source IN ('sentinel-2','landsat-8')", name="ck_reports_source"),
        CheckConstraint("period_from <= period_to", name="ck_reports_period_order"),
        Index("ix_reports_created_by", "created_by", text("created_at DESC")),
        Index("ix_reports_area", "area_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    title: Mapped[str] = mapped_column(Text, nullable=False)
    area_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("areas.id", ondelete="RESTRICT"), nullable=False
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    source: Mapped[str] = mapped_column(Text, nullable=False)
    period_from: Mapped[date] = mapped_column(Date, nullable=False)
    period_to: Mapped[date] = mapped_column(Date, nullable=False)
    content: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = tstz()


class Comparison(Base):
    __tablename__ = "comparisons"
    __table_args__ = (
        CheckConstraint("source IN ('sentinel-2','landsat-8')", name="ck_comparisons_source"),
        CheckConstraint("date_a <> date_b", name="ck_comparisons_dates_differ"),
        Index("ix_comparisons_report", "report_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    report_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reports.id", ondelete="CASCADE"), nullable=False
    )
    area_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("areas.id", ondelete="RESTRICT"), nullable=False
    )
    source: Mapped[str] = mapped_column(Text, nullable=False)
    date_a: Mapped[date] = mapped_column(Date, nullable=False)
    date_b: Mapped[date] = mapped_column(Date, nullable=False)
    result: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = tstz()
