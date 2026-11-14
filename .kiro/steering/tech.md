# Technology and Commands

## Stack

- **Backend** (`backend/`): Python, FastAPI, Pydantic v2, SQLAlchemy 2 (async), Alembic, PostgreSQL + PostGIS, HTTPX, NumPy, Pandas, GeoPandas, Shapely. Rasterio is not used in the MVP. Tooling: uv (`uv.lock` committed), ruff, mypy strict, pytest, Hypothesis, pytest-socket.
- **Frontend** (`frontend/`): React, TypeScript strict, Vite, Tailwind CSS, shadcn/ui, MapLibre GL JS, Recharts, React Router, TanStack Query. Tooling: ESLint, Vitest, React Testing Library, MSW, fast-check, vitest-axe. Exact dependency versions, `package-lock.json` committed.
- **Auth**: AWS Cognito User Pools. Browser uses Authorization Code + PKCE with a public client (no client secret). Backend validates access tokens against the User Pool JWKS. Roles come from Cognito groups `admin` and `researcher`.
- **Local infrastructure**: Docker Compose with `frontend`, `backend`, `postgis` and `pgadmin` on one network, named volumes, health checks, hot reload. No AWS deployment is needed to run or test.

## Commands (run from the repository root)

| Task | Command |
|---|---|
| Start everything | `docker compose up -d` |
| Start without frontend | `docker compose up -d postgis backend pgadmin` |
| Stop | `docker compose down` (never add `-v` unless asked; it deletes data) |
| Rebuild a service | `docker compose build <service> && docker compose up -d <service>` |
| Logs | `docker compose logs -f <service>` |
| Status and health | `docker compose ps` |
| PostgreSQL shell | `docker compose exec postgis psql -U $POSTGRES_USER -d $POSTGRES_DB` |
| Migrations | `docker compose exec backend alembic upgrade head` (`downgrade -1` to step back) |
| New migration | `docker compose exec backend alembic revision --autogenerate -m "<message>"` then review the file |
| Backend checks and tests | `docker compose exec backend make test` (ruff, ruff format --check, mypy --strict, pytest) |
| Frontend tests, once | `docker compose exec frontend npm run test -- --run` |
| Frontend lint and types | `docker compose exec frontend npm run check` |

- Never run watch modes or dev servers from the agent shell. Ask the user to run `docker compose up` themselves when services are needed.
- Tests must not need network access or real credentials. Backend tests block sockets except the test database; frontend tests fail on any unmocked request.
- Run the relevant checks after changing code and report the result. A task is done only when its checks pass.
