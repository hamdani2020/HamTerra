# Implementation Plan: Eco-Sentinel Ghana Backend

## Overview

The implementation language is Python 3.12 (FastAPI, SQLAlchemy 2 async, GeoAlchemy2, Alembic, HTTPX), as set in the design. Work proceeds bottom-up: scaffolding, configuration, cross-cutting plumbing, database, auth, provider client, then each feature (areas, settings, observations, time series, comparisons, weather, reports, admin), then hardening and docs. Every step ends wired into the app, so no code is left orphaned.

Decisions from the design that override the requirements text:
- The default and maximum area is 3000 ha (`AREA_MAX_HA` above 3000 stops startup).
- `ndvi_diff = NDVI(date_b) - NDVI(date_a)`, and `ndvi_diff_pct` is relative to the mean of `date_a`.
- Retrieval status values are `running`, `success`, `partial`, `empty`, `failed`. The time-series `summary` is always an object.
- `GET /settings` also returns `gap_threshold_days`.

Router modules under `app/api/routers/` each expose a `router` object. `app/main.py` discovers them with `pkgutil`, so adding a router never edits `main.py`.

Out of scope: ML, illegal-mining classification, raster processing, production AWS infrastructure, PDF rendering (the endpoint returns 501).

## Tasks

- [x] 1. Repository scaffolding and Docker Compose
  - [x] 1.1 Create backend project scaffolding
    - Create `.gitignore` (exclude `.env`, `.env.*`, keep `.env.example`), `.env.example` with every variable from the design, `backend/pyproject.toml` (runtime and dev dependency groups, ruff, mypy `--strict`, pytest config with `pytest-socket --allow-hosts=postgis`, asyncio mode), a committed `uv.lock`, and `backend/Makefile` where `make test` runs `ruff check`, `ruff format --check`, `mypy --strict app` and `pytest`.
    - Create the package skeleton `app/{core,api,domain,services,integrations,db}` and `tests/{unit,properties,integration,api}` with `tests/conftest.py` that sets dummy environment values and blocks real credentials.
    - _Requirements: 17.1, 17.2, 22.10, 23.6, 23.7, 23.8_

  - [x] 1.2 Create Dockerfile, entrypoint and Compose stack
    - `backend/Dockerfile` with `base`, `dev` and `prod` targets and a non-root user. `backend/entrypoint.sh` runs `alembic upgrade head` unless `MIGRATE_ON_START=false` and exits non-zero on failure.
    - `docker-compose.yml` with `postgis` (postgis/postgis:16-3.4), `backend`, `frontend` (placeholder whose build context is `./frontend`, defined by the eco-sentinel-frontend spec) and `pgadmin` on network `eco-net`, named volumes, `${VAR:?}` required variables, health checks (interval 10 s, timeout 5 s, 5 retries), `depends_on` health conditions, bind mount for hot reload, and ports bound to `${BIND_ADDRESS:-127.0.0.1}`.
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.11, 20.15_

- [x] 2. Configuration, logging, errors and middleware
  - [x] 2.1 Implement settings loading with startup validation
    - `app/core/config.py` with `pydantic-settings`. Collect all missing required variables into one error that lists names only. Validate `LOG_LEVEL` case-insensitively, ranges (timeouts 1 to 30, concurrency 1 to 20, RPM 1 to 60, body limit 1 KB to 10 MB), and refuse `AREA_MAX_HA` above 3000.
    - _Requirements: 2.11, 2.12, 5.1, 5.2, 5.3, 5.11, 10.1, 10.2, 17.3, 19.5, 19.6, 19.7, 23.4_

  - [ ]* 2.2 Write property test for startup configuration validation
    - **Property 5: Startup configuration validation**
    - **Validates: Requirements 2.11, 2.12, 17.3, 19.5, 19.6, 19.7**

  - [x] 2.3 Implement redaction and JSON logging
    - `app/core/redaction.py` (`redact_url`, `redact`, `RedactionFilter`) and `app/core/logging.py` (JSON lines on stdout, `request_id` ContextVar, httpx and httpcore loggers held at WARNING, filter on the root handler).
    - _Requirements: 5.10, 17.5, 17.6, 19.5, 19.8_

  - [ ]* 2.4 Write property test for secret redaction
    - **Property 13: Secret redaction**
    - **Validates: Requirements 5.10, 17.5, 17.6**

  - [x] 2.5 Implement error hierarchy and Error_Envelope handlers
    - `app/core/errors.py` with `AppError` subclasses, the stable error codes (including `PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`), handlers for `AppError`, `RequestValidationError` (fields listed with reasons), `HTTPException`, `IntegrityError` (409 for unique, 422 for check and foreign key, constraint type only) and a catch-all 500 with no stack trace or SQL.
    - _Requirements: 1.5, 1.6, 16.6, 17.4_

  - [x] 2.6 Implement middleware and application factory
    - `app/api/middleware.py` with `RequestIdMiddleware` (pattern `^[A-Za-z0-9_-]{1,128}$`, otherwise generate a UUID4 hex, header on every response including errors) and `BodySizeLimitMiddleware` (413 before parsing, counts chunked bytes). `app/main.py` with `create_app()`, CORS from `ALLOWED_ORIGINS` (empty means no CORS headers), the `/api/v1` prefix, automatic router discovery, OpenAPI at `/api/v1/openapi.json`, and a lifespan that loads settings.
    - _Requirements: 1.1, 1.2, 1.3, 1.7, 1.8, 1.9, 1.12, 17.9, 19.8_

  - [ ]* 2.7 Write property test for request ID echo or generation
    - **Property 1: Request ID echo or generation**
    - **Validates: Requirements 1.7, 1.8, 1.9**

  - [ ]* 2.8 Write property test for request body limit
    - **Property 32: Request body limit**
    - **Validates: Requirements 17.9**

