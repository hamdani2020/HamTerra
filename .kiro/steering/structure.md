# Repository Structure

```
.
├── docker-compose.yml        # frontend, backend, postgis, pgadmin
├── .env.example              # every variable, placeholder values only (.env is git-ignored)
├── README.md                 # start/stop/rebuild/logs/tests, Cognito local setup, first admin
├── backend/                  # FastAPI service (layout in backend design.md)
│   ├── app/core/             # config, logging, errors, permissions, security, redaction
│   ├── app/api/              # deps, middleware, routers/, schemas/
│   ├── app/domain/           # pure analysis functions (geometry, quality, timeseries, comparison, constants)
│   ├── app/services/         # use cases, transactions, audit
│   ├── app/integrations/     # agro/, weather/, cognito/
│   ├── app/db/               # models, session, repositories
│   ├── alembic/versions/     # migrations
│   ├── data/                 # ghana_boundary.geojson (supplied by the owner)
│   └── tests/                # unit/, properties/, integration/, api/
├── frontend/                 # React SPA (layout in frontend design.md)
│   ├── src/core/             # config, auth/, api/
│   ├── src/types/api.ts      # mirrors the backend API contract
│   ├── src/lib/              # messages, evidence, validators, dates, limiter, pagination, ndviRamp
│   ├── src/features/         # per-feature hooks and components
│   ├── src/components/       # ui/ (shadcn), layout/, common/
│   ├── src/pages/            # lazy route modules
│   └── tests/                # msw/, unit/, properties/, components/, integration/, a11y/, scan/
└── .kiro/                    # specs, steering, hooks
```

## Single-source modules (do not duplicate their content elsewhere)

- `backend/app/core/permissions.py`: the only place that defines permission strings.
- `backend/app/domain/constants.py`: limitations, caveats, forbidden terms, sensor resolution classes.
- `backend/app/core/errors.py`: error codes and exception handlers.
- `frontend/src/lib/messages.ts`: the only mapping from backend warning and error codes to display text.
- `frontend/src/lib/evidence.ts`: the frontend forbidden-term list.
- `frontend/src/types/api.ts`: frontend copies of backend contract types.
- `frontend/src/core/api/client.ts`: the only module that calls `fetch` for the backend.

## Conventions

- Backend layering: routers -> services -> domain / repositories / integrations. Domain code is pure and has no I/O.
- Backend routers are discovered automatically by `main.py`; adding a router does not edit `main.py`.
- Frontend routes are registered once in `router.tsx` with lazy pages; feature work replaces its own placeholder page.
- Tests sit in the `tests/` tree of each service, mirroring the source area they cover.
