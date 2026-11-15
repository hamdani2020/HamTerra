# Eco Sentinel

Eco Sentinel is a web platform for monitoring vegetation change (NDVI from Sentinel-2 and Landsat 8) over registered areas in Ghana. The backend is a FastAPI service backed by PostgreSQL/PostGIS. It validates AWS Cognito access tokens and enforces the `admin` and `researcher` roles. It presents numeric evidence and flags differences for investigation. It never classifies a change or states its cause.

Specs live in `.kiro/specs/` (`eco-sentinel-backend`, `eco-sentinel-frontend`, `eco-sentinel-infrastructure`).

## Status

| Part | State |
|---|---|
| Backend (`backend/`): API under `/api/v1`, migrations, tests | Implemented (backend spec tasks 1 to 17) |
| `docker-compose.yml` (PostGIS, backend, pgAdmin, frontend) | Exists. The `frontend` service has no build context until the frontend spec is implemented, so start the stack without it (see Developer commands). |
| `.env.example` | Exists, placeholders only |
| Ghana boundary file | Supplied by the project owner (see Configuration) |
| Frontend (`frontend/`) | **Not implemented yet** |
| Terraform (`infra/terraform/`) | Cognito configuration, see `infra/terraform/README.md` |

## Prerequisites

- Docker with Compose v2
- [uv](https://docs.astral.sh/uv/) and Python 3.12 (for running tooling outside the container)
- An AWS account for Cognito (see [Cognito local development](#cognito-local-development))
- An AgroMonitoring API key

## Quick start

```sh
cp .env.example .env     # then replace every placeholder
docker compose up -d postgis backend pgadmin
```

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
| Start everything | `docker compose up -d` (needs the frontend project) |
| Stop | `docker compose down` (add `-v` only to delete data) |
| Rebuild | `docker compose build backend && docker compose up -d backend` |
| Logs | `docker compose logs -f backend` |
| Status and health | `docker compose ps` |
| PostgreSQL shell | `docker compose exec postgis psql -U $POSTGRES_USER -d $POSTGRES_DB` |
| Migrations manually | `docker compose exec backend alembic upgrade head` (or `downgrade -1`) |
| Tests in the container | `docker compose exec backend make test` |
| Performance check | `docker compose exec backend python scripts/perf_check.py` |
| Compose smoke check | `sh backend/scripts/compose_smoke.sh` (on the host) |

`make test` runs `ruff check`, `ruff format --check`, `mypy --strict app` and `pytest`, and exits non-zero if any step fails. Migrations run automatically on backend start; set `MIGRATE_ON_START=false` to skip them.

**Tests.** The suite makes no outbound network calls (pytest-socket allows only the `postgis` host) and uses no real credentials: provider clients are mocked and JWTs are signed with keys generated per run. In the backend container the PostGIS integration tests use a separate database, `eco_test`, on the Compose PostgreSQL server; it is created on first use and the application database is never touched. Set `TEST_DATABASE_URL` to use a different test database. Without a reachable database the integration tests are skipped with a message. Audit rows written by tests stay in `eco_test` because that table is append-only.

The image built before this change has no `make`. After pulling it, rebuild once: `docker compose build backend && docker compose up -d backend`.

**Performance check.** `scripts/perf_check.py` seeds 1000 areas and 500 observations into `eco_test`, measures p95 latency in-process (no network hop) for area reads, map data and report generation, with the provider mock working and failing, then removes the seeded rows. It exits non-zero when a limit (500 ms, 1000 ms, 10 s) is exceeded.

**Compose smoke check.** `backend/scripts/compose_smoke.sh` checks that a missing `AGRO_API_KEY` stops Compose with an error naming it, that the backend reports healthy within 120 s, and that published ports bind to `127.0.0.1`. It starts the stack if it is not running and never removes volumes.

## Cognito local development

Create the Cognito resources by hand in the AWS console, or use Terraform (see below). The backend never creates or changes pools, clients, groups or users.

| Item | Value (example) |
|---|---|
| User pool | One pool, sign-in by email or username |
| App client | Public client, no client secret, Authorization code grant (PKCE), scopes `openid` `email` `profile` |
| Callback URL | `http://localhost:5173/auth/callback` |
| Sign-out URL | `http://localhost:5173/` |
| Allowed origin (backend CORS) | `ALLOWED_ORIGINS=http://localhost:5173` |
| Groups | `admin` and `researcher` (lowercase, case-sensitive) |
| Backend variables | `COGNITO_REGION=eu-west-1`, `COGNITO_USER_POOL_ID=eu-west-1_EXAMPLE`, `COGNITO_APP_CLIENT_ID=exampleclientid1234567890` |
| Tokens | The frontend sends the **access token**. ID tokens are rejected (`token_use` must be `access`). |
| Group claim | `cognito:groups` appears in the access token. Group changes show up only in tokens issued after the change, so the user must sign in again or refresh. |

The example values above are placeholders, not real resources.

### First Admin

No API route grants `admin`. An existing Cognito administrator adds the first Admin, in the console (User pool, Groups, `admin`, Add user to group) or with the CLI:

```sh
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <POOL_ID> --username <USERNAME> --group-name admin
```

After that, an Admin can change roles through `PUT /admin/users/{sub}/roles` only when `COGNITO_ADMIN_ENABLED=true` and the AWS identity behind `AWS_*` may call `cognito-idp:AdminAddUserToGroup`, `AdminRemoveUserFromGroup` and `AdminListGroupsForUser`. Otherwise the endpoint returns 501 `COGNITO_ADMIN_NOT_ENABLED`. These IAM permissions are assumed, not verified.

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
└── .kiro/specs/              requirements, design and tasks for each spec
```

To run the checks outside Docker: `cd backend && uv sync && make test`.