- [x] 3. Database models, migrations and audit service
  - [x] 3.1 Implement SQLAlchemy models and session management
    - `app/db/base.py` with the constraint naming convention, `app/db/session.py` (async engine, one session per request, rollback on error), and models for users, areas, observations, retrieval_records, reports, comparisons, app_settings and audit_events with all columns, check constraints, unique constraints, foreign keys and indexes from the design (GiST on `areas.geom`, partial unique indexes, UTC `timestamptz`).
    - _Requirements: 4.12, 16.1, 16.5, 16.7, 16.8, 16.10_

  - [x] 3.2 Create Alembic environment and migrations 0001 to 0005
    - Async `env.py` with `compare_type`, `compare_server_default` and an `include_object` hook that ignores `spatial_ref_sys`. Migrations: `0001_extensions_users` (PostGIS extension), `0002_areas`, `0003_retrievals_observations`, `0004_reports_comparisons`, `0005_settings_audit` (seed six settings, audit immutability trigger). Each downgrade drops only what its upgrade created.
    - _Requirements: 16.2, 16.4, 16.9, 18.5_

  - [x] 3.3 Create PostGIS test fixtures and reference data
    - `tests/integration/conftest.py` that creates a database, runs migrations, and gives a rolled-back session per test. Add the reference NDVI series (eight Sentinel-2 points), a small Ghana boundary fixture, and a fake JWT key fixture helper location in `tests/fixtures/`.
    - _Requirements: 22.2, 22.8_

  - [ ]* 3.4 Write PostGIS integration tests for migrations and constraints
    - Upgrade on an empty DB then downgrade, schema drift check via `compare_metadata`, down-one then up cycle that keeps earlier rows, GiST index presence, unique, foreign-key and check constraint rejections, and a spatial query fixture.
    - _Requirements: 16.3, 16.5, 16.6, 16.9, 22.2_

  - [x] 3.5 Implement the audit service
    - `app/services/audit.py` with `record(session, ...)` that writes in the caller's transaction, a helper that writes failure and denied events in a separate session with a 2 s timeout, and no credentials or bodies in `details`.
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

  - [ ]* 3.6 Write tests for audit atomicity and immutability
    - A forced audit failure rolls back the action and returns 500. The trigger rejects `UPDATE` and `DELETE`. Denied events are written even when the main transaction rolls back.
    - _Requirements: 18.3, 18.4, 18.5, 18.6_

- [x] 4. Health endpoints
  - [x] 4.1 Implement `/health/live` and `/health/ready`
    - `app/api/routers/health.py` mounted at the unversioned root. `ready` runs `SELECT 1` (2 s) and compares `alembic_version` to the script head under a 3 s limit, and returns 503 with only the failed check names. No provider calls. Add startup cleanup that expires `running` retrieval records older than 150 s.
    - _Requirements: 19.1, 19.2, 19.3, 19.4_

  - [ ]* 4.2 Write health endpoint tests
    - Database up, database down, migrations behind head, no secrets in the 503 body, no network calls.
    - _Requirements: 19.1, 19.2, 19.3, 19.4_

