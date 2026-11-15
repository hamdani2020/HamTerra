# Implementation Plan: Eco-Sentinel Ghana Frontend

## Overview

The Frontend is built in `./frontend` with TypeScript (strict), React, Vite, Tailwind, shadcn/ui, TanStack Query, MapLibre GL JS and Recharts. Work proceeds in this order: scaffold and test infrastructure, Docker wiring, configuration, design tokens and base components, message mapping, API types and client, authentication, guards and shell, shared helpers, then each feature (dashboard, map, observations, time series, comparison, areas, refresh, admin areas, reports, admin operations), cross-cutting tests, documentation and open-item verification.

Each feature task creates its page module. The router (task 8.3) registers every route with a lazy import of a placeholder page module, and the feature task replaces that placeholder, so no later task edits the router. The Frontend adds no Backend endpoint, does no ML or classification, and defines no production AWS infrastructure. Property tests use fast-check with at least 100 runs and a tag comment `// Feature: eco-sentinel-frontend, Property N: ...`.

## Tasks

- [x] 1. Scaffold the frontend project and test infrastructure
  - [x] 1.1 Scaffold `./frontend`
    - Create Vite + React + TypeScript project with `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`
    - Add Tailwind CSS, shadcn/ui (`components.json`), React Router, TanStack Query, MapLibre GL JS, Recharts, ESLint (typescript-eslint, react-hooks, jsx-a11y, rules forbidding `dangerouslySetInnerHTML` and direct `console.*` outside `safeLog`), Vitest, React Testing Library, user-event, MSW, vitest-axe, fast-check
    - Pin every dependency to an exact version, add `.npmrc` with `save-exact=true`, commit `package-lock.json`
    - Add scripts `dev`, `build`, `test`, `check` (`eslint .` and `tsc --noEmit`)
    - Create `frontend/.env.example` listing every `VITE_` variable with placeholders, and `.gitignore` entries that exclude `.env` and `.env.*` and keep `.env.example`
    - Create the `src/` and `tests/` folder layout from the design
    - _Requirements: 2.6, 22.12, 22.13_

  - [x] 1.2 Create the test infrastructure
    - `tests/setup.ts` with jest-dom, vitest-axe matchers, MSW server lifecycle with `onUnhandledRequest` set to throw an error that names the URL
    - `tests/msw/server.ts`, `tests/factories.ts` (typed builders), `tests/properties/propertyConfig.ts` (100 runs)
    - A `renderWithProviders` helper (router, QueryClient with `retry: false`, auth stub)
    - _Requirements: 23.13, 23.15_

  - [x]* 1.3 Write the network-isolation test
    - Send an unmocked request and assert the test fails with an error naming the URL
    - _Requirements: 23.13_

  - [x]* 1.4 Write static guard tests
    - Fail and name the file when any module in `src` references an AgroMonitoring or Weather API host, or a variable name containing `SECRET` or `API_KEY`
    - Fail when `package.json` direct dependencies contain a version starting with `^`, `~`, `>`, `<` or `*`
    - Fail when a path literal starting with `/areas`, `/admin`, `/reports`, `/observations`, `/settings` or `/me` appears outside `core/api/endpoints.ts`
    - _Requirements: 2.4, 22.12, 23.11_

- [x] 2. Docker development environment
  - [x] 2.1 Add the Dockerfile and Vite configuration
    - Multi-stage `frontend/Dockerfile` (`base`, `dev`, `build`) using `npm ci`, dev server on `0.0.0.0:5173`
    - `vite.config.ts` with `assertRequiredEnv` (throws naming each missing or empty `VITE_` variable, skipped in test mode), `server.watch.usePolling` from `VITE_USE_POLLING` or `CHOKIDAR_USEPOLLING`, HMR client port, and Vitest config (jsdom, setup file)
    - _Requirements: 22.2, 22.3, 22.6, 22.7_

  - [x] 2.2 Wire the `frontend` service into the existing Compose stack
    - Update the root `docker-compose.yml` frontend service: build context `./frontend` target `dev`, `env_file: .env`, bind mount `./frontend:/app` plus a `frontend-node-modules` named volume, port `${BIND_ADDRESS:-127.0.0.1}:${FRONTEND_PORT:-5173}:5173`, same network as the Backend, polling env vars
    - Set the Backend `ALLOWED_ORIGINS` default to include the Frontend origin built from `BIND_ADDRESS` and `FRONTEND_PORT`, falling back to `http://localhost:5173`
    - Add every `VITE_` variable, `FRONTEND_PORT`, `VITE_USE_POLLING` and `CHOKIDAR_USEPOLLING` to the root `.env.example`
    - _Requirements: 22.1, 22.2, 22.5, 22.11_

