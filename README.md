# Eco Sentinel

Eco Sentinel is a web platform for monitoring vegetation change (NDVI from Sentinel-2 and Landsat 8) over registered areas in Ghana. The backend is a FastAPI service backed by PostgreSQL/PostGIS. It validates AWS Cognito access tokens and enforces the `admin` and `researcher` roles. It presents numeric evidence for investigation and never classifies a change as illegal mining, destruction or recovery.

Specs live in `.kiro/specs/` (`eco-sentinel-backend`, `eco-sentinel-frontend`, `eco-sentinel-infrastructure`).

## Status

| Part | State |
|---|---|
| Backend project scaffold (`backend/`: Dockerfile, Makefile, entrypoint, smoke test) | Exists |
| `docker-compose.yml` (PostGIS, backend, pgAdmin, frontend) | Exists |
| Backend application code (`app.main:create_app`), API routes | **Not implemented yet**. The backend container cannot start until it exists. |
| Alembic migrations (`alembic upgrade head`) | **Not implemented yet**. `entrypoint.sh` calls it, so startup fails until migrations exist, unless `MIGRATE_ON_START=false`. |
| `.env.example` | **Not created yet**. See [Configuration](#configuration). |
| Frontend (`frontend/`) | **Not implemented yet**. The `frontend` Compose service has no build context. |
| Terraform (`infra/terraform/`) | **Not implemented yet** |

The commands below describe the intended workflow from the design. Anything that depends on a row marked "Not implemented" will not work today.

## Prerequisites

- Docker with Compose v2
- [uv](https://docs.astral.sh/uv/) and Python 3.12 (for running tooling outside the container)
- An AWS account for Cognito (see [Cognito local development](#cognito-local-development))
- An AgroMonitoring API key

## Quick start

```sh
cp .env.example .env     # .env.example does not exist yet; create .env by hand, see Configuration
# edit .env: set every required value
docker compose up -d
```

All published ports bind to `127.0.0.1` by default (`BIND_ADDRESS`). Default ports: backend 8000, frontend 5173, PostgreSQL 5432, pgAdmin 5050.

## Configuration

`docker-compose.yml` refuses to start if any of these are missing from `.env`:

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `PGADMIN_DEFAULT_EMAIL`, `PGADMIN_DEFAULT_PASSWORD`, `COGNITO_USER_POOL_ID`, `COGNITO_REGION`, `COGNITO_APP_CLIENT_ID`, `AGRO_API_KEY`.

The backend also requires `GHANA_BOUNDARY_PATH`, the path to a GeoJSON Polygon or MultiPolygon of Ghana (EPSG:4326). The project owner supplies it as `backend/data/ghana_boundary.geojson`; the repository does not ship one. The backend refuses to start when the file is missing or unusable. The boundary is used to check that monitoring areas lie inside Ghana. A coarse boundary is acceptable for the MVP, so an area very close to the border can be accepted slightly beyond it. The full variable list and defaults are in the Settings table of `.kiro/specs/eco-sentinel-backend/design.md`. `.env` is git-ignored. Never commit real secrets or paste them into issues or logs.

## Developer commands

| Task | Command |
|---|---|
| Start | `docker compose up -d` |
| Stop | `docker compose down` (add `-v` only to delete data) |
| Rebuild | `docker compose build backend && docker compose up -d backend` |
| Logs | `docker compose logs -f backend` |
| PostgreSQL shell | `docker compose exec postgis psql -U $POSTGRES_USER -d $POSTGRES_DB` |
| Migrations manually | `docker compose exec backend alembic upgrade head` (or `downgrade -1`) |
| Tests in the container | `docker compose exec backend make test` |

`make test` runs `ruff check`, `ruff format --check`, `mypy --strict app` and `pytest`, and exits non-zero if any step fails. Migrations run automatically on backend start; set `MIGRATE_ON_START=false` to skip them. Alembic is not set up yet (see Status).

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

[`infra/terraform/README.md`](infra/terraform/README.md) will describe creating the Cognito resources with Terraform instead of the manual console steps. It is **not yet created**; see `.kiro/specs/eco-sentinel-infrastructure`.

## Open provider items

Still to validate against the owner's accounts (design.md, "Open Items"):

1. Real AgroMonitoring `ndvi/history` and `image/search` responses (field names, `type` parameter, `dc` presence, MultiPolygon registration, polygon delete call).
2. Provider rate limit, polygon count and area totals, and history depth of the plan.
3. A downloaded GeoTIFF and tile sample (pixel size, CRS, licence).
4. Weather provider choice, endpoints, fields, units and limits. Until then `WEATHER_PROVIDER=none`.
5. IAM permissions for Cognito group changes, and whether the frontend shows the email from the ID token (access tokens usually carry no `email`).

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
│   ├── app/                  api, core, db, domain, integrations, services (packages only so far)
│   └── tests/                unit, api, integration, properties
└── .kiro/specs/              requirements, design and tasks for each spec
```

To run the checks outside Docker: `cd backend && uv sync && make test`.