- [x] 5. Authentication, authorization and `/me`
  - [x] 5.1 Implement roles, principal and permissions module
    - `app/core/security.py` (`Role`, `Principal`, group-to-role mapping that ignores unknown groups) and `app/core/permissions.py` (the only place that spells permission strings, `REQUIRED_ROLE`, `permissions_for`).
    - _Requirements: 3.1, 3.4, 3.5, 15.2, 15.5_

  - [x]* 5.2 Write property test for group to role mapping
    - **Property 6: Group to role mapping**
    - **Validates: Requirements 3.1, 3.4, 3.5**

  - [x]* 5.3 Write property test for permission derivation
    - **Property 7: Permission derivation**
    - **Validates: Requirements 15.2, 15.3**

  - [x] 5.4 Implement JWKS cache and token validator
    - `app/integrations/cognito/jwks.py` (in-memory cache, `asyncio.Lock`, one refresh per 60 s, 5 s fetch timeout, fall back to cache on fetch failure, 503 when nothing is cached) and `validator.py` (RS256 only, signature, `exp`, `iss`, `client_id`, `token_use=access`; internal reason codes logged without the token).
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.10, 2.13_

  - [x]* 5.5 Write property test for token acceptance
    - **Property 4: Token acceptance**
    - **Validates: Requirements 2.1, 2.2, 2.10**

  - [x]* 5.6 Write authentication unit tests with locally generated keys
    - Valid, expired, wrong issuer, wrong client, ID token, bad signature, unknown `kid`, missing header. JWKS refresh limited to once per 60 s using a fake clock, cache fallback, and 503 with no cache.
    - _Requirements: 2.2, 2.3, 2.5, 2.6, 2.7, 22.4_

  - [x] 5.7 Implement auth dependencies and authorization guard
    - `app/api/deps.py` with `get_session`, `get_principal` (validate, map roles, concurrency-safe `INSERT ... ON CONFLICT` user upsert, update `last_seen_at`), `guard(permission)` with `required_role` metadata and a denied Audit_Event on 403 that never changes the 403 outcome, plus pagination params (`limit` 1 to 200, `offset` at least 0).
    - _Requirements: 1.10, 1.11, 2.8, 2.9, 3.2, 3.3, 3.6, 3.7, 3.8_

  - [x] 5.8 Implement `GET /api/v1/me`
    - `app/api/routers/me.py` returning `sub`, username, email (or null), roles and permissions, with 401 and no user data on invalid tokens, and 200 with empty lists for users with no role.
    - _Requirements: 3.5, 15.1, 15.2, 15.3, 15.4, 15.6_

  - [x]* 5.9 Write tests for the guard and `/me`
    - 403 for insufficient role and for no group, admin satisfies researcher, denied Audit_Event written, 403 still returned when the audit write fails, first-seen `sub` creates exactly one user row under concurrent requests, `/me` for no role and missing email.
    - _Requirements: 2.9, 3.3, 3.5, 3.7, 3.8, 15.1, 15.3, 15.4, 15.6_

- [x] 6. AgroMonitoring client
  - [x] 6.1 Implement provider models and normalisation
    - `app/integrations/agro/models.py` and `normalize.py`: map `type` to source, `dt` to UTC date, `cl`, `dc` (absent stays `None`, never `100 - cl`), NDVI stats, strip `appid` from preview URLs, discard invalid items with a per-item warning log, and keep the lower-cloud item for duplicate `(source, date)`.
    - _Requirements: 5.7, 5.8, 5.9_

  - [x]* 6.2 Write property test for provider item normalisation
    - **Property 12: Provider item normalisation**
    - **Validates: Requirements 5.7, 5.8, 5.9**

  - [x] 6.3 Implement the HTTP transport and Agro client
    - `ratelimit.py` (semaphore plus token bucket), `transport.py` (shared `httpx.AsyncClient`, connect and read timeouts, key added in one place), `client.py` implementing the `AgroClient` protocol (`create_polygon`, `delete_polygon`, `ndvi_history`, `image_search`, `fetch_image`, `probe`, `AGRO_STATS_MODE=per_image` fallback). Retry on 429, 502, 503, 504 and timeouts up to 3 times with the specified backoff, jitter and capped `Retry-After`. Other 4xx raise immediately. Errors carry no upstream body or URL. Injected sleep for tests.
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 5.10, 5.11, 5.13, 23.4_

  - [x]* 6.4 Write property test for retry wait schedule
    - **Property 11: Retry wait schedule**
    - **Validates: Requirements 5.4**

  - [x]* 6.5 Write mocked HTTPX transport tests for the Agro client
    - Success, timeout, 429 with `Retry-After` (assert wait through injected sleep), 5xx stopping after 4 attempts, a non-429 4xx making exactly one request, malformed payloads handled, empty results, no key in errors or logs.
    - _Requirements: 5.4, 5.5, 5.6, 5.8, 5.10, 22.3_

