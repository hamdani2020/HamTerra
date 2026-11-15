"""Report endpoints. Researchers see their own reports; admins see all."""

from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Pagination, get_session, get_weather_provider, guard, pagination_params
from app.api.schemas.common import Page
from app.api.schemas.reports import ReportOut, ReportRequest, ReportSummaryOut
from app.core.errors import NotImplementedFeature
from app.core.permissions import Permission
from app.core.security import Principal
from app.integrations.weather.base import WeatherProvider
from app.services import reports as report_service

router = APIRouter(tags=["reports"])

Session = Annotated[AsyncSession, Depends(get_session)]


def _out(row: report_service.ReportRow) -> ReportOut:
    return ReportOut.model_validate(report_service.report_document(row))


def _summary(row: report_service.ReportRow) -> ReportSummaryOut:
    content: dict[str, Any] = row.content
    return ReportSummaryOut.model_validate(
        {
            "id": row.report.id,
            "title": content["title"],
            "area_id": content["area"]["id"],
            "area_name": content["area"]["name"],
            "period": content["period"],
            "source": content["source"],
            "created_at": row.report.created_at,
            "created_by": content["created_by"],
        }
    )


@router.post("/reports", response_model=ReportOut, status_code=201)
async def create_report(
    body: ReportRequest,
    actor: Annotated[Principal, Depends(guard(Permission.REPORTS_CREATE))],
    session: Session,
    weather_provider: Annotated[WeatherProvider, Depends(get_weather_provider)],
) -> ReportOut:
    row = await report_service.create_report(
        session,
        actor,
        weather_provider,
        area_id=body.area_id,
        source=body.source,
        date_from=body.date_from,
        date_to=body.date_to,
        title=body.title,
        pairs=[(p.date_a, p.date_b) for p in body.comparisons],
        include_weather=body.include_weather,
    )
    return _out(row)


@router.get("/reports", response_model=Page[ReportSummaryOut])
async def list_reports(
    principal: Annotated[Principal, Depends(guard(Permission.REPORTS_READ))],
    session: Session,
    page: Annotated[Pagination, Depends(pagination_params)],
    area_id: Annotated[uuid.UUID | None, Query()] = None,
    created_by: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
) -> Page[ReportSummaryOut]:
    rows, total = await report_service.list_reports(
        session,
        principal,
        area_id=area_id,
        created_by=created_by,
        limit=page.limit,
        offset=page.offset,
    )
    return Page[ReportSummaryOut](
        items=[_summary(r) for r in rows], total=total, limit=page.limit, offset=page.offset
    )


@router.get("/reports/{report_id}", response_model=ReportOut)
async def read_report(
    report_id: uuid.UUID,
    principal: Annotated[Principal, Depends(guard(Permission.REPORTS_READ))],
    session: Session,
    format: Annotated[Literal["json", "pdf"], Query()] = "json",  # noqa: A002
) -> ReportOut:
    row = await report_service.get_report(session, principal, report_id)
    if format == "pdf":
        raise NotImplementedFeature("PDF reports are not available in this version.")
    return _out(row)
