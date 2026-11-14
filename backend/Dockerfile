FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir uv \
    && useradd --create-home --uid 1000 app \
    && mkdir -p /app /opt/venv \
    && chown app:app /app /opt/venv

WORKDIR /app
USER app

# Runtime dependencies only, from the committed lock file.
COPY --chown=app:app pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

EXPOSE 8000

# Development: adds the dev group (pytest, hypothesis, ruff, mypy).
# Source arrives through the Compose bind mount, which also provides hot reload.
FROM base AS dev
RUN uv sync --frozen
CMD ["./entrypoint.sh", "uvicorn", "app.main:create_app", "--factory", \
     "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "/app/app"]

# Production: source is copied in, no reload.
FROM base AS prod
COPY --chown=app:app . .
RUN chmod +x entrypoint.sh
CMD ["./entrypoint.sh", "uvicorn", "app.main:create_app", "--factory", \
     "--host", "0.0.0.0", "--port", "8000"]