- [x] 3. Public configuration and config error page
  - [x] 3.1 Implement `loadConfig` and the config error page
    - `core/config.ts` returning `{ok, config}` or `{ok: false, missing, invalid}` with no values in the result
    - `ConfigErrorPage` listing variable names; `main.tsx` renders it and creates no AuthModule and sends no request when config is not ok
    - _Requirements: 2.1, 2.2, 2.3_

  - [x]* 3.2 Write property test for configuration validation
    - **Property 1: Public configuration validation**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [x]* 3.3 Write unit tests for the config error page
    - Missing, blank and invalid URL variables list the correct names; assert no `fetch` call
    - _Requirements: 2.2, 2.3_

- [x] 4. Design tokens and base components
  - [x] 4.1 Set up design tokens and global styles
    - CSS variables and Tailwind theme values for all Design_Tokens and the four status colour pairs, single card shadow, system font stack, focus ring with inner white ring, `touch-target` utility, reduced-motion rule, single landing gradient, `print.css`
    - Generate the shadcn/ui components listed in the design
    - _Requirements: 21.1, 21.2, 21.6, 21.8, 21.10, 21.11, 21.14, 15.11, 6.7_

  - [x] 4.2 Implement `lib/contrast.ts` and `lib/ndviRamp.ts`
    - WCAG contrast ratio function and the 9-stop viridis-like `ndviRamp(value, min, max)`
    - _Requirements: 21.3, 21.12_

  - [x]* 4.3 Write property test for token contrast
    - **Property 31: Contrast of design tokens**
    - **Validates: Requirements 21.3, 21.6**

  - [x]* 4.4 Write property test for the NDVI ramp
    - **Property 32: NDVI ramp**
    - **Validates: Requirements 21.12**

  - [x] 4.5 Build the base components
    - `StatusBadge`, `QualityBadge`, `FlagBadge`, `WarningBanner`, `VerbatimText`, `EvidenceNote`, `FormField` (error text with `aria-describedby`), `AuthCard`
    - Status shown with text label and icon in addition to colour; `VerbatimText` renders a text node with no truncation
    - _Requirements: 20.2, 20.9, 21.5, 21.7, 9.4_

  - [x]* 4.6 Write property test for verbatim rendering
    - **Property 29: Backend text is rendered verbatim**
    - **Validates: Requirements 20.9**

  - [x]* 4.7 Write component tests for base components
    - Status badge, warning banner, form field with Backend field errors, dialog focus-in and focus-return, each with a normal and an empty or error case
    - _Requirements: 23.1, 21.9_

- [x] 5. Message mapping and evidence language
  - [x] 5.1 Implement `lib/evidence.ts` and `lib/messages.ts`
    - `FORBIDDEN_TERMS`, `containsForbiddenTerm`
    - `WARNING_TEXT`, `ERROR_TEXT`, `EVIDENCE_TEXT`, `warningText`, `errorText` (known text, else Backend message, else generic notice with the code)
    - Include `PERCENT_DIFFERENCE_UNDEFINED` and every code in the requirements glossary; `AREA_OUT_OF_RANGE` uses the Backend message
    - _Requirements: 20.1, 20.10, 20.11, 10.11, 11.10, 14.8_

  - [x]* 5.2 Write property test for code-to-text mapping
    - **Property 9: Code to text mapping**
    - **Validates: Requirements 20.10, 20.11**

  - [x]* 5.3 Write property test for forbidden terms
    - **Property 28: Forbidden terms are detected and absent from authored text**
    - **Validates: Requirements 20.1, 11.14, 23.8**

