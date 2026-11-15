from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Index, Text, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, tstz, updated_at_column, uuid_pk


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "roles <@ ARRAY['admin','researcher']::text[]", name="ck_users_roles_valid"
        ),
        CheckConstraint("status IN ('active','disabled')", name="ck_users_status"),
        Index("ix_users_roles", "roles", postgresql_using="gin"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    sub: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    username: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str | None] = mapped_column(Text, nullable=True)
    roles: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'::text[]")
    )
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="active")
    first_seen_at: Mapped[datetime] = tstz()
    last_seen_at: Mapped[datetime] = tstz()
    created_at: Mapped[datetime] = tstz()
    updated_at: Mapped[datetime] = updated_at_column()
