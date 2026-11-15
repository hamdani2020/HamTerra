"""Metadata-level checks of the schema definition (Requirements 4.12, 16.1, 16.5, 16.7, 16.10)."""

from __future__ import annotations

from sqlalchemy import DateTime, Index
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex

import app.db.models  # noqa: F401
from app.db.base import Base


def test_all_tables_registered() -> None:
    assert set(Base.metadata.tables) == {
        "users",
        "areas",
        "observations",
        "retrieval_records",
        "reports",
        "comparisons",
        "app_settings",
        "audit_events",
    }


def _index(table: str, name: str) -> Index:
    return next(i for i in Base.metadata.tables[table].indexes if i.name == name)


def _ddl(index: Index) -> str:
    dialect = postgresql.dialect()  # type: ignore[no-untyped-call]
    return str(CreateIndex(index).compile(dialect=dialect))


def test_areas_geom_has_gist_index() -> None:
    assert "USING gist" in _ddl(_index("areas", "ix_areas_geom"))


def test_partial_unique_indexes() -> None:
    assert _index("areas", "uq_areas_active_name").unique
    sql = _ddl(_index("retrieval_records", "uq_retrieval_one_running"))
    assert "WHERE status = 'running' AND kind = 'refresh'" in sql


def test_observation_unique_constraint_named() -> None:
    names = {c.name for c in Base.metadata.tables["observations"].constraints}
    assert "uq_observation_area_source_date" in names


def test_retrieval_payload_limit_constraint() -> None:
    names = {c.name for c in Base.metadata.tables["retrieval_records"].constraints}
    assert "ck_retrieval_raw_payload_size" in names
    assert "ck_retrieval_error_message_len" in names


def test_every_timestamp_is_timezone_aware() -> None:
    for table in Base.metadata.tables.values():
        for column in table.columns:
            if isinstance(column.type, DateTime):
                assert column.type.timezone, f"{table.name}.{column.name}"