- [x] 6. API types and API_Client
  - [x] 6.1 Create `src/types/api.ts`
    - Types mirroring the Backend contract exactly as listed in the design, plus the client-side models
    - _Requirements: 5.2, 23.5_

  - [x] 6.2 Implement `httpGuard`, `errors` and `pagination`
    - `HttpGuard` allows only the API host, Cognito host and basemap host and rejects schemes, `//` and `..`
    - `ApiError`, `NetworkError`, `ApiTimeoutError`, `DisallowedHostError`; `clampLimit`, `clampOffset`
    - _Requirements: 2.5, 5.14, 5.15_

  - [x]* 6.3 Write property test for the host allow-list
    - **Property 2: Request host allow-list**
    - **Validates: Requirements 2.5**

  - [x]* 6.4 Write property test for pagination clamping
    - **Property 10: Pagination clamping**
    - **Validates: Requirements 5.14, 5.15**

  - [x] 6.5 Implement the API client, endpoints, keys and query client
    - `apiRequest` with bearer attachment (not for `/health`), 30 s timeout (130 s for refresh), abort handling, 401 renew-and-replay-once through an auth provider interface, 403 handling, Error_Envelope parsing
    - `core/api/endpoints.ts` with one typed function per Backend endpoint (the only place path strings appear), `keys.ts`, `queryClient.ts` (`staleTime` 30 s, `retry: false`, `me` never stale)
    - `describeError` in `lib/messages.ts`, `mapFieldErrors`, `safeLog`
    - _Requirements: 2.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 24.2, 24.3_

  - [x]* 6.6 Write property test for bearer attachment
    - **Property 7: Bearer attachment**
    - **Validates: Requirements 5.1, 3.11**

  - [x]* 6.7 Write property test for error description
    - **Property 8: Error description is total and hides details**
    - **Validates: Requirements 5.2, 5.7, 5.11, 5.12**

  - [x] 6.8 Create MSW handlers from the Backend contract
    - Typed handlers for every endpoint group in the contract table, with factories for success and error responses
    - _Requirements: 23.5_

  - [x]* 6.9 Write API integration tests per endpoint group
    - For each group (health, identity, areas, observations, analysis, reports, settings, admin users, admin areas, admin operations): one success and at least one error from that group's error list
    - _Requirements: 23.5_

  - [x]* 6.10 Write error-handling rule tests
    - 401 with exactly one renewal and one replay, 403, 422 field errors, 502, 504, 503, 500 with `request_id`, 413, 501, network failure, unknown code, and the 130 s refresh timeout with fake timers
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.13, 23.6_

- [x] 7. Auth_Module
  - [x] 7.1 Implement PKCE helpers and auth storage
    - `randomString`, `codeChallengeS256`, `buildAuthorizeUrl`, `storage.ts` for `sessionStorage` keys (`eco.pkce.*`, `eco.rt`)
    - _Requirements: 3.1_

  - [x]* 7.2 Write property test for PKCE and the authorize URL
    - **Property 3: PKCE derivation and authorize URL**
    - **Validates: Requirements 3.1**

  - [x] 7.3 Implement the token endpoint client and `AuthModule`
    - `signIn`, `handleCallback` (state gate, 10 s timeout, failure classes, no raw `error_description`), in-memory access token, refresh token in `sessionStorage`, single-flight `renew`, proactive renewal timer, `restore`, `signOut` (clear tokens, storage, query cache, redirect to Cognito `/logout`), ID-token email claim kept in memory for display only
    - Roles are never taken from tokens
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.11, 3.12, 3.14_

  - [x]* 7.4 Write property test for the callback state gate
    - **Property 4: Callback state gate**
    - **Validates: Requirements 3.2, 3.3, 3.14**

  - [x]* 7.5 Write property test for single-flight renewal
    - **Property 5: Single-flight renewal**
    - **Validates: Requirements 3.7, 5.3**

  - [x] 7.6 Add `AuthProvider` and the public auth pages
    - `AuthProvider` with `useSyncExternalStore`, `LandingPage`, `CallbackPage` (run once under strict mode), `SignedOutPage`, `AuthErrorPage` showing only the failure class, expired-session notice
    - _Requirements: 1.1, 3.4, 3.8, 3.10, 21.7_

  - [x]* 7.7 Write authentication tests with a mocked Cognito token endpoint
    - Authorize redirect contents, successful callback, state mismatch, `error` parameter, token exchange failure, 10 s timeout, renewal success and failure, sign-out redirect, `localStorage` empty; each failure asserts no Session and a visible error indication
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9, 23.2_

