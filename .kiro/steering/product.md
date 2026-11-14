# Product: Eco-Sentinel Ghana

Eco-Sentinel Ghana is a satellite-based environmental monitoring platform for mining-affected areas of Ghana. It helps environmental researchers and monitoring organisations observe change over time using satellite observations, NDVI statistics and weather context. Admins manage the platform.

The specs are the source of truth:
- Backend: `.kiro/specs/eco-sentinel-backend/` (requirements, design, tasks). Its `design.md` "API Contract" section is the authoritative API contract.
- Frontend: `.kiro/specs/eco-sentinel-frontend/` (requirements, design, tasks).

Where a spec's `design.md` records a resolved conflict with its `requirements.md`, follow the design.

## Evidence and scientific honesty (non-negotiable)

- The platform presents evidence and highlights differences "flagged for investigation". It never classifies a change as illegal mining, destruction, deforestation or recovery.
- Do not author the terms "illegal mining", "illegal", "deforestation", "destruction", "destroyed", "recovery" or "recovered" in any user-facing text, label, legend, report or log message. The only allowed occurrences are the forbidden-term lists themselves (`backend/app/domain/constants.py`, `frontend/src/lib/evidence.ts`) and tests of those lists.
- NDVI values are polygon-level aggregates. Never derive statements about the location, extent or shape of change inside a polygon.
- Never compare, merge, average or overlay Sentinel-2 and Landsat 8 values as if they were equivalent. One sensor per series, chart and comparison.
- Cloud coverage and data coverage are separate metrics. Never substitute `100 - cloud` for missing data coverage; show it as "Not reported".
- Weather is context only. Never compute or display a weather-to-NDVI correlation or causal claim.
- Always surface the backend's warnings, limitations and caveats unchanged. Account for seasonality, irregular sampling, low-quality observations and sensor differences.
- The 117 x 117 px preview images are for visual orientation only.
- Quality levels, flags and warnings are computed by the backend only. The frontend never recomputes them.

## Scope discipline

- MVP scope: Cognito sign-in, Admin/Researcher roles, researcher dashboard, simple admin dashboard, Ghana monitoring areas, observation retrieval, NDVI statistics and trends, date comparisons, interactive map, basic evidence reports, local Docker Compose.
- Out of scope: machine learning, automated illegal-mining classification, predictive modelling, complex alerting, raster change detection, PDF rendering, production AWS infrastructure.
- Do not invent AgroMonitoring, Weather API or Cognito capabilities. If something is unverified, list it as an open item in the relevant design document instead of coding against it.
- Do not add features, abstractions or dependencies that the specs do not require.
