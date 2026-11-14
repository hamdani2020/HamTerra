---
inclusion: fileMatch
fileMatchPattern: "backend/**"
---

# Backend Conventions

API contract and design: #[[file:.kiro/specs/eco-sentinel-backend/design.md]]

- Follow the API contract exactly: paths under `/api/v1`, `Page[T]` lists with `limit`/`offset`, Error_Envelope `{error: {code, message, details, request_id}}`, the defined error and warning codes. Adding or changing an endpoint, field or code means updating the backend design's API Contract section and noting it for the frontend (`frontend/src/types/api.ts`, MSW handlers, `messages.ts`).
- Python: full type annotations, `mypy --strict`, ruff formatting. Async SQLAlchemy 2 and async HTTPX.
- Every state-changing action writes its Audit_Event in the same transaction; an audit failure rolls the change back.
- AgroMonitoring and Weather clients sit behind protocols (`AgroClient`, `WeatherProvider`). Apply the configured timeouts, retries with exponential backoff and jitter (429/502/503/504/timeouts only), `Retry-After`, the rate limiter and redaction. Do not call providers from read endpoints; only refresh and admin probe call them.
- Normalise provider data into internal schemas. Discard malformed items with a warning. Store metadata and NDVI statistics only, never image binaries or full raw responses (bounded, credential-free diagnostic payload only).
- Geometry: GeoJSON in EPSG:4326, longitude then latitude, PostGIS SRID 4326 with a GiST index, area via geography or a projected calculation, validation inside the configured Ghana boundary.
- Domain functions (`app/domain`) are pure and deterministic; they carry the correctness properties. Comparisons use `ndvi_diff = mean(date_b) - mean(date_a)` and refuse cross-sensor pairs.
- Migrations: one Alembic revision per schema change, reviewed by hand, with a working `downgrade`. Never edit a migration that has already been applied; add a new one.
- Tests: pytest with mocked HTTPX transports and locally generated JWT keys. Hypothesis property tests run at least 100 examples and are tagged with their design property number. No real network or credentials.
