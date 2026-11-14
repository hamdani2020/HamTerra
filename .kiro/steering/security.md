# Security Rules

## Secrets

- AgroMonitoring and Weather API keys, database passwords, Cognito settings and any AWS credentials come from environment variables only. They live in `.env`, which is git-ignored. `.env.example` holds placeholders only.
- Never hardcode, log, print, commit or echo a credential. Never paste a real key into a spec, steering file, test fixture or README. Tests use dummy values.
- Provider keys never leave the backend: not in responses, error bodies, OpenAPI examples, image URLs or frontend bundles. Provider image URLs that carry a key are served through the authorised backend image proxy.
- Logs redact credentials, `appid` and similar query parameters, and `Authorization` headers as `[REDACTED]`.
- The frontend reads only `VITE_` public config (Cognito domain, client ID, region, redirect and logout URIs, API base URL, basemap tile URL). It never contains a client secret or provider key and never calls AgroMonitoring or a Weather API.

## Authentication and authorisation

- The backend validates every protected request's Cognito access token: signature against JWKS, `iss`, `client_id`, `token_use=access`, `exp`. ID tokens are rejected.
- Every endpoint except `/health/*` declares its required role. Admin implies researcher permissions. The backend enforces this; frontend route guards are a usability aid only.
- Roles come only from the `cognito:groups` claim of a validated token. Never accept a role from a request body of a non-admin operation, and never add a route that lets a user grant themselves `admin`.
- The application never creates, modifies or deletes Cognito resources. The only Cognito write is admin group membership changes, and only when the backend has been given that IAM permission (otherwise 501).
- First admin: an existing Cognito administrator adds the user to the `admin` group in the AWS console or CLI. Document this; do not automate it.
- Frontend: access token in memory only, never `localStorage`. The refresh token is in `sessionStorage` per the frontend spec. No `dangerouslySetInnerHTML`, no third-party scripts, strict CSP.

## Safe defaults

- Validate input at the API boundary (Pydantic) and use parameterised queries through SQLAlchemy. No string-built SQL.
- Error responses use the Error_Envelope and never include stack traces, SQL, secrets or raw upstream bodies.
- Published Docker ports bind to `127.0.0.1` by default. CORS allows only configured origins.
- Ask the user before destructive or hard-to-reverse actions: deleting volumes (`docker compose down -v`), dropping tables, downgrading migrations on real data, force pushes.
