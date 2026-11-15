"""Monitoring areas.

Revision ID: 0002_areas
Revises: 0001_extensions_users
Create Date: 2026-01-01 00:00:01
"""

from collections.abc import Sequence

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_areas"
down_revision: str | None = "0001_extensions_users"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "areas",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), server_default="active", nullable=False),
        sa.Column(
            "geom",
            geoalchemy2.Geometry(geometry_type="GEOMETRY", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column("area_ha", sa.Numeric(12, 2), nullable=False),
        sa.Column("external_polygon_id", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("char_length(name) BETWEEN 1 AND 100", name="ck_areas_name_length"),
        sa.CheckConstraint("status IN ('active','archived')", name="ck_areas_status"),
        sa.CheckConstraint(
            "GeometryType(geom) IN ('POLYGON','MULTIPOLYGON')", name="ck_areas_geom_type"
        ),
        sa.CheckConstraint("area_ha > 0", name="ck_areas_area_positive"),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name="fk_areas_created_by_users",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_areas"),
    )
    op.create_index("ix_areas_geom", "areas", ["geom"], postgresql_using="gist")
    op.create_index(
        "uq_areas_active_name",
        "areas",
        [sa.text("lower(name)")],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )
    op.create_index("ix_areas_status", "areas", ["status"])


def downgrade() -> None:
    op.drop_index("ix_areas_status", table_name="areas")
    op.drop_index(
        "uq_areas_active_name",
        table_name="areas",
        postgresql_where=sa.text("status = 'active'"),
    )
    op.drop_index("ix_areas_geom", table_name="areas", postgresql_using="gist")
    op.drop_table("areas")