- [x] 7. Geometry and monitoring areas
  - [x] 7.1 Implement geometry validation and bbox parsing
    - `app/domain/geometry.py` with `validate_geometry` (type, coordinate range, ring length and closure, validity, Ghana containment, in that order, never raising other exceptions), inclusive area range check, and `parse_bbox` / `format_bbox`.
    - _Requirements: 4.2, 4.3, 4.5, 4.9, 4.10_

  - [x]* 7.2 Write property test for geometry validation
    - **Property 8: Geometry validation is total and correct**
    - **Validates: Requirements 4.2, 4.3, 22.6, 22.9**

  - [x]* 7.3 Write property test for inclusive area range
    - **Property 9: Area range is inclusive**
    - **Validates: Requirements 4.5**

  - [x]* 7.4 Write property test for bounding box parsing
    - **Property 10: Bounding box parsing**
    - **Validates: Requirements 4.9, 4.10**

  - [x]* 7.5 Write geospatial unit tests
    - Invalid rings, self-intersection, outside Ghana, areas just below, at and above the limits, and a reference polygon whose computed area is within 1% of the known value.
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 22.6_

  - [x] 7.6 Implement Ghana boundary loader
    - Load `GHANA_BOUNDARY_PATH` with GeoPandas at startup into a Shapely prepared geometry, stop startup when the file is missing or invalid, and expose it through the application state. Document that the owner supplies `data/ghana_boundary.geojson`.
    - _Requirements: 4.3_

  - [x] 7.7 Implement the area service
    - `app/services/areas.py`: create (validate, PostGIS `ST_Area` on geography rounded to 2 decimals, duplicate name check, `create_polygon` within 10 s, insert plus Audit_Event in one transaction, best-effort provider polygon delete on insert failure), update with geometry replacement (new polygon, mark observations `stale_geometry`, delete old polygon after commit), archive, restore with name clash check, list with `status`, `q`, `bbox` (GiST `ST_Intersects`), detail, and map FeatureCollection with latest observation date.
    - _Requirements: 4.1, 4.4, 4.6, 4.7, 4.8, 4.9, 4.11, 4.13, 13.9, 13.10, 18.1_

  - [x] 7.8 Implement area routers
    - `app/api/routers/areas.py` (`GET /areas`, `GET /areas/map`, `GET /areas/{area_id}`) and `admin_areas.py` (`POST /admin/areas`, `PATCH /admin/areas/{area_id}`, archive, restore), all guarded, with Pydantic schemas using `extra="forbid"`.
    - _Requirements: 4.1, 4.8, 4.9, 4.10, 4.11, 13.9, 15.5_

  - [x]* 7.9 Write PostGIS integration tests for areas
    - Create, duplicate name 409, outside Ghana, area out of range, provider failure stores nothing, geometry update marks observations stale, archive hides from default list, bbox filter and map output, spatial index used for the fixture.
    - _Requirements: 4.1, 4.3, 4.5, 4.7, 4.8, 4.9, 4.11, 4.13, 13.10, 22.2_

  - [x]* 7.10 Write property test for pagination envelope
    - **Property 2: Pagination envelope**
    - **Validates: Requirements 1.10, 1.11**

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Application settings
  - [x] 9.1 Implement the settings service and endpoints
    - `app/services/settings.py` and routers `settings.py` (`GET /settings` with the five Researcher-visible keys including `gap_threshold_days`) and `admin_settings.py` (`GET /admin/settings`, `PUT /admin/settings/{key}`). Allow-list of six keys with type and range checks, secret-like key rejection checked first (422), unknown key 404, audit with old and new values in the same transaction, rollback if the audit fails, defaults read on every request.
    - _Requirements: 8.8, 8.9, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10_

  - [x]* 9.2 Write property test for settings and override validation
    - **Property 27: Settings and override validation**
    - **Validates: Requirements 8.8, 8.9, 8.10, 8.11, 14.3, 14.5, 14.6**

  - [x]* 9.3 Write settings tests
    - Researcher sees only permitted keys and no `updated_by`, Researcher update is 403, audit failure rolls back the change, unknown key and secret-like key responses.
    - _Requirements: 14.2, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10_

