"""Property 2: pagination envelope (dependency and Page model, with in-memory data)."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from app.api.deps import Pagination, default_page_size, pagination_params
from app.api.schemas.common import Page
from app.core.errors import register_exception_handlers

DATA: list[int] = list(range(37))

app = FastAPI()
register_exception_handlers(app)
app.dependency_overrides[default_page_size] = lambda: 50


@app.get("/items", response_model=Page[int])
async def items(page: Annotated[Pagination, Depends(pagination_params)]) -> Page[int]:
    return Page[int](
        items=DATA[page.offset : page.offset + page.limit],
        total=len(DATA),
        limit=page.limit,
        offset=page.offset,
    )


client = TestClient(app)


@given(limit=st.integers(1, 200), offset=st.integers(0, 100))
@settings(max_examples=60, deadline=None)
def test_valid_pages(limit: int, offset: int) -> None:
    response = client.get("/items", params={"limit": limit, "offset": offset})
    assert response.status_code == 200
    body = response.json()
    assert len(body["items"]) <= limit
    assert body["total"] == len(DATA)
    assert (body["limit"], body["offset"]) == (limit, offset)
    assert body["items"] == DATA[offset : offset + limit]


@given(limit=st.one_of(st.integers(max_value=0), st.integers(min_value=201)))
@settings(max_examples=30, deadline=None)
def test_limit_out_of_range_is_422(limit: int) -> None:
    response = client.get("/items", params={"limit": limit})
    assert response.status_code == 422
    assert response.json()["error"]["details"]["fields"][0]["field"] == "limit"


@given(offset=st.integers(max_value=-1))
@settings(max_examples=30, deadline=None)
def test_negative_offset_is_422(offset: int) -> None:
    response = client.get("/items", params={"offset": offset})
    assert response.status_code == 422
    assert response.json()["error"]["details"]["fields"][0]["field"] == "offset"


@given(
    value=st.sampled_from(["abc", "1.5", "", "1e2", "NaN"]),
    name=st.sampled_from(["limit", "offset"]),
)
def test_non_integer_is_422_naming_the_parameter(value: str, name: str) -> None:
    response = client.get("/items", params={name: value})
    assert response.status_code == 422
    assert response.json()["error"]["details"]["fields"][0]["field"] == name


def test_defaults_are_applied() -> None:
    body = client.get("/items").json()
    assert (body["limit"], body["offset"]) == (50, 0)


def test_default_comes_from_the_setting() -> None:
    app.dependency_overrides[default_page_size] = lambda: 7
    try:
        body = client.get("/items").json()
        explicit = client.get("/items", params={"limit": 3}).json()
    finally:
        app.dependency_overrides[default_page_size] = lambda: 50
    assert body["limit"] == 7 and len(body["items"]) == 7
    assert explicit["limit"] == 3
