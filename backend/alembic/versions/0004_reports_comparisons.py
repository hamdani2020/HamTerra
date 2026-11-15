"""Reports and comparisons.

Revision ID: 0004_reports_comparisons
Revises: 0003_retrievals_observations
Create Date: 2026-01-01 00:00:03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_reports_comparisons"
down_revision: str | None = "0003_retrievals_observations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reports",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("area_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("period_from", sa.Date(), nullable=False),
        sa.Column("period_to", sa.Date(), nullable=False),
        sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("source IN ('sentinel-2','landsat-8')", name="ck_reports_source"),
        sa.CheckConstraint("period_from <= period_to", name="ck_reports_period_order"),
        sa.ForeignKeyConstraint(
            ["area_id"], ["areas.id"], name="fk_reports_area_id_areas", ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name="fk_reports_created_by_users", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_reports"),
    )
    op.create_index("ix_reports_created_by", "reports", ["created_by", sa.text("created_at DESC")])
    op.create_index("ix_reports_area", "reports", ["area_id"])

    op.create_table(
        "comparisons",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("area_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("date_a", sa.Date(), nullable=False),
        sa.Column("date_b", sa.Date(), nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("source IN ('sentinel-2','landsat-8')", name="ck_comparisons_source"),
        sa.CheckConstraint("date_a <> date_b", name="ck_comparisons_dates_differ"),
        sa.ForeignKeyConstraint(
            ["report_id"],
            ["reports.id"],
            name="fk_comparisons_report_id_reports",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["area_id"],
            ["areas.id"],
            name="fk_comparisons_area_id_areas",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_comparisons"),
    )
    op.create_index("ix_comparisons_report", "comparisons", ["report_id"])


def downgrade() -> None:
    op.drop_index("ix_comparisons_report", table_name="comparisons")
    op.drop_table("comparisons")
    op.drop_index("ix_reports_area", table_name="reports")
    op.drop_index("ix_reports_created_by", table_name="reports")
    op.drop_table("reports")