- [x] 8. Principal loading, route guards and app shell
  - [x] 8.1 Implement `navItems`, the app shell and layout components
    - `navItems(roles)`, `AppShell`, `Sidebar` (persistent from 640 px, `Sheet` drawer below), `Header` (username, email rules, sign-out), `SkipLink`, `RouteAnnouncer` (title and focus within 500 ms), `NoticeHost` (at least 5 s), `NotFoundPage`, `ErrorBoundary`
    - Active item uses emerald style and `aria-current="page"`
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.9, 1.10, 1.11, 1.12, 4.6, 4.7_

  - [x]* 8.2 Write property test for role-based navigation
    - **Property 6: Role-based navigation**
    - **Validates: Requirements 1.4, 1.5, 1.6, 3.13**

  - [x] 8.3 Implement the router, guards and principal loading
    - `router.tsx` with all routes of Requirement 1.1 as lazy imports of placeholder page modules (admin pages and map in separate chunks)
    - `RequireSession`, `RequirePrincipal` (10 s loading, retry on network/500/503, 401 renew path), `RequireRole`, `NoRolePage`, `usePrincipal` (memory only, `staleTime: Infinity`), 403 message handling
    - _Requirements: 1.1, 1.7, 1.8, 3.12, 3.13, 4.1, 4.2, 4.3, 4.4, 4.5, 4.8, 4.9, 24.4_

  - [x]* 8.4 Write route-protection tests
    - No Session redirect, return path restored after sign-in, `GET /me` failing with 401, 500 and a network error, user with no role; each asserts final URL and the visible notice or error
    - _Requirements: 1.8, 3.13, 4.3, 4.4, 4.5, 23.3_

  - [x]* 8.5 Write role-based navigation tests
    - Exact nav items and reachable routes for researcher and admin; researcher opening `/admin` is redirected with a notice
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 23.4_

  - [x]* 8.6 Write responsive layout tests
    - Widths 360, 768 and 1280: drawer on mobile, `scrollWidth` not greater than viewport width, main content reachable
    - _Requirements: 1.2, 1.3, 6.5, 6.6, 23.9_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Shared helpers and common region states
  - [x] 10.1 Implement `lib/dates.ts` and date-range validators
    - Calendar-date check, UTC span arithmetic, `orderDates`, `validateDateRange(from, to, {maxSpanDays, today?})`
    - _Requirements: 10.18, 11.2, 11.3, 12.10, 13.2, 15.2, 18.6, 18.9_

  - [x]* 10.2 Write property test for date range validation
    - **Property 11: Date range validation**
    - **Validates: Requirements 10.18, 11.3, 12.10, 13.2, 15.2, 18.6, 18.9**

  - [x]* 10.3 Write property test for comparison date ordering
    - **Property 12: Comparison date ordering**
    - **Validates: Requirements 11.2, 11.3, 15.1**

  - [x] 10.4 Implement `lib/limiter.ts`, `lib/merge.ts` and `lib/format.ts`
    - FIFO `createLimiter(max)` with abort support, `mergeRecentObservations` (max 10, date descending), `formatSigned`, number and date formatters
    - _Requirements: 7.2, 7.4, 11.8, 24.6_

  - [x]* 10.5 Write property test for the concurrency limiter
    - **Property 14: Concurrency limiter**
    - **Validates: Requirements 7.2, 24.6**

  - [x]* 10.6 Write property test for the recent observations merge
    - **Property 13: Recent observations merge**
    - **Validates: Requirements 7.4**

  - [x] 10.7 Build common state and table components
    - `RegionState` (skeleton with `aria-busy` within 100 ms, `RegionError` with retry disabled while fetching, empty state, outdated badge), `DataTable`, `ResponsiveTable` (cards on mobile), `Pagination` (`total`, `limit`, `offset`), `useDebouncedValue`, `ChartContainer`, `Legend`, `KeyValueList`
    - _Requirements: 5.8, 5.14, 6.1, 6.2, 6.3, 6.4, 6.6, 6.8, 21.7, 24.7_

  - [x]* 10.8 Write component tests for states and tables
    - Data table with pagination, chart container and legend, loading, empty and error states, retry replaces error within one render
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.8, 23.1, 23.10_

- [x] 11. Researcher dashboard
  - [x] 11.1 Implement the dashboard page and hooks
    - `GET /areas` (`status=active`, up to 12 cards), per-card observations (`limit=5`) and time series (last 365 days from the latest date) through one limiter of 6, recent observations table, in-session comparison store for the change indicator, per-card error indicators, empty and error states, aggregate and "for investigation" statements, card navigation
    - Replaces the placeholder `DashboardPage`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 20.3_

  - [x]* 11.2 Write dashboard tests
    - Cards and count, trend and "Not enough observations", no-observation card makes no calls, one failing card keeps others, zero areas, list failure with retry, at most 6 requests in flight
    - _Requirements: 7.1, 7.3, 7.7, 7.8, 7.11, 7.12, 24.6, 23.10_