- [x] 10. Quality indicators, observations and refresh
  - [x] 10.1 Implement the quality domain
    - `app/domain/quality.py` with `quality_level`, `observation_quality` and `comparison_quality` (worse level, larger cloud, smaller non-null data coverage, `LOW_QUALITY_OBSERVATION`), and `app/domain/constants.py` warning codes.
    - _Requirements: 8.12, 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x]* 10.2 Write property test for quality level
    - **Property 18: Quality level**
    - **Validates: Requirements 8.12, 9.1, 9.2, 9.3, 9.4**

  - [x] 10.3 Implement observation service and schemas
    - `app/services/observations.py` and schemas: list with `source`, `date_from`, `date_to`, `max_cloud_coverage`, `min_data_coverage` (AND, inclusive, null data coverage never matches the minimum filter), ordered by date descending, detail by ID, quality computed on read from current settings, `Preview` object with proxy URL, `resolution_class` in `meta`, grouping by source, 404 and 422 rules.
    - _Requirements: 6.3, 6.6, 6.7, 6.8, 6.9, 6.10, 6.14, 9.6, 9.7_

  - [x] 10.4 Implement the refresh service
    - `app/services/refresh.py`: validate range (start not after end, at most 366 days, not future), insert a `running` record in its own transaction (409 on the partial unique index), per-source transactions with `INSERT ... ON CONFLICT DO UPDATE ... WHERE differs` and `xmax = 0` classification, `partial` / `empty` / `failed` / `success` statuses, 120 s `asyncio.timeout` returning 504, stale `running` expiry (150 s), sanitised error and 64 KB raw payload rule, and an Audit_Event. No image binaries stored.
    - _Requirements: 5.12, 6.1, 6.2, 6.4, 6.5, 6.12, 6.13, 6.14, 6.15, 6.16, 16.7, 16.8, 18.1, 23.5_

  - [x] 10.5 Implement observation and refresh routers
    - `app/api/routers/observations.py` with `GET /areas/{area_id}/observations`, `GET /observations/{observation_id}` and `POST /areas/{area_id}/observations/refresh` (Researcher or Admin), including warnings in the refresh response.
    - _Requirements: 6.1, 6.6, 6.9, 6.10, 6.12, 6.13_

  - [x] 10.6 Implement the preview image proxy
    - Add `GET /observations/{observation_id}/preview` to `observations.py`: authorize first (no provider contact on denial), fetch with the key server-side through `fetch_image`, read PNG IHDR for width and height and store them on first fetch, return bytes with `Cache-Control: private, max-age=3600`, 404 when no preview, and a statement that previews are for visual orientation only.
    - _Requirements: 6.11, 17.6, 17.7, 17.8_

  - [x]* 10.7 Write property test for observation list filtering
    - **Property 16: Observation list filtering**
    - **Validates: Requirements 6.6, 6.7**

  - [x]* 10.8 Write property test for refresh counts and idempotence
    - **Property 14: Refresh counts and idempotence**
    - **Validates: Requirements 6.1, 6.4, 22.9**

  - [x]* 10.9 Write property test for refresh range validation
    - **Property 15: Refresh range validation**
    - **Validates: Requirements 6.2**

  - [x]* 10.10 Write refresh and proxy integration tests
    - Partial success keeps stored sources, total failure leaves data unchanged, empty result records `empty`, concurrent refresh returns 409, 120 s deadline returns 504 with earlier data intact, stale `running` record expiry, preview proxy denies before contacting the provider, no key in responses.
    - _Requirements: 6.12, 6.13, 6.15, 6.16, 17.7, 17.8, 23.5_

