"""App settings (seeded) and the immutable audit log.

Revision ID: 0005_settings_audit
Revises: 0004_reports_comparisons
Create Date: 2026-01-01 00:00:04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_settings_audit"
down_revision: str | None = "0004_reports_comparisons"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# key, data_type, default, min, max
SEED_SETTINGS: tuple[tuple[str, str, str, str | None, str | None], ...] = (
    ("ndvi_diff_threshold", "decimal", "0.10", "0.00", "2.00"),
    ("cloud_limit_pct", "decimal", "20", "0", "100"),
    ("data_coverage_min_pct", "decimal", "80", "0", "100"),
    ("gap_threshold_days", "integer", "30", "1", "3660"),
    ("weather_enabled", "boolean", "false", None, None),
    ("default_page_size", "integer", "50", "1", "200"),
)


def upgrade() -> None:
    settings = op.create_table(
        "app_settings",
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("data_type", sa.Text(), nullable=False),
        sa.Column("default_value", sa.Text(), nullable=False),
        sa.Column("min_value", sa.Numeric(), nullable=True),
        sa.Column("max_value", sa.Numeric(), nullable=True),
        sa.Column("updated_by", sa.Text(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "data_type IN ('integer','decimal','boolean')", name="ck_app_settings_data_type"
        ),
        sa.CheckConstraint(
            "data_type <> 'boolean' OR (min_value IS NULL AND max_value IS NULL)",
            name="ck_app_settings_boolean_no_range",
        ),
        sa.PrimaryKeyConstraint("key", name="pk_app_settings"),
    )
    op.bulk_insert(
        settings,
        [
            {
                "key": key,
                "value": default,
                "data_type": data_type,
                "default_value": default,
                "min_value": min_value,
                "max_value": max_value,
            }
            for key, data_type, default, min_value, max_value in SEED_SETTINGS
        ],
    )

    op.create_table(
        "audit_events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("actor_sub", sa.Text(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target_type", sa.Text(), nullable=False),
        sa.Column("target_id", sa.Text(), nullable=True),
        sa.Column("request_id", sa.Text(), nullable=False),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column(
            "details",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.CheckConstraint("outcome IN ('success','failure','denied')", name="ck_audit_outcome"),
        sa.PrimaryKeyConstraint("id", name="pk_audit_events"),
    )
    op.create_index("ix_audit_time", "audit_events", [sa.text("occurred_at DESC")])
    op.create_index(
        "ix_audit_actor_time", "audit_events", ["actor_sub", sa.text("occurred_at DESC")]
    )
    op.create_index("ix_audit_action_time", "audit_events", ["action", sa.text("occurred_at DESC")])

    op.execute(
        """
        CREATE FUNCTION audit_events_immutable() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP
                USING ERRCODE = 'restrict_violation';
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_audit_events_immutable
        BEFORE UPDATE OR DELETE ON audit_events
        FOR EACH ROW EXECUTE FUNCTION audit_events_immutable()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events")
    op.execute("DROP FUNCTION IF EXISTS audit_events_immutable()")
    op.drop_index("ix_audit_action_time", table_name="audit_events")
    op.drop_index("ix_audit_actor_time", table_name="audit_events")
    op.drop_index("ix_audit_time", table_name="audit_events")
    op.drop_table("audit_events")
    op.drop_table("app_settings")