- [x] 12. Map and preview overlay
  - [x] 12.1 Implement map helpers and the `useMap` hook
    - `featureCollectionBounds` with `GHANA_BOUNDS` fallback, `useMap` controller (areas source and layers, selection feature-state, fit, WebGL failure result, basemap failure timer of 10 s, attribution, keyless raster basemap from `VITE_BASEMAP_TILE_URL`), the only module importing `maplibre-gl`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.13, 8.16, 21.13_

  - [x]* 12.2 Write property test for feature collection bounds
    - **Property 15: Feature collection bounds**
    - **Validates: Requirements 8.1**

  - [x] 12.3 Implement `MapPage`, details panel, controls and legend
    - `GET /areas/map` layer, selection and highlight, details panel within 300 ms with area and observations queries (`limit=10`), background click clears, keyboard-operable zoom and reset buttons, legend, link to `/areas`, error state with retry, unsupported-browser message
    - Replaces the placeholder `MapPage`
    - _Requirements: 8.1, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.14, 8.15, 8.16, 20.3_

  - [x] 12.4 Implement the preview overlay hook and UI
    - `usePreviewOverlay`: fetch blob with bearer through `apiRequest`, bbox image source and raster layer, opacity slider (default 70, 0 to 100, step 1), note, size, approximate-position statement, at most one overlay, remove and unmount revoke the blob URL, pending and error states
    - Wire into `MapPage` and the observation detail
    - _Requirements: 9.6, 9.7, 9.8, 9.10, 9.11, 9.12, 9.13, 9.14, 20.7_

  - [x]* 12.5 Write property test for preview overlay lifecycle
    - **Property 16: Preview overlay lifecycle**
    - **Validates: Requirements 9.12, 9.14, 23.12**

  - [x]* 12.6 Write map tests with MapLibre mocked
    - Feature collection to layer sources, selection state, panel contents, observations error with retry, zero observations, WebGL failure message, basemap failure notice, overlay add and remove leaves no source or layer
    - _Requirements: 8.5, 8.7, 8.8, 8.13, 23.12_

- [x] 13. Observation views
  - [x] 13.1 Implement `ObservationDetail` and `ObservationsTable`
    - Date, labelled source, NDVI statistics (non-null only), cloud and data coverage as separate values, "Not reported" with the `DATA_COVERAGE_UNKNOWN` text, quality badge and warnings, `stale_geometry` badge, preview control or "No preview available"
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.9, 20.3, 20.5, 20.6_

  - [x]* 13.2 Write property test for observation display
    - **Property 30: Observation display**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.9**

  - [x]* 13.3 Write observation view tests
    - Stale geometry badge, null data coverage, null preview URL, preview 404 and 502 message with control still available
    - _Requirements: 9.3, 9.5, 9.9, 9.11_

- [x] 14. NDVI time series
  - [x] 14.1 Implement time-series filters, validation and hook
    - Filter state in the URL, source preselection from the latest observation, no request until a source is chosen, `validateTimeSeriesFilters` (range, 3660 days, cloud 0 to 100), query builder with exactly one `source`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 10.18_

  - [x] 14.2 Implement `NdviChart` and `TimeSeriesPage`
    - Recharts line with markers, quality-based point style and legend, viridis marker colours with NDVI legend, tooltip fields, points table, summary panel with "Not available" for nulls, warning banner, limitations section, cloud-exclusion note, resolution class, weather display with provider, period and Backend note, insufficient-observation and empty states, 404 state, error with retry, screen-reader summary, minimum height 240 px, aggregate note
    - Replaces the placeholder `TimeSeriesPage`
    - _Requirements: 10.5, 10.7, 10.8, 10.9, 10.10, 10.11, 10.12, 10.13, 10.14, 10.15, 10.16, 10.17, 10.19, 10.20, 10.21, 10.22, 20.3, 20.4, 21.12_

  - [x]* 14.3 Write property test for one source per request
    - **Property 17: One source per data request**
    - **Validates: Requirements 10.2, 10.6, 20.5**

  - [x]* 14.4 Write property test for the chart accessible summary
    - **Property 18: Chart accessible summary**
    - **Validates: Requirements 10.22**

  - [x]* 14.5 Write time-series tests
    - Source and date selection, invalid range keeps previous chart, one point, zero points, weather warnings not an error, single-source chart, warnings and limitations unchanged
    - _Requirements: 10.2, 10.14, 10.15, 10.17, 10.18, 23.7, 23.8_