- [ ] 11. NDVI time series
  - [ ] 11.1 Implement the time-series domain
    - `app/domain/timeseries.py`: `build_series` (sort, cloud filter, `excluded_by_cloud`, gaps, `IRREGULAR_SAMPLING` when a gap exceeds the threshold, `INSUFFICIENT_OBSERVATIONS`), summary with 4-decimal rounding, and `trend_per_30d` as the OLS slope times 30.
    - _Requirements: 7.1, 7.6, 7.8, 7.9, 7.10, 7.11, 7.12_

  - [ ]* 11.2 Write property test for series selection and ordering
    - **Property 19: Series selection and ordering**
    - **Validates: Requirements 7.1, 7.6, 7.12**

  - [ ]* 11.3 Write property test for gaps and irregular sampling
    - **Property 20: Gaps and irregular sampling**
    - **Validates: Requirements 7.9, 7.10**

  - [ ]* 11.4 Write property test for series summary and trend
    - **Property 21: Series summary and trend**
    - **Validates: Requirements 7.8, 7.11**

  - [ ] 11.5 Implement the time-series service and endpoint
    - `app/services/timeseries.py` and `app/api/routers/timeseries.py` for `GET /areas/{area_id}/ndvi/timeseries`: validate `source` (required), date span (at most 3660 days), `max_cloud_coverage`, 404 for a missing area, read only stored data (no provider call), always return the three limitations and `meta`. `include_weather` returns `weather: null` with `WEATHER_DISABLED` until task 13.3 wires the provider.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.12, 7.16, 9.7, 23.3_

  - [ ]* 11.6 Write time-series reference tests
    - The eight reference points come back in ascending order with exact 4-decimal means and the expected summary, one-point and zero-point series, gap warning at 30 versus 31 days, and reads succeed with the provider mock set to fail.
    - _Requirements: 7.8, 7.10, 7.15, 7.16, 22.8_

- [ ] 12. Comparisons
  - [ ] 12.1 Implement the comparison domain and constants
    - `app/domain/comparison.py` with `compare` (`ndvi_diff = b - a` rounded to 4 decimals, percent relative to `date_a` rounded to 2 decimals or `None` with `PERCENT_DIFFERENCE_UNDEFINED`, absolute interval days, flag with `>=` on the unrounded difference), the seasonality rule (`k >= 1` and `abs(interval - 365k) <= 15`), cross-sensor refusal, fixed summary templates, and `constants.py` with `LIMITATIONS`, `CAVEATS`, `FORBIDDEN_TERMS` and `spatial_analysis_available = False`.
    - _Requirements: 8.1, 8.2, 8.3, 8.7, 8.13, 8.14, 8.15, 8.19, 21.1, 21.2, 21.5_

  - [ ]* 12.2 Write property test for comparison arithmetic and symmetry
    - **Property 22: Comparison arithmetic and symmetry**
    - **Validates: Requirements 8.1, 8.2, 8.18, 8.19, 22.9**

  - [ ]* 12.3 Write property test for flag threshold
    - **Property 23: Flag threshold**
    - **Validates: Requirements 8.7**

  - [ ]* 12.4 Write property test for seasonality warning
    - **Property 24: Seasonality warning**
    - **Validates: Requirements 8.13**

  - [ ]* 12.5 Write property test for neutral wording and no spatial claim
    - **Property 26: Neutral wording and no spatial claim**
    - **Validates: Requirements 8.14, 8.15, 21.1, 21.2, 21.5**

  - [ ] 12.6 Implement the comparison service and endpoint
    - `app/services/comparisons.py` and `app/api/routers/comparisons.py` for `POST /areas/{area_id}/comparisons`: check order (equal dates 422 first, then missing observation 404 naming the date, then cross-sensor), request threshold overrides validated against ranges and echoed in `thresholds_applied` without changing stored settings, quality and warnings, `spatial_analysis_available: false`, `weather: null` with `WEATHER_DISABLED` until task 13.3.
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6, 8.8, 8.10, 8.11, 8.12, 8.13, 8.14, 21.2_

  - [ ]* 12.7 Write comparison tests and cross-sensor property test
    - **Property 25: Cross-sensor and equal-date refusal**
    - **Validates: Requirements 8.3, 8.4, 8.6**
    - Also unit tests with the reference series: pair (2026-03-06, 2026-04-30), sign flip when swapped, zero mean percent handling, override out of range 422, equal dates beat missing observation.
    - _Requirements: 8.1, 8.2, 8.5, 8.6, 8.11, 22.8_

