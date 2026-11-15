from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, updated_at_column


class AppSetting(Base):
    __tablename__ = "app_settings"
    __table_args__ = (
        CheckConstraint(
            "data_type IN ('integer','decimal','boolean')", name="ck_app_settings_data_type"
        ),
        CheckConstraint(
            "data_type <> 'boolean' OR (min_value IS NULL AND max_value IS NULL)",
            name="ck_app_settings_boolean_no_range",
        ),
    )

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    data_type: Mapped[str] = mapped_column(Text, nullable=False)
    default_value: Mapped[str] = mapped_column(Text, nullable=False)
    min_value: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    max_value: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    updated_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = updated_at_column()