- [x] 15. Date comparison
  - [x] 15.1 Implement threshold override validation and request builder
    - `validateThresholdOverrides` (ranges 0 to 2 and 0 to 100), `buildThresholds(defaults, edited)` returning only changed fields
    - _Requirements: 11.15, 11.16_

  - [x]* 15.2 Write property test for threshold overrides
    - **Property 20: Threshold override validation and minimal request**
    - **Validates: Requirements 11.15, 11.16**

  - [x] 15.3 Implement `ComparisonPage` and `ComparisonResultView`
    - Source selector, date selectors listing stored dates, ordered `date_a` and `date_b`, advanced options prefilled from `GET /settings`, side-by-side cards, signed difference, percent or "Not defined", flag label with values and thresholds, `summary_text` and limitations verbatim, spatial-analysis statement, weather block, warnings, neutral sign colours, `CROSS_SENSOR_COMPARISON`, `NOT_FOUND` and 5xx handling, disabled submit while pending, session comparison store update
    - Replaces the placeholder `ComparisonPage`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12, 11.13, 11.14, 11.17, 20.2, 20.4_

  - [x]* 15.4 Write property test for comparison display fidelity
    - **Property 19: Backend value display fidelity**
    - **Validates: Requirements 11.8, 11.9, 11.13**

  - [x]* 15.5 Write comparison tests
    - Date ordering sent as `date_a` and `date_b`, equal-date prevention, cross-sensor error, 404 date message, selections kept, summary text unchanged
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.9, 23.7, 23.8_

- [x] 16. Monitoring area list and details
  - [x] 16.1 Implement the bounding-box validator
    - `validateBbox` and bbox formatting and parsing
    - _Requirements: 12.4, 12.5_

  - [x]* 16.2 Write property test for bounding box validation
    - **Property 21: Bounding box validation**
    - **Validates: Requirements 12.4, 12.5**

  - [x] 16.3 Implement `AreaListPage`
    - Filters in the URL, 300 ms debounced `q` (max 100 chars), status filter, bbox filter with optional map extent, 20 rows per page, empty state with reset, 422 message with filters kept
    - Replaces the placeholder `AreaListPage`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 16.4 Implement `AreaDetailPage`
    - Area fields, archived badge, mini map (dynamic import), collapsible observation history with filters and validation, 20 rows per page, observation detail loading, 404 state, links to time series, comparison and create report, refresh button
    - Replaces the placeholder `AreaDetailPage`
    - _Requirements: 12.8, 12.9, 12.10, 12.11, 12.12, 12.13, 12.14, 20.3_

  - [x]* 16.5 Write area list and detail tests
    - Debounce sends exactly one request after 300 ms, filter application, pagination, invalid bbox sends no request, empty state, 404 state
    - _Requirements: 12.2, 12.5, 12.7, 12.13, 23.7_

- [x] 17. Observation refresh
  - [x] 17.1 Implement the refresh validator and request builder
    - `validateRefreshRange` (valid dates, not future, at most 366 days inclusive), `buildRefreshRequest` omitting `sources` when both are selected
    - _Requirements: 13.1, 13.2, 13.3_

  - [x]* 17.2 Write property test for refresh source selection
    - **Property 22: Refresh source selection**
    - **Validates: Requirements 13.1, 13.3**

  - [x] 17.3 Implement `RefreshDialog` and refresh mutation
    - Progress indicator with elapsed counter and "up to two minutes" text, disabled confirm, Escape closes without aborting, success, empty and partial results with counts and warnings, `retrieval_id`, 409, 502 and 504, 130 s timeout message, cache invalidation per design
    - _Requirements: 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11_

  - [x]* 17.4 Write refresh dialog tests
    - Success, empty, partial, 409, 502, 130 s timeout with fake timers, no second request while pending, cache invalidated only on success and partial
    - _Requirements: 13.4, 13.5, 13.6, 13.7, 13.8, 13.10, 23.6, 23.7_

- [x] 18. Admin area management
  - [x] 18.1 Implement GeoJSON validation and `diffAreaForm`
    - `validateGeoJsonInput` (JSON parse with position, Polygon, MultiPolygon, Feature, single-feature collection, coordinate ranges only), file size and extension checks, `diffAreaForm`
    - _Requirements: 14.2, 14.4, 14.5, 14.6, 14.11_

  - [x]* 18.2 Write property test for the GeoJSON client check
    - **Property 23: GeoJSON client check**
    - **Validates: Requirements 14.2, 14.4, 14.6**

  - [x]* 18.3 Write property test for the area form diff
    - **Property 24: Area form diff**
    - **Validates: Requirements 14.11**

  - [x] 18.4 Implement `AdminAreasPage` and `AreaForm`
    - Table with `status=all`, create and edit form with preview map and coordinate-order note, file load, pending progress state, error mapping (`GEOMETRY_OUTSIDE_GHANA`, `AREA_OUT_OF_RANGE`, `CONFLICT`, 502, 504) with values kept, geometry-change confirmation, archive and restore confirmations, failure handling, write controls only for `admin`, cache invalidation
    - Replaces the placeholder admin areas page
    - _Requirements: 14.1, 14.2, 14.3, 14.7, 14.8, 14.9, 14.10, 14.11, 14.12, 14.13, 14.14, 14.15, 14.16, 14.17_

  - [x]* 18.5 Write admin area tests
    - Pasted GeoJSON create success, invalid JSON and file rejection send no request, Backend errors keep values, no-change edit sends nothing, archive failure leaves status, restore 409
    - _Requirements: 14.4, 14.5, 14.8, 14.9, 14.11, 14.14, 14.15, 23.7_