- [ ] 13. Weather provider (disabled by default)
  - [ ] 13.1 Implement weather provider interface and implementations
    - `app/integrations/weather/base.py` (`WeatherProvider` protocol, `WeatherBatch`), `null.py` (default, `WEATHER_PROVIDER=none`), `agro_weather.py` (candidate provider, reuses `HttpTransport`, Kelvin to °C, precipitation in mm, unconvertible values discarded, chunking by `WEATHER_MAX_RANGE_DAYS`). Missing key or base URL means not configured and does not stop startup.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ]* 13.2 Write property test for weather normalisation
    - **Property 28: Weather normalisation**
    - **Validates: Requirements 10.5, 10.6**

  - [ ] 13.3 Implement weather service and wire into series and comparisons
    - `app/services/weather.py`: `WEATHER_DISABLED` when not configured or `weather_enabled` is false, point on surface for lat/lon, 10 s timeout, `WEATHER_UNAVAILABLE` on failure, `WEATHER_INVALID_DATA` on discarded values, provider name, period and the correlation note on every context, Retrieval_Record per call, no correlation computed. Wire it into `timeseries.py` and `comparisons.py` services (points, and `a`, `b`, `between`).
    - _Requirements: 7.13, 7.14, 8.16, 8.17, 10.6, 10.7, 10.8, 10.9, 10.10_

  - [ ]* 13.4 Write weather tests
    - Disabled, unconfigured, provider failure leaves NDVI values and summary unchanged, invalid values produce the warning, timeout at 10 s, context labels present.
    - _Requirements: 7.14, 8.17, 10.2, 10.7, 10.8, 10.9_

- [ ] 14. Reports
  - [ ] 14.1 Implement the report service
    - `app/services/reports.py`: validate request (source, `date_from <= date_to`, span at most 1826 days), `NO_OBSERVATIONS` 422, build the JSON snapshot (area, geometry, observations with quality, summary, selected comparisons through `compare`, thresholds applied, optional weather, fixed `CAVEATS` and `LIMITATIONS`), insert `reports`, `comparisons` copies and the Audit_Event in one transaction, retrieval reads only the stored `content`, listing scoped to the creator for Researchers, identical 404 for missing and foreign reports, PDF returns 501, unsupported `format` returns 422.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.7, 11.8, 11.9, 11.10, 11.12, 18.1_

  - [ ] 14.2 Implement report router
    - `app/api/routers/reports.py` with `POST /reports` (201), `GET /reports` (`area_id`, admin-only `created_by`, pagination) and `GET /reports/{report_id}` (`format=json|pdf`).
    - _Requirements: 11.1, 11.5, 11.8, 11.9, 11.10, 11.12_

  - [ ]* 14.3 Write property test for report content and snapshot
    - **Property 29: Report content and snapshot**
    - **Validates: Requirements 11.2, 11.3, 11.4**

  - [ ]* 14.4 Write property test for report visibility
    - **Property 30: Report visibility**
    - **Validates: Requirements 11.9, 11.10**

  - [ ]* 14.5 Write property test that sources are never mixed
    - **Property 17: Sources are never mixed**
    - **Validates: Requirements 6.14, 7.3, 9.6**

  - [ ]* 14.6 Write report unit and integration tests
    - Caveats text identical across reports, `NO_OBSERVATIONS` stores nothing, span over 5 years rejected, PDF returns 501 and JSON still works, a report keeps its content after a later refresh and area edit.
    - _Requirements: 11.3, 11.4, 11.7, 11.8, 11.12_

- [ ] 15. Admin: users, roles, operations
  - [ ] 15.1 Implement Cognito admin client and user administration service
    - `app/integrations/cognito/admin.py` (`CognitoAdmin` protocol, boto3 `cognito-idp` group calls only, worker thread, 10 s timeout, never creates or changes pools, clients, groups or users) and `app/services/users.py`: list and get with page size default 50 and max 100, role change with order of checks (501 when `COGNITO_ADMIN_ENABLED` is false or access denied, 404 unknown user, 409 `SELF_ROLE_CHANGE`, 409 `LAST_ADMIN`), local roles updated only after Cognito succeeds, success and failure Audit_Events, response with `effective_after_next_login: true` and a message.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 20.14_

  - [ ]* 15.2 Write property test for admin count never reaching zero
    - **Property 31: Admin count never reaches zero**
    - **Validates: Requirements 12.6, 12.7**

  - [ ] 15.3 Implement user admin routers
    - `app/api/routers/admin_users.py` with `GET /admin/users`, `GET /admin/users/{sub}` and `PUT /admin/users/{sub}/roles`. Request models reject extra fields, and no user-creation endpoint exists.
    - _Requirements: 12.1, 12.2, 12.8, 12.9_

  - [ ] 15.4 Implement admin operations service and routers
    - `app/services/admin_ops.py` and `app/api/routers/admin_ops.py`: `GET /admin/retrievals` (filters, default 25, max 100, 422 on bad values), `GET /admin/integrations/status` (`probe=true` makes one call per provider with a 10 s timeout, writes a `probe` record, never exposes keys), `GET /admin/activity` (filters, same paging), `GET /admin/dashboard` (areas, observations, reports, users by role, retrievals by status over 168 hours).
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_

  - [ ]* 15.5 Write admin tests
    - Role change with a fake `CognitoAdmin`: success, failure, timeout, not enabled, last admin, self change, audit events for each. Researcher gets 403 on every admin route. Retrieval and activity filters, probe failure still returns status and counts toward failures, no key material in the integration response, dashboard counts.
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 13.1, 13.2, 13.4, 13.5, 13.6, 13.8_

