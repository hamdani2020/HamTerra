"""PostGIS extension and users table.

Revision ID: 0001_extensions_users
Revises:
Create Date: 2026-01-01 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_extensions_users"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("sub", sa.Text(), nullable=False),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column(
            "roles",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        sa.Column("status", sa.Text(), server_default="active", nullable=False),
        sa.Column(
            "first_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
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
        sa.CheckConstraint(
            "roles <@ ARRAY['admin','researcher']::text[]", name="ck_users_roles_valid"
        ),
        sa.CheckConstraint("status IN ('active','disabled')", name="ck_users_status"),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("sub", name="uq_users_sub"),
    )
    op.create_index("ix_users_roles", "users", ["roles"], postgresql_using="gin")


def downgrade() -> None:
    # The postgis extension is left in place: other databases objects may depend on it.
    op.drop_index("ix_users_roles", table_name="users", postgresql_using="gin")
    op.drop_table("users")