- [x] 19. Reports
  - [x] 19.1 Implement the report form validator
    - `validateReportForm` (range up to 1826 days, title up to 200, up to 10 pairs, no equal dates, earlier first)
    - _Requirements: 15.1, 15.2_

  - [x]* 19.2 Write property test for report form validation
    - **Property 25: Report form validation**
    - **Validates: Requirements 15.1, 15.2**

  - [x] 19.3 Implement the create-report dialog and `ReportListPage`
    - Dialog reachable from the area page (area fixed) and `/reports` (area selectable), `POST /reports` with navigation on 201, `NO_OBSERVATIONS` with refresh link, error handling with values kept; list with 20 rows, `area_id` filter, `created_by` filter for admins, empty state
    - Replaces the placeholder `ReportListPage`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.15_

  - [x] 19.4 Implement `ReportViewPage`
    - Single `format=json` request keeping raw text, stored map, chart and table reusing `NdviChart`, summary, comparisons via `ComparisonResultView`, thresholds, weather, always-visible caveats and limitations, snapshot statement, "Download JSON" (raw bytes, file named with report ID), "Print" with print stylesheet, no PDF control, generic 404 state
    - Replaces the placeholder `ReportViewPage`
    - _Requirements: 15.7, 15.8, 15.9, 15.10, 15.11, 15.12, 15.13, 15.14, 20.9_

  - [x]* 19.5 Write property test for report download
    - **Property 26: Report download is unmodified**
    - **Validates: Requirements 15.11**

  - [x]* 19.6 Write report tests
    - Create success navigates, `NO_OBSERVATIONS`, list empty state, caveats and limitations unchanged, 404 state, no extra data request from the report view
    - _Requirements: 15.3, 15.4, 15.6, 15.8, 15.10, 15.13, 23.8_

- [ ] 20. Admin overview, users, retrievals, activity and settings
  - [ ] 20.1 Implement the setting validator and descriptions
    - `validateSetting(item, raw)` and `SETTING_DESCRIPTIONS` (at most 160 characters for the six known keys)
    - _Requirements: 19.2, 19.3, 19.8_

  - [ ]* 20.2 Write property test for setting validation
    - **Property 27: Setting value validation**
    - **Validates: Requirements 19.2, 19.3**

  - [ ] 20.3 Implement `AdminOverviewPage`
    - Independent cards for dashboard counts, integrations status (text labels, no keys), probe button with 30 s timeout, recent failures (5), recent activity (10), per-card errors with retry, zero shown as 0
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 21.5_

  - [ ] 20.4 Implement `AdminUsersPage` and role editor
    - Filters `role` and `q`, table with "Not available" email, user details, role editor dialog, one in-flight request per user, handling of 200, 501, `SELF_ROLE_CHANGE`, `LAST_ADMIN`, 404, 502 and 504, editor disabled for the signed-in admin, no create, reset or delete controls
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 17.11, 17.12, 17.13_

  - [ ] 20.5 Implement `AdminRetrievalsPage` and `AdminActivityPage`
    - Filters with date validation, page size 1 to 100 (default 25), status badges with text, `error.code` and `error.message` as received, read-only key-value details, empty and error states without stale rows, no edit or delete controls
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10, 18.11_

  - [ ] 20.6 Implement `AdminSettingsPage`
    - Rows with type-matched inputs and range text, synchronous validation within 200 ms, save disabled when invalid or pending, replace row on 200, 422 message with edit kept, 404 reload, 500 and timeout message, unknown keys by name only, reports-unchanged note, invalidate `GET /settings`; researcher pages read `GET /settings` and show "not available" for missing keys
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9, 19.10, 19.11_

  - [ ]* 20.7 Write admin page tests
    - Role change with 409 and 501, settings edit with 422, invalid setting blocks save, retrievals and activity date errors send no request, overview card failure isolated, probe disabled while pending
    - _Requirements: 16.4, 16.8, 17.7, 17.9, 18.6, 19.3, 19.5, 23.7_

