from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import CheckConstraint, ForeignKey, Index, Numeric, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, tstz, updated_at_column, uuid_pk


class Area(Base):
    __tablename__ = "areas"
    __table_args__ = (
        CheckConstraint("char_length(name) BETWEEN 1 AND 100", name="ck_areas_name_length"),
        CheckConstraint("status IN ('active','archived')", name="ck_areas_status"),
        CheckConstraint(
            "GeometryType(geom) IN ('POLYGON','MULTIPOLYGON')", name="ck_areas_geom_type"
        ),
        CheckConstraint("area_ha > 0", name="ck_areas_area_positive"),
        Index("ix_areas_geom", "geom", postgresql_using="gist"),
        Index(
            "uq_areas_active_name",
            text("lower(name)"),
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
        Index("ix_areas_status", "status"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="active")
    geom: Mapped[Any] = mapped_column(
        Geometry(geometry_type="GEOMETRY", srid=4326, spatial_index=False), nullable=False
    )
    area_ha: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    external_polygon_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = tstz()
    updated_at: Mapped[datetime] = updated_at_column()
