"""Retrieval records and observations.

Revision ID: 0003_retrievals_observations
Revises: 0002_areas
Create Date: 2026-01-01 00:00:02
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_retrievals_observations"
down_revision: str | None = "0002_areas"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _uuid_pk() -> sa.Column[Any]:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        server_default=sa.text("gen_random_uuid()"),
        nullable=False,
    )


def _now(name: str) -> sa.Column[Any]:
    return sa.Column(
        name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
    )


def upgrade() -> None:
    op.create_table(
        "retrieval_records",
        _uuid_pk(),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), server_default="refresh", nullable=False),
        sa.Column("area_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("requested_by", sa.Text(), nullable=True),
        sa.Column("requested_from", sa.Date(), nullable=True),
        sa.Column("requested_to", sa.Date(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("item_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("raw_payload", sa.Text(), nullable=True),
        _now("started_at"),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "provider IN ('agromonitoring','weather')", name="ck_retrieval_provider"
        ),
        sa.CheckConstraint(
            "kind IN ('refresh','probe','polygon','weather')", name="ck_retrieval_kind"
        ),
        sa.CheckConstraint(
            "status IN ('running','success','partial','empty','failed')",
            name="ck_retrieval_status",
        ),
        sa.CheckConstraint("item_count >= 0", name="ck_retrieval_item_count"),
        sa.CheckConstraint("duration_ms IS NULL OR duration_ms >= 0", name="ck_retrieval_duration"),
        sa.CheckConstraint(
            "error_message IS NULL OR char_length(error_message) <= 500",
            name="ck_retrieval_error_message_len",
        ),
        sa.CheckConstraint(
            "raw_payload IS NULL OR octet_length(raw_payload) <= 65536",
            name="ck_retrieval_raw_payload_size",
        ),
        sa.ForeignKeyConstraint(
            ["area_id"],
            ["areas.id"],
            name="fk_retrieval_records_area_id_areas",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_retrieval_records"),
    )
    op.create_index(
        "uq_retrieval_one_running",
        "retrieval_records",
        ["area_id"],
        unique=True,
        postgresql_where=sa.text("status = 'running' AND kind = 'refresh'"),
    )
    op.create_index("ix_retrieval_started", "retrieval_records", [sa.text("started_at DESC")])
    op.create_index(
        "ix_retrieval_provider_status",
        "retrieval_records",
        ["provider", "status", "started_at"],
    )

    op.create_table(
        "observations",
        _uuid_pk(),
        sa.Column("area_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("acquired_on", sa.Date(), nullable=False),
        sa.Column("cloud_coverage", sa.Numeric(5, 2), nullable=True),
        sa.Column("data_coverage", sa.Numeric(5, 2), nullable=True),
        sa.Column("ndvi_mean", sa.Numeric(7, 4), nullable=False),
        sa.Column("ndvi_min", sa.Numeric(7, 4), nullable=True),
        sa.Column("ndvi_max", sa.Numeric(7, 4), nullable=True),
        sa.Column("ndvi_std", sa.Numeric(7, 4), nullable=True),
        sa.Column("ndvi_median", sa.Numeric(7, 4), nullable=True),
        sa.Column("preview_ref", sa.Text(), nullable=True),
        sa.Column("preview_width_px", sa.Integer(), nullable=True),
        sa.Column("preview_height_px", sa.Integer(), nullable=True),
        sa.Column("geometry_status", sa.Text(), server_default="current", nullable=False),
        sa.Column("retrieval_id", postgresql.UUID(as_uuid=True), nullable=True),
        _now("created_at"),
        _now("updated_at"),
        sa.CheckConstraint("source IN ('sentinel-2','landsat-8')", name="ck_obs_source"),
        sa.CheckConstraint(
            "cloud_coverage IS NULL OR cloud_coverage BETWEEN 0 AND 100",
            name="ck_obs_cloud_range",
        ),
        sa.CheckConstraint(
            "data_coverage IS NULL OR data_coverage BETWEEN 0 AND 100",
            name="ck_obs_data_range",
        ),
        sa.CheckConstraint("ndvi_mean BETWEEN -1 AND 1", name="ck_obs_ndvi_mean_range"),
        sa.CheckConstraint(
            "geometry_status IN ('current','stale_geometry')", name="ck_obs_geometry_status"
        ),
        sa.ForeignKeyConstraint(
            ["area_id"],
            ["areas.id"],
            name="fk_observations_area_id_areas",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["retrieval_id"],
            ["retrieval_records.id"],
            name="fk_observations_retrieval_id_retrieval_records",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_observations"),
        sa.UniqueConstraint(
            "area_id", "source", "acquired_on", name="uq_observation_area_source_date"
        ),
    )
    op.create_index(
        "ix_obs_area_source_date",
        "observations",
        ["area_id", "source", sa.text("acquired_on DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_obs_area_source_date", table_name="observations")
    op.drop_table("observations")
    op.drop_index("ix_retrieval_provider_status", table_name="retrieval_records")
    op.drop_index("ix_retrieval_started", table_name="retrieval_records")
    op.drop_index(
        "uq_retrieval_one_running",
        table_name="retrieval_records",
        postgresql_where=sa.text("status = 'running' AND kind = 'refresh'"),
    )
    op.drop_table("retrieval_records")