- [ ] 21. Cross-cutting verification
  - [ ] 21.1 Verify code splitting and cache behaviour wiring
    - Confirm admin pages, map, MapLibre and Recharts load only through lazy imports, and that all hooks pass `signal` to `apiRequest`
    - _Requirements: 24.2, 24.3, 24.4_

  - [ ]* 21.2 Write the forbidden-term scan test
    - Scan `src` text and the rendered text of every page (Backend text replaced by clean fixtures) and fail on any match
    - _Requirements: 20.1, 23.8_

  - [ ]* 21.3 Write axe accessibility tests
    - Landing, dashboard, map, time series, comparison, observation detail, error page and one admin page; any violation fails
    - _Requirements: 21.4, 23.14_

  - [ ]* 21.4 Write caching and cancellation tests
    - Identical GETs within 30 s send one request and after 30 s two (fake timers), `GET /me` once per Session, leaving a page aborts in-flight requests without an error state
    - _Requirements: 24.2, 24.3_

  - [ ]* 21.5 Write the chunk smoke test
    - Inspect the Vite build manifest and assert the admin pages and the map form separate chunks
    - _Requirements: 24.4_

- [ ] 22. Documentation
  - [ ] 22.1 Write the frontend README section
    - Commands to start, stop, rebuild, view logs, run tests once (`docker compose exec frontend npm run test -- --run`) and run `npm run check`; polling variable for file-change events; Cognito local settings (callback `http://localhost:5173/auth/callback`, sign-out `http://localhost:5173/signed-out`, allowed origin, public client without secret, Authorization code grant, scopes `openid`, `email`, `profile`, groups `admin` and `researcher`); note that both the Backend `/` and Frontend `/signed-out` sign-out URLs must be registered; re-sign-in needed after group changes; basemap policy note
    - _Requirements: 22.3, 22.8, 22.9, 22.10_

- [ ] 23. Open-item verification (non-blocking)
  - [ ] 23.1 Verify design open items against the Backend OpenAPI when it is available
    - Check refresh body fields (`date_from`, `date_to`, `sources`) and the 366-day inclusive rule, the inferred shapes (`RetrievalRecord.requested_range`, `SettingItem.value`, `PUT /admin/settings/{key}` response, user `status`), the sign-out URL (`/` versus `/signed-out`), and whether `PERCENT_DIFFERENCE_UNDEFINED` is emitted
    - Adjust `src/types/api.ts`, MSW handlers and `messages.ts` if they differ; if the OpenAPI document does not exist yet, record the pending items in the README and continue
    - _Requirements: 3.9, 13.2, 13.3, 19.1, 22.10_

- [ ] 24. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests validate the 32 correctness properties of the design, one test per property
- Unit, component and integration tests validate examples, states and edge cases
- Checkpoints ensure incremental validation

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "2.2", "3.1", "4.1", "4.2", "5.1", "6.1", "6.2", "10.1", "10.4"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.3", "4.4", "4.5", "5.2", "5.3", "6.3", "6.4", "6.5", "7.1", "10.2", "10.3", "10.5", "10.6"] },
    { "id": 4, "tasks": ["4.6", "4.7", "6.6", "6.7", "6.8", "7.2", "7.3", "10.7"] },
    { "id": 5, "tasks": ["6.9", "6.10", "7.4", "7.5", "7.6", "10.8"] },
    { "id": 6, "tasks": ["7.7", "8.1"] },
    { "id": 7, "tasks": ["8.2", "8.3"] },
    { "id": 8, "tasks": ["8.4", "8.5", "8.6"] },
    { "id": 9, "tasks": ["11.1", "12.1", "13.1", "14.1", "15.1", "16.1", "17.1", "18.1", "19.1", "20.1"] },
    { "id": 10, "tasks": ["11.2", "12.2", "12.3", "13.2", "13.3", "14.2", "14.3", "15.2", "15.3", "16.2", "16.3", "17.2", "17.3", "18.2", "18.3", "18.4", "19.2", "19.3", "20.2", "20.3", "20.4", "20.5", "20.6"] },
    { "id": 11, "tasks": ["12.4", "14.4", "14.5", "15.4", "16.4", "19.4"] },
    { "id": 12, "tasks": ["12.5", "12.6", "15.5", "16.5", "17.4", "18.5", "19.5", "19.6", "20.7"] },
    { "id": 13, "tasks": ["21.1", "21.2", "21.3", "21.4", "22.1", "23.1"] },
    { "id": 14, "tasks": ["21.5"] }
  ]
}
```
