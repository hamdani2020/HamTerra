# Eco Sentinel

[![Backend CI](https://github.com/hamdani2020/HamTerra/actions/workflows/backend.yml/badge.svg?branch=main)](https://github.com/hamdani2020/HamTerra/actions/workflows/backend.yml)
[![Frontend CI](https://github.com/hamdani2020/HamTerra/actions/workflows/frontend.yml/badge.svg?branch=main)](https://github.com/hamdani2020/HamTerra/actions/workflows/frontend.yml)

Eco Sentinel is a web platform for monitoring vegetation change (NDVI from Sentinel-2 and Landsat 8) over registered areas in Ghana. The frontend is a React single-page application; the backend is a FastAPI service backed by PostgreSQL/PostGIS. The backend validates AWS Cognito access tokens and enforces the `admin` and `researcher` roles. It presents numeric evidence and flags differences for investigation. It never classifies a change or states its cause.

Specs live in `.kiro/specs/` (`eco-sentinel-backend`, `eco-sentinel-frontend`, `eco-sentinel-infrastructure`).

## Status

| Part | State |
|---|---|
| Backend (`backend/`): API under `/api/v1`, migrations, tests | Implemented (backend spec tasks 1 to 17) |
| `docker-compose.yml` (PostGIS, backend, pgAdmin, frontend) | Exists |
| `.env.example` | Exists, placeholders only |
| Ghana boundary file | Supplied by the project owner (see Configuration) |
| Frontend (`frontend/`): React SPA, Cognito sign-in, researcher and admin pages, tests | Implemented (frontend spec tasks 1 to 24) |
| Terraform (`infra/terraform/`) | Cognito configuration, see `infra/terraform/README.md` |

## Prerequisites

- Docker with Compose v2
- [uv](https://docs.astral.sh/uv/) and Python 3.12 (for running tooling outside the container)
- An AWS account for Cognito (see [Cognito local development](#cognito-local-development))
- An AgroMonitoring API key

## Quick start

```sh
cp .env.example .env     # then replace every placeholder
docker compose up -d
```

Then open `http://localhost:5173` and sign in. The frontend needs the Cognito settings described in [Cognito local development](#cognito-local-development). To run without the frontend: `docker compose up -d postgis backend pgadmin`.

All published ports bind to `127.0.0.1` by default (`BIND_ADDRESS`). Default ports: backend 8000, frontend 5173, PostgreSQL 5432, pgAdmin 5050.

## Configuration

`docker-compose.yml` refuses to start if any of these are missing from `.env`:

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `PGADMIN_DEFAULT_EMAIL`, `PGADMIN_DEFAULT_PASSWORD`, `COGNITO_USER_POOL_ID`, `COGNITO_REGION`, `COGNITO_APP_CLIENT_ID`, `AGRO_API_KEY`.

The backend also requires `GHANA_BOUNDARY_PATH`, the path to a GeoJSON Polygon or MultiPolygon of Ghana (EPSG:4326). The project owner supplies it as `backend/data/ghana_boundary.geojson` (for example the geoBoundaries ADM0 file for Ghana, public domain). The backend refuses to start when the file is missing or unusable. The boundary is used to check that monitoring areas lie inside Ghana. A coarse boundary is acceptable for the MVP, so an area very close to the border can be accepted slightly beyond it. The full variable list and defaults are in the Settings table of `.kiro/specs/eco-sentinel-backend/design.md`. `.env` is git-ignored. Never commit real secrets or paste them into issues or logs.

## Developer commands

Run from the repository root.

| Task | Command |
|---|---|
| Start (without the frontend) | `docker compose up -d postgis backend pgadmin` |
| Start everything | `docker compose up -d` |
| Stop | `docker compose down` (add `-v` only to delete data) |
| Rebuild | `docker compose build <service> && docker compose up -d <service>` (`backend` or `frontend`) |
| Logs | `docker compose logs -f <service>` |
| Status and health | `docker compose ps` |
| PostgreSQL shell | `docker compose exec postgis psql -U $POSTGRES_USER -d $POSTGRES_DB` |
| Migrations manually | `docker compose exec backend alembic upgrade head` (or `downgrade -1`) |
| Backend tests in the container | `docker compose exec backend make test` |
| Frontend tests, once | `docker compose exec frontend npm run test -- --run` |
| Frontend lint and types | `docker compose exec frontend npm run check` |
| Frontend production build | `docker compose exec frontend npm run build` (also runs the chunk check) |
| Performance check | `docker compose exec backend python scripts/perf_check.py` |
| Compose smoke check | `sh backend/scripts/compose_smoke.sh` (on the host) |

`make test` runs `ruff check`, `ruff format --check`, `mypy --strict app` and `pytest`, and exits non-zero if any step fails. Migrations run automatically on backend start; set `MIGRATE_ON_START=false` to skip them.

**Tests.** The suite makes no outbound network calls (pytest-socket allows only the `postgis` host) and uses no real credentials: provider clients are mocked and JWTs are signed with keys generated per run. In the backend container the PostGIS integration tests use a separate database, `eco_test`, on the Compose PostgreSQL server; it is created on first use and the application database is never touched. Set `TEST_DATABASE_URL` to use a different test database. Without a reachable database the integration tests are skipped with a message. Audit rows written by tests stay in `eco_test` because that table is append-only.

The image built before this change has no `make`. After pulling it, rebuild once: `docker compose build backend && docker compose up -d backend`.

**Performance check.** `scripts/perf_check.py` seeds 1000 areas and 500 observations into `eco_test`, measures p95 latency in-process (no network hop) for area reads, map data and report generation, with the provider mock working and failing, then removes the seeded rows. It exits non-zero when a limit (500 ms, 1000 ms, 10 s) is exceeded.

**Compose smoke check.** `backend/scripts/compose_smoke.sh` checks that a missing `AGRO_API_KEY` stops Compose with an error naming it, that the backend reports healthy within 120 s, and that published ports bind to `127.0.0.1`. It starts the stack if it is not running and never removes volumes.

## Frontend

The frontend container runs the Vite dev server with hot reload on port 5173 (`FRONTEND_PORT`), with `frontend/` bind-mounted. It reads only public `VITE_` values from the root `.env`; it never receives a provider key or a client secret.

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Backend API base, ending in `/api/v1` (for example `http://localhost:8000/api/v1`) |
| `VITE_COGNITO_DOMAIN` | Cognito domain URL, `https://<prefix>.auth.<region>.amazoncognito.com` |
| `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_REGION` | The public app client and its region |
| `VITE_REDIRECT_URI` | `http://localhost:5173/auth/callback` |
| `VITE_LOGOUT_URI` | `http://localhost:5173/signed-out` |
| `VITE_BASEMAP_TILE_URL` | Optional. Raster tile template; defaults to OpenStreetMap |
| `VITE_USE_POLLING` | `true` makes the dev server poll for file changes. Use it when edits on the host do not reload the page (common with Docker Desktop bind mounts on macOS and Windows). |

The dev server and `npm run build` refuse to start when a required `VITE_` value is missing. If a value is present but invalid (for example not an absolute URL), the app shows a configuration error page and sends no request. `CHOKIDAR_USEPOLLING` is ignored; set `VITE_USE_POLLING` instead.

**Tests.** `npm run test -- --run` runs Vitest once (no watch mode). The tests make no network calls: MSW answers every Backend and Cognito request from the contract fixtures and fails any request it does not handle. MapLibre is mocked. `npm run check` runs ESLint and `tsc --noEmit`. `npm run build` fails if the admin pages and the map stop being separate lazy chunks.

**Basemap.** The map uses OpenStreetMap raster tiles by default, with attribution. The [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) allows light use such as a small research team and forbids heavy or bulk use. For wider use, point `VITE_BASEMAP_TILE_URL` at another keyless tile server or a self-hosted one. If tiles fail to load for 10 seconds, the map falls back to a plain background and says so.

## Continuous integration

GitHub Actions runs two workflows on pushes to `main` and on pull requests, each only when its part of the repository changes. Both have read-only repository permissions, pin every action to a commit SHA, and collect no test coverage.

| Workflow | Runs | Steps |
|---|---|---|
| `.github/workflows/backend.yml` | `backend/**` changes | `uv sync --frozen`, `ruff check`, `ruff format --check`, `mypy --strict .`, `pytest` against a PostGIS service container (hostname `postgis`, throwaway CI credentials), evidence-language scan |
| `.github/workflows/frontend.yml` | `frontend/**` changes | `npm ci`, `npm run check` (ESLint and `tsc`), `npm run test -- --run`, `npm run build` with placeholder public values (includes the chunk check), evidence-language scan |

Neither workflow needs a repository secret: the tests use dummy credentials and make no outbound calls.

## Cognito local development

Create the Cognito resources by hand in the AWS console, or use Terraform (see below). The backend never creates or changes pools, clients, groups or users.

| Item | Value (example) |
|---|---|
| User pool | One pool, sign-in by email or username |
| App client | Public client, no client secret, Authorization code grant (PKCE), scopes `openid` `email` `profile` |
| Managed login | A managed login style (or the classic Hosted UI) must be assigned to the app client; without one, `/login` answers 403 |
| Callback URL | `http://localhost:5173/auth/callback` |
| Sign-out URLs | Register both `http://localhost:5173/signed-out` (used by the frontend) and `http://localhost:5173/` (the backend design's example). Cognito rejects a `logout_uri` that is not registered. |
| Allowed origin | `http://localhost:5173`, also in the backend `ALLOWED_ORIGINS` |
| Groups | `admin` and `researcher` (lowercase, case-sensitive) |
| Backend variables | `COGNITO_REGION=eu-west-1`, `COGNITO_USER_POOL_ID=eu-west-1_EXAMPLE`, `COGNITO_APP_CLIENT_ID=exampleclientid1234567890` |
| Tokens | The frontend sends the **access token**. ID tokens are rejected (`token_use` must be `access`). |
| Group claim | `cognito:groups` appears in the access token. Group changes show up only in tokens issued after the change, so the user must sign out and sign in again before the new role applies. |
| Frontend variables | `VITE_COGNITO_DOMAIN`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_REGION`, `VITE_REDIRECT_URI`, `VITE_LOGOUT_URI` (see [Frontend](#frontend)) |

The example values above are placeholders, not real resources.

### First Admin

No API route grants `admin`. An existing Cognito administrator adds the first Admin, in the console (User pool, Groups, `admin`, Add user to group) or with the CLI:

```sh
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <POOL_ID> --username <USERNAME> --group-name admin
```

After that, an Admin can change roles on the Users admin page (`PUT /admin/users/{sub}/roles`) only when `COGNITO_ADMIN_ENABLED=true` and the AWS identity behind `AWS_*` may call `cognito-idp:AdminAddUserToGroup`, `AdminRemoveUserFromGroup` and `AdminListGroupsForUser`. Otherwise the endpoint returns 501 `COGNITO_ADMIN_NOT_ENABLED`, and the page explains how to change the group in the console. These IAM permissions are assumed, not verified.

### Terraform alternative

[`infra/terraform/README.md`](infra/terraform/README.md) describes creating the Cognito resources with Terraform instead of the manual console steps (spec: `.kiro/specs/eco-sentinel-infrastructure`).

## Open provider items

Still to validate against the owner's accounts (backend `design.md`, "Open Items to Validate Against the Owner's Account"):

1. Real AgroMonitoring `ndvi/history` and `image/search` responses (field names, the `type` parameter, `dc` presence, MultiPolygon registration, the polygon delete call).
2. Provider rate limit, polygon count and area totals, and history depth of the plan.
3. A downloaded GeoTIFF and tile sample (pixel size, CRS, licence).
4. Weather provider choice, endpoints, fields, units and limits. Until then `WEATHER_PROVIDER=none`, and weather requests return `WEATHER_DISABLED`.
5. IAM permissions for Cognito group changes, and whether the frontend shows the email from the ID token (access tokens usually carry no `email`).
6. The rain field of the AgroMonitoring weather history response (the candidate provider uses `rain["1h"]` only).

## Layout

```
.
├── docker-compose.yml        PostGIS, backend, frontend, pgAdmin
├── .env                      local configuration (git-ignored)
├── backend/
│   ├── Dockerfile            base / dev / prod targets
│   ├── entrypoint.sh         runs `alembic upgrade head`, then execs the command
│   ├── Makefile              lint, format-check, typecheck, unit, test
│   ├── pyproject.toml, uv.lock
│   ├── app/                  api, core, db, domain, integrations, services
│   ├── data/                 ghana_boundary.geojson (supplied by the owner)
│   ├── scripts/              perf_check.py, compose_smoke.sh
│   └── tests/                unit, api, integration, properties
├── frontend/
│   ├── Dockerfile            Node 22 dev server
│   ├── package.json, package-lock.json (exact versions)
│   ├── config/               build-time checks (required env, chunk split)
│   ├── src/                  core (config, auth, api), features, pages, components, lib
│   └── tests/                unit, properties, components, integration, a11y, scan, msw
└── .kiro/specs/              requirements, design and tasks for each spec
```

To run the checks outside Docker: `cd backend && uv sync && make test`.
