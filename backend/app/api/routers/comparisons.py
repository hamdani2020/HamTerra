"""``POST /areas/{area_id}/comparisons``."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session, get_weather_provider, guard
from app.api.schemas.comparisons import ComparisonOut, ComparisonRequest
from app.api.serializers import comparison_out
from app.core.permissions import Permission
from app.core.security import Principal
from app.integrations.weather.base import WeatherProvider
from app.services import comparisons as comparison_service

router = APIRouter(tags=["comparisons"])


@router.post("/areas/{area_id}/comparisons", response_model=ComparisonOut)
async def create_comparison(
    area_id: uuid.UUID,
    body: ComparisonRequest,
    _: Annotated[Principal, Depends(guard(Permission.COMPARISONS_CREATE))],
    session: Annotated[AsyncSession, Depends(get_session)],
    weather_provider: Annotated[WeatherProvider, Depends(get_weather_provider)],
) -> ComparisonOut:
    if body.date_a == body.date_b:  # equal dates win over every other check (8.6)
        raise comparison_service.equal_dates_error()
    overrides = body.thresholds.model_dump() if body.thresholds else None
    thresholds = await comparison_service.resolve_thresholds(session, overrides)
    outcome = await comparison_service.compare_observations(
        session,
        area_id,
        source=body.source,
        date_a=body.date_a,
        date_b=body.date_b,
        thresholds=thresholds,
        include_weather=body.include_weather,
        weather_provider=weather_provider,
    )
    return comparison_out(outcome)