- [ ] 16. Cross-cutting verification and documentation
  - [ ]* 16.1 Write the authorization matrix test
    - Walk `app.routes`, call every non-health endpoint with no token, a Researcher token and an Admin token, assert the documented status for each, and fail if a route is missing from the matrix or lacks a guard.
    - _Requirements: 3.2, 3.3, 22.5_

  - [ ]* 16.2 Write error-handling and secret-leak tests
    - **Property 3: Error envelope shape and secrecy**
    - **Validates: Requirements 1.5, 1.6, 12.9, 17.4, 22.7**
    - Also example tests for the envelope shape for validation, authentication, authorization, not-found, upstream and unexpected errors, and a scan of bodies, headers and captured logs for configured secrets.
    - _Requirements: 1.5, 1.6, 17.3, 17.4, 17.5, 22.7_

  - [ ]* 16.3 Write OpenAPI check and performance and Compose smoke scripts
    - A test that OpenAPI lists every contract endpoint. `scripts/perf_check.py` seeds 500 observations and 1000 areas and reports p95 for area reads, map data and a 100-observation report, also with the provider mock failing. `scripts/compose_smoke.sh` checks healthy within 120 s, startup failure on a missing variable, and ports bound to `127.0.0.1`.
    - _Requirements: 1.2, 11.11, 20.4, 20.11, 20.15, 23.1, 23.2, 23.3_

  - [ ] 16.4 Write README documentation
    - Commands for start, stop, rebuild, logs, PostgreSQL shell, manual migrations and running `make test` in the container. Cognito local-dev configuration (callback and logout URLs, allowed origins, app client settings, group names, token variables, example values), first-Admin provisioning through the console or CLI with a note that no API route grants `admin`, and the open provider items from the design.
    - _Requirements: 20.10, 20.12, 20.13_

- [ ] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Each task references specific requirements for traceability.
- Each property test is its own sub-task, carries the property number, and runs at least 100 Hypothesis examples with a `# Feature: eco-sentinel-backend, Property N` tag comment.
- Property 25 and Property 3 are bundled with their example tests in 12.7 and 16.2 because they share fixtures.
- Tests make no outbound network calls and use no real credentials.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.3"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.5"] },
    { "id": 3, "tasks": ["2.6", "3.1"] },
    { "id": 4, "tasks": ["2.7", "2.8", "3.2", "3.5", "5.1", "6.1", "7.1"] },
    { "id": 5, "tasks": ["3.3", "4.1", "5.2", "5.3", "5.4", "6.2", "6.3", "7.2", "7.3", "7.4", "7.6", "10.1"] },
    { "id": 6, "tasks": ["3.4", "3.6", "4.2", "5.5", "5.6", "5.7", "6.4", "6.5", "7.5", "10.2", "11.1", "12.1", "13.1"] },
    { "id": 7, "tasks": ["5.8", "5.9", "7.7", "9.1", "11.2", "11.3", "11.4", "12.2", "12.3", "12.4", "12.5", "13.2"] },
    { "id": 8, "tasks": ["7.8", "9.2", "9.3", "10.3"] },
    { "id": 9, "tasks": ["7.9", "7.10", "10.4", "10.7", "11.5", "12.6", "15.1"] },
    { "id": 10, "tasks": ["10.5", "10.8", "10.9", "11.6", "12.7", "13.3", "15.2", "15.3", "15.4"] },
    { "id": 11, "tasks": ["10.6", "13.4", "14.1", "15.5"] },
    { "id": 12, "tasks": ["10.10", "14.2", "14.3", "14.4", "14.5"] },
    { "id": 13, "tasks": ["14.6", "16.1", "16.2", "16.3", "16.4"] }
  ]
}
```
