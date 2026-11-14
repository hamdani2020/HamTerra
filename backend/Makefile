.PHONY: lint format-check typecheck unit test

lint:
	uv run ruff check .

format-check:
	uv run ruff format --check .

typecheck:
	uv run mypy --strict app

unit:
	uv run pytest

# Exits non-zero if any step fails.
test: lint format-check typecheck unit
