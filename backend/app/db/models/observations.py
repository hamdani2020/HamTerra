from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, tstz, updated_at_column, uuid_pk


class Observation(Base):
    __tablename__ = "observations"
    __table_args__ = (
        CheckConstraint("source IN ('sentinel-2','landsat-8')", name="ck_obs_source"),
        CheckConstraint(
            "cloud_coverage IS NULL OR cloud_coverage BETWEEN 0 AND 100",
            name="ck_obs_cloud_range",
        ),
        CheckConstraint(
            "data_coverage IS NULL OR data_coverage BETWEEN 0 AND 100",
            name="ck_obs_data_range",
        ),
        CheckConstraint("ndvi_mean BETWEEN -1 AND 1", name="ck_obs_ndvi_mean_range"),
        CheckConstraint(
            "geometry_status IN ('current','stale_geometry')", name="ck_obs_geometry_status"
        ),
        UniqueConstraint(
            "area_id", "source", "acquired_on", name="uq_observation_area_source_date"
        ),
        Index(
            "ix_obs_area_source_date",
            "area_id",
            "source",
            text("acquired_on DESC"),
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    area_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("areas.id", ondelete="RESTRICT"), nullable=False
    )
    source: Mapped[str] = mapped_column(Text, nullable=False)
    acquired_on: Mapped[date] = mapped_column(Date, nullable=False)
    cloud_coverage: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    data_coverage: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    ndvi_mean: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False)
    ndvi_min: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    ndvi_max: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    ndvi_std: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    ndvi_median: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    preview_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    preview_width_px: Mapped[int | None] = mapped_column(Integer, nullable=True)
    preview_height_px: Mapped[int | None] = mapped_column(Integer, nullable=True)
    geometry_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="current")
    retrieval_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("retrieval_records.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = tstz()
    updated_at: Mapped[datetime] = updated_at_column()
