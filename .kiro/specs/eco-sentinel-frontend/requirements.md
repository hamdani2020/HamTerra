# Requirements Document

## Introduction

Eco-Sentinel Ghana Frontend is a single-page web application for researchers and administrators who review satellite-derived environmental evidence for mining-affected areas of Ghana. It is the second of two coordinated specs. The Backend spec `eco-sentinel-backend` defines the API. The `design.md` of that spec (section "API Contract") is the authoritative contract and overrides the Backend `requirements.md` where the two differ. This spec does not define or change any Backend endpoint.

The Frontend presents evidence (NDVI, cloud coverage, data coverage, quality, weather context) and shows differences "flagged for investigation". The Frontend does not classify any change as illegal mining, destruction or recovery, does not state where in a polygon a change occurred, and does not present weather as a cause of any NDVI change.

### Stack and Constraints

React, TypeScript, Vite, Tailwind CSS, shadcn/ui, MapLibre GL JS, Recharts, Vitest, React Testing Library, Mock Service Worker (MSW) for API mocks. Authentication uses AWS Cognito User Pools with the Authorization Code flow and PKCE (public client). The Frontend calls only the Backend API and Cognito. It never calls AgroMonitoring or a Weather API and holds no secret. Frontend route protection is a usability aid. The Backend enforces security.

### Backend Contract Used by the Frontend

All paths are under `/api/v1` unless noted.

| Area | Endpoints |
|---|---|
| Health (unversioned, not used by the UI except optionally) | `GET /health/live`, `GET /health/ready` |
| Identity | `GET /me` |
| Areas | `GET /areas`, `GET /areas/map`, `GET /areas/{area_id}` |
| Observations | `GET /areas/{area_id}/observations`, `GET /observations/{observation_id}`, `GET /observations/{observation_id}/preview`, `POST /areas/{area_id}/observations/refresh` |
| Analysis | `GET /areas/{area_id}/ndvi/timeseries`, `POST /areas/{area_id}/comparisons` |
| Reports | `POST /reports`, `GET /reports`, `GET /reports/{report_id}` (`format=json` or `pdf`) |
| Settings | `GET /settings`, `GET /admin/settings`, `PUT /admin/settings/{key}` |
| Admin users | `GET /admin/users`, `GET /admin/users/{sub}`, `PUT /admin/users/{sub}/roles` |
| Admin areas | `POST /admin/areas`, `PATCH /admin/areas/{area_id}`, `POST /admin/areas/{area_id}/archive`, `POST /admin/areas/{area_id}/restore` |
| Admin operations | `GET /admin/retrievals`, `GET /admin/integrations/status`, `GET /admin/activity`, `GET /admin/dashboard` |

Backend error codes the Frontend recognises by name: `UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `GEOMETRY_OUTSIDE_GHANA`, `AREA_OUT_OF_RANGE`, `CROSS_SENSOR_COMPARISON`, `NO_OBSERVATIONS`, `REFRESH_IN_PROGRESS`, `LAST_ADMIN`, `SELF_ROLE_CHANGE`, `COGNITO_ADMIN_NOT_ENABLED`, `UPSTREAM_ERROR`, `UPSTREAM_TIMEOUT`, `NOT_IMPLEMENTED`, `PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`.

Backend warning codes the Frontend recognises by name: `INSUFFICIENT_OBSERVATIONS`, `IRREGULAR_SAMPLING`, `WEATHER_UNAVAILABLE`, `WEATHER_DISABLED`, `LOW_QUALITY_OBSERVATION`, `SEASONALITY_NOT_CONTROLLED`, `DATA_COVERAGE_UNKNOWN`, `ITEMS_DISCARDED`, `INVALID_CLOUD_COVERAGE`, `WEATHER_INVALID_DATA`, and the comparison warning `PERCENT_DIFFERENCE_UNDEFINED`.

### Gaps and Uncertainties

The Frontend does not invent endpoints. The items below are not provided by the Backend contract. Each is handled in the requirements as stated.

- **G1 No cross-area observation feed.** No endpoint lists recent observations across all areas. The researcher dashboard builds "recent observations" from `GET /areas/{area_id}/observations` calls for a limited number of areas (Requirement 7).
- **G2 No cross-area NDVI summary.** NDVI trend summaries per area need one `GET /areas/{area_id}/ndvi/timeseries` call per area. The dashboard limits the number of calls (Requirement 7).
- **G3 No exposed area limits.** No endpoint returns the minimum or maximum area in hectares (the Backend default maximum is 3000 ha). The Frontend does not hard-code limits and shows the Backend `AREA_OUT_OF_RANGE` message.
- **G4 Preview image extent is unconfirmed.** The preview is a 117x117 px PNG with no georeference. Placing it on the map at the polygon bounding box is an orientation aid whose alignment the Backend does not confirm (Requirement 9).
- **G5 No basemap provider decision.** The Backend does not supply a basemap. A basemap that needs no secret key must be chosen in design. OpenStreetMap public tiles have a usage policy that limits heavy use. This is open (Requirement 8).
- **G6 Email is usually null.** Cognito access tokens normally carry no email, so `GET /me` returns `email: null` in most cases. The Frontend may display the email claim from the ID token for display only (Requirement 4).
- **G7 No single-retrieval or comparison-history endpoint.** Comparisons are computed on demand and stored only inside Reports. The Frontend has no comparison list.
- **G8 No user search by email, and no user creation.** User management is limited to `GET /admin/users` filters (`role`, `q`) and role changes.
- **G9 Token storage trade-off.** Storing a refresh token in a browser is a security trade-off. Requirement 3 sets the MVP choice. The choice is open to review in design.
- **G10 Refresh duration.** `POST /areas/{area_id}/observations/refresh` can run up to 120 seconds (Backend). The Frontend must show progress for that period without a Backend progress endpoint.
- **G11 Observation previews carry no reliable `url` for every observation.** `Preview.url` can be null. The Frontend shows no preview in that case.

## Glossary

- **Frontend**: The React single-page application defined in this spec.
- **Backend**: The FastAPI service defined in `eco-sentinel-backend`.
- **API_Client**: The Frontend module that sends every request to the Backend, attaches the Access_Token, and parses the Error_Envelope.
- **Cognito**: AWS Cognito User Pools, the identity provider.
- **Auth_Module**: The Frontend module that runs the Authorization Code flow with PKCE, holds tokens, renews tokens and signs the user out.
- **Access_Token**: The Cognito access token sent to the Backend as a Bearer token.
- **Refresh_Token**: The Cognito refresh token used to obtain a new Access_Token.
- **Session**: The signed-in state held by the Auth_Module.
- **Principal**: The result of `GET /me`: `sub`, `username`, `email` (nullable), `roles`, `permissions`.
- **Role**: `admin` or `researcher`, as returned in the Principal.
- **Permission**: A permission string returned in the Principal. The Frontend never creates permission strings.
- **Route_Guard**: The Frontend component that hides routes and navigation items the Principal cannot use. It is a usability aid only.
- **Error_Envelope**: The Backend JSON error body `{"error": {"code", "message", "details", "request_id"}}`.
- **Monitoring_Area**: The Backend `Area` resource.
- **Observation**: The Backend `Observation` resource, with `source` equal to `sentinel-2` or `landsat-8`.
- **Quality_Indicator**: The Backend `Quality` object with `level` (`good`, `limited`, `poor`), cloud and data coverage percentages and warnings.
- **Time_Series_View**: The screen that shows the Backend time-series response for one Monitoring_Area and one source.
- **Comparison_View**: The screen that shows the Backend comparison response for two dates.
- **Map_View**: The MapLibre GL JS component that shows Monitoring_Area polygons.
- **Preview_Overlay**: A low-resolution preview image from `GET /observations/{observation_id}/preview` drawn on the Map_View for visual orientation.
- **Flag**: The Backend comparison field `flag` with value `flagged` or `not_flagged`.
- **Warning_Banner**: The UI element that lists Backend warnings and limitations next to the data they apply to.
- **Report_View**: The screen that shows a stored Backend Report.
- **Admin_Area**: The set of screens that require the `admin` Role.
- **Design_Tokens**: The colour, spacing and typography values in the Design System requirement.
- **Compose_Stack**: The Docker Compose environment defined by the Backend spec with the `frontend` service added.
- **Public_Config**: The `VITE_` environment variables: Cognito domain, Cognito client ID, redirect URI, logout URI, Cognito region, and API base URL.
- **Viewport_Class**: One of mobile (width below 640 px), tablet (640 to 1023 px) and desktop (1024 px and above).

## Requirements

### Requirement 1: Application Shell, Routing and Navigation

**User Story:** As a user, I want a consistent application layout with navigation, so that I can reach every screen I am allowed to use.

#### Acceptance Criteria

1. THE Frontend SHALL provide these routes: `/` (landing and sign-in), `/auth/callback`, `/signed-out`, `/auth/error`, `/dashboard`, `/map`, `/areas`, `/areas/:areaId`, `/areas/:areaId/timeseries`, `/areas/:areaId/compare`, `/reports`, `/reports/:reportId`, `/admin`, `/admin/users`, `/admin/areas`, `/admin/retrievals`, `/admin/settings`, `/admin/activity`.
2. WHILE a Session exists and the Viewport_Class is tablet or desktop (640 px or more), THE Frontend SHALL render a persistent layout with a sidebar, a header showing the Principal username and a sign-out control, and a content area.
3. WHILE a Session exists and the Viewport_Class is mobile (below 640 px), THE Frontend SHALL render a header showing the Principal username and a sign-out control, a content area, and a menu button that opens a navigation drawer.
4. WHILE the Principal holds the `researcher` or `admin` Role, THE Frontend SHALL show the navigation items Dashboard, Map, Areas and Reports.
5. WHILE the Principal holds the `admin` Role, THE Frontend SHALL show the navigation items Admin Overview, Users, Areas Management, Retrievals, Settings and Activity in addition to the researcher items.
6. WHILE the Principal holds only the `researcher` Role, THE Frontend SHALL show no Admin_Area navigation item.
7. IF a Principal who holds only the `researcher` Role opens any `/admin` route directly, THEN THE Frontend SHALL redirect to `/dashboard` and show a notice that the page requires the admin role. The notice SHALL remain visible for at least 5 seconds or until the user dismisses it.
8. IF no Session exists and the user opens a route other than `/`, `/auth/callback`, `/signed-out` or `/auth/error`, THEN THE Frontend SHALL redirect to `/`.
9. WHEN the current route changes, THE Frontend SHALL mark the matching navigation item as active with the primary emerald style and `aria-current="page"`, and SHALL remove that marking from all other navigation items.
10. IF the user opens a path that matches no route, THEN THE Frontend SHALL show a not-found page with a link to `/dashboard`, or to `/` when no Session exists.
11. WHEN a route changes, THE Frontend SHALL move keyboard focus to the main content heading within 500 ms and set the document title to include the page name.
12. THE Frontend SHALL render a visible skip-to-content link as the first focusable element. Activating it SHALL move focus to the content area.

### Requirement 2: Public Configuration and Secret Handling

**User Story:** As a project owner, I want the Frontend to hold no secrets, so that nothing sensitive ships to the browser.

#### Acceptance Criteria

1. THE Frontend SHALL read only these configuration values from `VITE_` environment variables: Cognito domain, Cognito client ID, Cognito region, redirect URI, logout URI and API base URL.
2. IF a Public_Config value is missing, empty or contains only whitespace at application start, THEN THE Frontend SHALL render a configuration error page that lists the name of each missing variable, SHALL NOT start the sign-in flow and SHALL NOT send any HTTP request.
3. IF the API base URL, redirect URI or logout URI is not a syntactically valid absolute URL at application start, THEN THE Frontend SHALL render the configuration error page naming each invalid variable and SHALL NOT start the sign-in flow.
4. THE Frontend SHALL NOT contain, read or send an AgroMonitoring key, a Weather API key, a Cognito client secret, AWS credentials or a database credential.
5. IF code in the Frontend attempts to send an HTTP request to a host other than the configured API base URL host or the Cognito domain, THEN THE Frontend SHALL NOT send the request and SHALL surface an error to the calling code. Basemap tile requests (Requirement 8) are the only exception.
6. THE repository SHALL contain a `frontend/.env.example` that lists every Public_Config variable with a placeholder value and a `.gitignore` entry that excludes `.env` files and keeps `.env.example` tracked.
7. THE Frontend SHALL NOT write the Access_Token, the Refresh_Token or any response body into application logs or browser console output.

### Requirement 3: Authentication with Cognito (Authorization Code with PKCE)

**User Story:** As a user, I want to sign in through Cognito, so that I reach the platform securely.

#### Acceptance Criteria

1. WHEN an unauthenticated user selects the sign-in control on `/`, THE Auth_Module SHALL generate a random `state` value of at least 32 characters and a PKCE `code_verifier` of 43 to 128 characters, derive the `code_challenge` with the S256 method, store the `state` and `code_verifier` in `sessionStorage`, and redirect the browser to the Cognito authorize endpoint with `response_type=code`, the client ID, the redirect URI, the scopes `openid`, `email` and `profile`, the `state` and the `code_challenge`.
2. WHEN the browser returns to `/auth/callback` with `code` and `state` and the `state` equals the stored value, THE Auth_Module SHALL exchange the `code` and `code_verifier` at the Cognito token endpoint and SHALL remove the stored `state` and `code_verifier` once the exchange request has been sent.
3. IF the callback `state` is missing or differs from the stored value, THEN THE Auth_Module SHALL send no token request, clear stored auth values and navigate to `/auth/error` with the reason "state mismatch".
4. IF the callback contains an `error` parameter, or the token request fails, or the token endpoint does not respond within 10 seconds, THEN THE Auth_Module SHALL clear stored auth values, navigate to `/auth/error` and show a message that names the failure class (access denied, token exchange failed, network failure) and SHALL NOT display the raw `error_description` value or any token.
5. WHEN token exchange succeeds, THE Auth_Module SHALL hold the Access_Token in memory only, SHALL NOT write the Access_Token or the ID token to `localStorage`, and SHALL navigate to the route the user requested before sign-in, or to `/dashboard` when none exists.
6. WHERE the Cognito token response includes a Refresh_Token, THE Auth_Module SHALL store it in `sessionStorage` so that a page reload within the same browser tab restores the Session without a new sign-in.
7. WHEN the Access_Token expires within the next 60 seconds and a Refresh_Token exists, THE Auth_Module SHALL request a new Access_Token from the Cognito token endpoint with the `refresh_token` grant, SHALL start at most one renewal request at a time, and SHALL make no more than 1 attempt per renewal.
8. IF a token renewal fails or receives no response within 10 seconds, THEN THE Auth_Module SHALL clear the Session and navigate to `/` with the notice "Your session has expired. Sign in again."
9. WHEN the user selects sign-out, THE Auth_Module SHALL clear the in-memory tokens and the `sessionStorage` auth values, clear all cached API data, and redirect the browser to the Cognito `/logout` endpoint with the client ID and the logout URI, which returns the browser to `/signed-out`.
10. THE `/signed-out` page SHALL show a confirmation that the user signed out and a control that starts sign-in again.
11. THE Auth_Module SHALL send only the Access_Token to the Backend and SHALL NOT send the ID token to the Backend.
12. THE Auth_Module SHALL NOT trust any role or identity value decoded from a token in order to grant access, and SHALL obtain the Role and Permissions only from `GET /me`.
13. IF an authenticated user has no Role in the Principal, THEN THE Frontend SHALL show a page that states the account has no assigned role, explains that an administrator must add the user to a group, and offers only the sign-out control.
14. IF the browser reaches `/auth/callback` with no stored `state` and `code_verifier` (for example after a reload once they were removed), THEN THE Auth_Module SHALL send no token request and navigate to `/auth/error` with the reason "state mismatch".

### Requirement 4: Principal Loading and Route Protection

**User Story:** As a user, I want the application to know who I am and what I may do, so that I see only relevant screens.

#### Acceptance Criteria

1. WHEN a Session is established or restored, THE Frontend SHALL call `GET /me` before rendering any protected route and SHALL show a loading state until the call completes or 10 seconds elapse, whichever occurs first.
2. WHEN `GET /me` returns 200, THE Frontend SHALL store the Principal in memory only, without writing it to persistent browser storage, and SHALL use its `roles` and `permissions` for navigation and route protection.
3. IF a user without a Session opens a protected route, THEN THE Route_Guard SHALL save the requested path, redirect to `/`, and show the sign-in control.
4. IF `GET /me` returns 401, THEN THE Frontend SHALL attempt one token renewal (Requirement 3, criterion 7), and IF renewal fails or the retry returns 401, THEN THE Frontend SHALL clear the Session and navigate to `/` with the expired-session notice.
5. IF `GET /me` fails with a network error, 500 or 503, or does not complete within 10 seconds, THEN THE Frontend SHALL show an error state with a retry control, SHALL NOT render protected content, and SHALL retain the Session so that activating the retry control issues a new `GET /me` call.
6. WHEN the Principal's `email` is null and an ID token claim `email` is available in memory, THE Frontend SHALL display that claim as the user's email in the header menu and SHALL use it for display only.
7. WHERE the Principal's `email` is null and no ID token claim is available, THE Frontend SHALL show the username only and SHALL NOT show an empty email label.
8. THE Frontend SHALL treat Role checks in the Route_Guard as a usability aid.
9. IF the Backend returns 403 on any call, THEN THE Frontend SHALL show an error message indicating the user lacks permission, SHALL keep the Session, and SHALL keep the user on the current screen.

### Requirement 5: API Client and Error Handling

**User Story:** As a user, I want clear feedback when a request fails, so that I understand what happened and what to do next.

#### Acceptance Criteria

1. THE API_Client SHALL attach `Authorization: Bearer <Access_Token>` to every Backend request except `GET /health/*`.
2. WHEN the Backend returns an Error_Envelope, THE API_Client SHALL parse `code`, `message`, `details` and `request_id` into a typed error.
3. IF the Backend returns 401 for a protected call, THEN THE API_Client SHALL attempt one token renewal and replay the original request once after a successful renewal, and IF the token renewal fails or the replay returns 401 THEN THE Frontend SHALL end the Session as in Requirement 4, criterion 4.
4. IF the Backend returns 403 with code `FORBIDDEN`, THEN THE Frontend SHALL show an insufficient-permission message, SHALL NOT retry the request, and SHALL keep the Session active.
5. IF the Backend returns 422 with code `VALIDATION_ERROR` and `details.fields`, THEN THE Frontend SHALL show each field reason next to the matching form field, SHALL show the `message` at the top of the form for each entry it cannot match to a displayed form field, and SHALL keep the values the user entered in the form.
6. IF the Backend returns 502 `UPSTREAM_ERROR`, 504 `UPSTREAM_TIMEOUT` or 503 `SERVICE_UNAVAILABLE`, THEN THE Frontend SHALL show a message that states a data provider or service is temporarily unavailable, and SHALL show a retry control that sends the failed request again once each time the user activates it, without automatic retries.
7. IF the Backend returns 500 `INTERNAL_ERROR`, THEN THE Frontend SHALL show a generic error message and the `request_id` in selectable text so that the user can report it.
8. IF a request fails because the network is unreachable or the request times out in the browser, THEN THE Frontend SHALL show a connectivity message with a retry control that sends the failed request again once each time the user activates it, and SHALL keep previously shown data on screen with a visible "possibly outdated" indicator.
9. IF the Backend returns 413 `PAYLOAD_TOO_LARGE`, THEN THE Frontend SHALL show a message that the submitted content is too large and SHALL keep the values the user entered in the form.
10. IF the Backend returns 501 `NOT_IMPLEMENTED`, THEN THE Frontend SHALL show a message that the feature is not available in this version.
11. IF the Backend returns an error code that the Frontend does not recognise, or a non-success response whose body is not a valid Error_Envelope, THEN THE Frontend SHALL show the Backend `message` text when one is present or a generic error message when it is not, together with the `request_id` when one is present.
12. THE Frontend SHALL NOT display the `details` object of an error unless a requirement in this spec names the field, so that raw upstream text is not shown.
13. THE API_Client SHALL abort every request that receives no complete response within 30 seconds, except `POST /areas/{area_id}/observations/refresh`, which SHALL be aborted after 130 seconds, and SHALL treat an aborted request as a browser timeout under criterion 8.
14. THE Frontend SHALL request list endpoints with explicit integer `limit` (1 or greater) and `offset` (0 or greater) parameters and SHALL render the returned `total`, `limit` and `offset` in pagination controls.
15. IF a requested `limit` exceeds the Backend maximum for that endpoint (200 for general lists, 100 for `/admin/users`, `/admin/retrievals`, `/admin/activity`), THEN THE API_Client SHALL reduce the `limit` to that maximum before the request is sent.

### Requirement 6: Common States (Loading, Empty, Error) and Responsiveness

**User Story:** As a user, I want every screen to show loading, empty and error states consistently, so that I am never left with a blank screen.

#### Acceptance Criteria

1. WHILE a data request is pending, THE Frontend SHALL show a loading indicator or skeleton in the region that waits for the data, and SHALL set `aria-busy="true"` on that region within 100 ms of the request starting.
2. WHEN a list or collection request returns zero items, THE Frontend SHALL show an empty state that names the missing item type and, WHERE the user may fix it, a next action control (for example "Refresh observations").
3. IF a request fails, THEN THE Frontend SHALL show an error state inside the affected region only, with the message from Requirement 5 and a retry control, SHALL keep all other regions of the page interactive, and SHALL keep any data already displayed in other regions unchanged.
4. WHEN the user activates the retry control, THE Frontend SHALL repeat the failed request once, SHALL show the loading state from criterion 1 in that region until the request completes, and SHALL disable the retry control while the request is pending.
5. THE Frontend SHALL render each page without horizontal page scrolling at viewport widths from 320 px to 1920 px.
6. WHILE the Viewport_Class is mobile, THE Frontend SHALL show data tables as stacked cards or as horizontally scrollable tables inside their own container, and SHALL show the sidebar as a drawer.
7. THE Frontend SHALL provide interactive controls with a touch target of at least 44 by 44 CSS pixels on the mobile Viewport_Class.
8. WHEN a request succeeds after a prior failure in the same region, THE Frontend SHALL replace the error state with the data and SHALL remove the retry control within 100 ms of the response being received.

### Requirement 7: Researcher Dashboard

**User Story:** As a researcher, I want an overview of monitored areas and recent evidence, so that I can decide where to look first.

#### Acceptance Criteria

1. WHEN a researcher or admin opens `/dashboard`, THE Frontend SHALL call `GET /areas` with `status=active` and show the number of active areas (the `total` value) and a card for each area, up to 12 areas, with name, `area_ha` and `latest_observation_date`.
2. WHEN the dashboard shows an area card whose `latest_observation_date` is not null, THE Frontend SHALL call `GET /areas/{area_id}/ndvi/timeseries` for that area with `source` set to the source of the area's latest observation, limited to at most 6 concurrent calls, and SHALL show the latest mean NDVI, the `trend_per_30d` value and the number of points. Gap G2 applies.
3. IF the time-series response for an area has a summary whose `trend_per_30d` is null, THEN THE Frontend SHALL show "Not enough observations" in place of the trend and SHALL show the `INSUFFICIENT_OBSERVATIONS` warning text.
4. WHEN the dashboard has loaded the area cards, THE Frontend SHALL call `GET /areas/{area_id}/observations` with `limit=5` for the 6 areas with the most recent `latest_observation_date`, and SHALL show a merged "Recent observations" table of at most 10 rows sorted by date descending, each row with area name, date, source, mean NDVI, cloud coverage, data coverage and quality level. Gap G1 applies.
5. WHEN the dashboard shows a trend or a recent observation, THE Frontend SHALL show the Backend `quality.level` and Backend warnings as received and SHALL NOT compute a quality level in the browser.
6. WHEN the dashboard shows an area card, THE Frontend SHALL show a change indicator on it only if the user has run a comparison for that area in the current session, using the Backend `flag` of that comparison, and SHALL NOT compute a flag in the browser.
7. WHERE an area has no Observations (`latest_observation_date` is null), THE Frontend SHALL show "No observations yet" on its card and SHALL NOT call the time-series or observations endpoint for it.
8. IF a per-area call fails or does not respond within 30 seconds, THEN THE Frontend SHALL show an error indicator on that card only, SHALL keep the other cards and the data already shown, and SHALL NOT show partial values from the failed call.
9. THE Frontend SHALL show on the dashboard the statement that NDVI values are polygon-level aggregates and that flagged differences are for investigation, not conclusions.
10. WHEN the user selects an area card, THE Frontend SHALL navigate to `/areas/{area_id}`.
11. IF the `GET /areas` call fails or does not respond within 30 seconds, THEN THE Frontend SHALL show an error message indicating the area list could not be loaded, SHALL show no area cards or area count, and SHALL offer a retry action that repeats the call.
12. IF `GET /areas` with `status=active` returns `total` equal to 0, THEN THE Frontend SHALL show the active area count as 0 and an empty-state message indicating no active areas exist, and SHALL NOT call the time-series or observations endpoints.

### Requirement 8: Interactive Map

**User Story:** As a researcher, I want to see monitoring polygons on a map of Ghana, so that I can select an area and open its details.

#### Acceptance Criteria

1. WHEN a user opens `/map`, THE Map_View SHALL call `GET /areas/map` with `status=active`, render the returned GeoJSON FeatureCollection as a fill and outline layer, and fit the view to the bounds of all returned features, or to the bounds of Ghana when the collection contains zero features.
2. THE Map_View SHALL use a basemap that needs no API key or secret.
3. IF the basemap tiles fail to load within 10 seconds of the first tile request, THEN THE Map_View SHALL render the polygon layers on a plain background and SHALL show a notice that the basemap failed to load. Gap G5 applies.
4. THE Map_View SHALL show attribution text for the basemap in a corner of the map at every zoom level.
5. WHEN the user selects a polygon, THE Map_View SHALL highlight that polygon, replace any previously highlighted polygon, and open a details panel within 300 ms showing the area `name`, `area_ha` and `latest_observation_date` from the feature properties, and links to the area details, time series and comparison screens.
6. WHEN the user selects a polygon, THE Frontend SHALL call `GET /areas/{area_id}` and `GET /areas/{area_id}/observations` with `limit=10` and show up to 10 observations in the details panel, ordered newest first, each with source, date, mean NDVI and quality level.
7. IF `GET /areas/{area_id}` or `GET /areas/{area_id}/observations` fails, THEN THE Map_View SHALL keep the polygon selected and the feature-property fields visible, show an error indication with a retry control in the observations section of the details panel, and leave the map layers unchanged.
8. WHEN `GET /areas/{area_id}/observations` returns zero observations, THE Map_View SHALL show "No observations" in the observations section of the details panel.
9. WHEN the user selects the empty map background, THE Map_View SHALL clear the selection, remove the highlight and close the details panel.
10. THE Map_View SHALL provide zoom in, zoom out and reset-to-Ghana controls, each operable by mouse click, touch tap and keyboard (focusable with Tab, activated with Enter or Space). Reset-to-Ghana SHALL set the view to the bounds of Ghana.
11. THE Map_View SHALL show a legend that explains the polygon outline colours (default, selected) and, WHILE a Preview_Overlay is visible, the overlay opacity and the label "Low-resolution preview, for orientation only".
12. IF `GET /areas/map` fails, THEN THE Map_View SHALL show an error state with a retry control in place of the map data layer, and WHEN the user activates the retry control, THE Map_View SHALL repeat the request.
13. IF the map WebGL context cannot be created, THEN THE Frontend SHALL show a message that the browser does not support the map and SHALL offer a link to the area list at `/areas`.
14. WHERE a feature has `latest_observation_date` null, THE Map_View SHALL show "No observations" for the latest observation date of that area in the details panel.
15. THE Frontend SHALL provide a text alternative to the map: a visible link on the map page to the area list at `/areas`.
16. THE Map_View SHALL NOT draw a layer, colour or label that classifies an area as damaged, illegal or recovering.

### Requirement 9: Observation Visualisation and Preview Overlays

**User Story:** As a researcher, I want to see the satellite preview for an observation, so that I can orient myself, without mistaking it for detailed analysis.

#### Acceptance Criteria

1. WHEN a user views an observation in a list or details panel, THE Frontend SHALL show date, `source` (labelled "Sentinel-2" or "Landsat 8"), mean NDVI, and, for each of minimum, maximum, standard deviation and median that is not null, its value.
2. WHEN a user views an observation, THE Frontend SHALL show `cloud_coverage_pct` and `data_coverage_pct` as two separate values, each as a percentage from 0 to 100.
3. IF `data_coverage_pct` is null, THEN THE Frontend SHALL show "Not reported" in place of the value and SHALL show the `DATA_COVERAGE_UNKNOWN` warning text.
4. WHEN a user views an observation, THE Frontend SHALL show the Quality_Indicator `level` as a status badge with a text label (Good, Limited or Poor) in addition to colour, and SHALL list every warning of the Quality_Indicator, or show no warning list when there are none.
5. WHERE an observation has `geometry_status` equal to `stale_geometry`, THE Frontend SHALL show a badge "Geometry changed since retrieval" and the text that the values belong to an earlier polygon shape.
6. WHERE `preview.url` is not null, THE Frontend SHALL offer a control "Show preview". WHEN the user activates it, THE Frontend SHALL request the image through the Backend preview URL with the Access_Token, and SHALL draw it as an image layer at the bounding box of the area polygon. Gap G4 applies.
7. WHILE a Preview_Overlay is visible, THE Frontend SHALL show the `preview.note` text from the Backend, the image pixel size (`width_px` by `height_px`, or "unknown" for each null value), and an opacity control with a default of 70 percent, a range of 0 to 100 percent and steps of 1 percent.
8. WHILE a Preview_Overlay is visible, THE Frontend SHALL show the statement that the overlay position is approximate and is not used for analysis.
9. WHERE `preview.url` is null, THE Frontend SHALL show "No preview available" and SHALL NOT offer the preview control.
10. WHILE a preview request is pending, THE Frontend SHALL show a loading indicator beside the preview control and SHALL disable the control until the request completes.
11. IF the preview request returns 404, 502 or 504, THEN THE Frontend SHALL show the error message from Requirement 5 beside the preview control, SHALL leave the map unchanged, and SHALL keep the preview control available for a retry.
12. WHEN a user shows a Preview_Overlay while another is visible, THE Frontend SHALL remove the earlier one, so that at most one Preview_Overlay is visible at any time.
13. THE Frontend SHALL NOT request map tiles of satellite imagery or index rasters, because the Backend provides none.
14. WHEN the user removes a Preview_Overlay or leaves the page, THE Frontend SHALL release the image resource.

### Requirement 10: NDVI Time-Series Charts

**User Story:** As a researcher, I want an NDVI chart for one sensor over a date range, so that I can see how vegetation signals vary.

#### Acceptance Criteria

1. WHEN a user opens `/areas/:areaId/timeseries`, THE Time_Series_View SHALL show a source selector with the options Sentinel-2 and Landsat 8, a date-range selector (`date_from`, `date_to`), a cloud-coverage limit input accepting integers from 0 to 100, a weather toggle labelled "Show weather context", and a button that applies the filters.
2. WHEN the user activates the apply button with valid filters, THE Time_Series_View SHALL call `GET /areas/{area_id}/ndvi/timeseries` with exactly one `source`, SHALL show a loading indicator until the response or an error arrives, and SHALL show exactly one chart per response.
3. IF the user has not chosen a source and the source of the latest observation of the area is known, THEN THE Time_Series_View SHALL preselect that source.
4. IF the user has not chosen a source and the source of the latest observation of the area is not known, THEN THE Time_Series_View SHALL show a message asking the user to choose a source and SHALL send no request until a source is chosen.
5. WHEN a response contains 1 or more points, THE Time_Series_View SHALL draw a Recharts line chart of `ndvi_mean` against `date`, with a visible marker on every observation point so that sampling gaps are visible, and SHALL NOT interpolate values between points beyond a straight connecting line.
6. THE Time_Series_View SHALL NOT draw Observations of two sources in one chart and SHALL NOT offer an option to merge sources.
7. WHEN the user hovers over or focuses a point, THE Time_Series_View SHALL show a tooltip with date, source, mean NDVI, cloud coverage, data coverage (or "Not reported"), quality level and the gap in days from the previous point (or "Not applicable" for the first point).
8. THE Time_Series_View SHALL style a point whose quality level is `poor` differently from other points by shape or outline, and SHALL list the legend meaning for every point style.
9. WHEN a response contains 1 or more points, THE Time_Series_View SHALL show a table of the same points below the chart, so that the data is available without the chart.
10. WHEN a response is received, THE Time_Series_View SHALL show the summary values `count`, `first_date`, `last_date`, `min`, `max`, `mean_of_means` and `trend_per_30d` as received, with the label "Linear trend (NDVI per 30 days)", and SHALL show "Not available" for every null value.
11. WHEN a response contains warnings, THE Time_Series_View SHALL show every Backend warning in a Warning_Banner with a text per code (for example `IRREGULAR_SAMPLING` as "Observations are unevenly spaced; gaps exceed the threshold"), and SHALL show every `limitations` string from the response in a "Limitations" section that is visible without user interaction.
12. WHEN `meta.excluded_by_cloud` is greater than 0, THE Time_Series_View SHALL show it as "N observations excluded by the cloud filter", where N is the value.
13. WHEN a response is received, THE Time_Series_View SHALL show `meta.resolution_class` as the sensor resolution label.
14. WHEN the response contains 1 point, THE Time_Series_View SHALL show that point, SHALL show the `INSUFFICIENT_OBSERVATIONS` message, and SHALL NOT draw a trend value.
15. WHEN the response contains 0 points, THE Time_Series_View SHALL show an empty state, SHALL draw no chart, and SHALL show a "Refresh observations" action only to users who may refresh (Requirement 13).
16. WHERE `include_weather=true`, WHEN a point has non-null `weather`, THE Time_Series_View SHALL show the weather values with their units, the provider name, the covered period and the `note` text in the tooltip and table, and SHALL NOT present weather values as a causal explanation of NDVI.
17. WHEN the response contains `WEATHER_UNAVAILABLE`, `WEATHER_DISABLED` or `WEATHER_INVALID_DATA`, THE Time_Series_View SHALL show the NDVI data and a message for that warning code, and SHALL NOT show an error state.
18. IF `date_from` is later than `date_to`, or the range is longer than 3660 days, THEN THE Time_Series_View SHALL show an error on the date-range field before any request is sent, SHALL send no request, and SHALL keep the previously displayed chart and the entered filter values.
19. IF the Backend returns 404 for the area, THEN THE Time_Series_View SHALL show a not-found state with a link to `/areas`.
20. IF the request fails with a network error, a timeout after 30 seconds, or a Backend server error, THEN THE Time_Series_View SHALL show an error message with a retry action, SHALL keep the entered filter values, and SHALL NOT show a chart for the failed request.
21. THE Time_Series_View SHALL render the chart within its container at all Viewport_Classes with a minimum chart height of 240 px and no horizontal page scrolling caused by the chart.
22. WHEN a chart is drawn, THE Time_Series_View SHALL provide a text summary for screen readers that states the number of points, the first and last dates, and the source.

### Requirement 11: Date Comparison

**User Story:** As a researcher, I want to compare two observation dates, so that I can see whether the difference is flagged for investigation.

#### Acceptance Criteria

1. WHEN a user opens `/areas/:areaId/compare`, THE Comparison_View SHALL show a source selector, two date selectors that list only dates of stored observations of the chosen source, and an optional "Show weather context" toggle that is off by default.
2. WHEN the user submits two different dates, THE Comparison_View SHALL order them so that the earlier date is sent as `date_a` and the later date as `date_b`, and SHALL send `POST /areas/{area_id}/comparisons` with `source`, `date_a`, `date_b` and `include_weather`.
3. IF the two selected dates are equal, or either date is not selected, THEN THE Comparison_View SHALL show a field error on the affected selector, SHALL NOT send a request, and SHALL keep the current selections.
4. IF the Backend returns 422 with code `CROSS_SENSOR_COMPARISON`, THEN THE Comparison_View SHALL show a message that observations of different sensors cannot be compared and SHALL keep the current selections.
5. IF the Backend returns 404 `NOT_FOUND` for a date, THEN THE Comparison_View SHALL show a message that names the date with no stored observation and SHALL keep the current selections.
6. IF the request fails with a network error, a timeout after 30 seconds, or a Backend 5xx response, THEN THE Comparison_View SHALL show an error message with a retry control and SHALL keep the current selections.
7. WHEN the Backend returns 200, THE Comparison_View SHALL show both observations side by side with date, source, mean NDVI and median NDVI (each omitted when null), cloud coverage, data coverage and quality level, labelling the earlier date as date a and the later date as date b.
8. WHEN the Backend returns 200, THE Comparison_View SHALL show `ndvi_diff` (date b minus date a) with an explicit "+" or "-" sign and 4 decimals, `ndvi_diff_pct` with 2 decimals (or "Not defined" when null), `interval_days` in days, the `flag` as a badge with the text "Difference flagged for investigation" or "Difference below investigation threshold", and the `thresholds_applied` values.
9. WHEN the Backend returns 200, THE Comparison_View SHALL show the Backend `summary_text` unchanged, and WHERE `spatial_analysis_available` is false SHALL also show the statement "Spatial analysis is not available".
10. WHEN the Backend returns 200, THE Comparison_View SHALL show every entry of `warnings` in a Warning_Banner with fixed readable text per code (including `LOW_QUALITY_OBSERVATION`, `SEASONALITY_NOT_CONTROLLED`, `PERCENT_DIFFERENCE_UNDEFINED`, `WEATHER_UNAVAILABLE`), SHALL show the raw code for any code without defined text, and SHALL show every `limitations` string in a visible "Limitations" section.
11. WHEN the Backend returns 200, THE Comparison_View SHALL show the comparison `quality` level as a badge next to its warnings.
12. WHERE weather is present in the response, THE Comparison_View SHALL show the weather values for date a, date b and the interval between, each with units, provider, period and the `note` text.
13. THE Comparison_View SHALL NOT compute the difference, percentage, flag, quality or warnings in the browser.
14. THE Comparison_View SHALL NOT use the words "illegal mining", "deforestation", "destruction" or "recovery" in any text the Frontend itself authors, and SHALL NOT colour a positive or negative difference as good or bad. The sign indicator SHALL use a neutral colour ramp distinct from the status colours.
15. WHERE the user opens advanced options, THE Comparison_View SHALL allow optional threshold overrides for `ndvi_diff`, `max_cloud` and `min_data_coverage`, SHALL prefill them with values from `GET /settings`, SHALL label them as applying to this request only, and SHALL send only the overrides the user changed.
16. IF a threshold override is outside the range the Backend accepts (`ndvi_diff` 0.00 to 2.00, `max_cloud` and `min_data_coverage` 0 to 100) or is not a number, THEN THE Comparison_View SHALL show a field error before sending and SHALL NOT send a request. WHEN the Backend still returns 422, THE Comparison_View SHALL show its field messages next to the matching fields.
17. WHILE the request is pending, THE Comparison_View SHALL disable the submit control to prevent duplicate submissions and SHALL show a loading indicator.

### Requirement 12: Monitoring Area List and Details

**User Story:** As a researcher, I want to browse monitoring areas and their observation history, so that I can find an area and review its evidence.

#### Acceptance Criteria

1. WHEN a user opens `/areas`, THE Frontend SHALL call `GET /areas` and show a data table with name, area in hectares, status, latest observation date and a link to details, with pagination controls showing 20 rows per page.
2. WHEN the user stops typing in the name search for 300 ms, THE Frontend SHALL send the search text as parameter `q`, with a maximum of 100 characters.
3. THE `/areas` page SHALL provide a status filter with the values `active`, `archived` and `all`, with `active` as the default.
4. THE `/areas` page SHALL provide a bounding-box filter that accepts four numbers (min longitude, min latitude, max longitude, max latitude) entered manually, or taken from the current map extent of the Map_View.
5. IF the user enters an invalid bounding box (a non-numeric value, longitude outside -180 to 180, latitude outside -90 to 90, or a minimum value not less than its maximum), THEN THE Frontend SHALL show a field error before sending the request and SHALL NOT call the Backend.
6. IF the Backend returns 422 for a list request, THEN THE Frontend SHALL show the Backend message and keep the entered filter values.
7. IF `GET /areas` returns no rows, THEN THE Frontend SHALL show an empty state indicating that no areas match the filters, with an action to reset the filters.
8. WHEN a user opens `/areas/:areaId`, THE Frontend SHALL call `GET /areas/{area_id}` and show name, description, status, area in hectares, `created_at`, `updated_at`, `latest_observation_date`, and a small map with the polygon.
9. WHEN the user opens the observation history section of an area, THE Frontend SHALL call `GET /areas/{area_id}/observations` and show a table of observations with date, source, mean NDVI, cloud coverage, data coverage, quality level and a link to the preview, with filters for `source`, `date_from`, `date_to`, `max_cloud_coverage` and `min_data_coverage`, and 20 rows per page.
10. IF an observation filter value is invalid (`date_from` later than `date_to`, or `max_cloud_coverage` or `min_data_coverage` not a number from 0 to 100), THEN THE Frontend SHALL show a field error before sending the request and SHALL NOT call the Backend.
11. WHEN the user selects an observation row, THE Frontend SHALL call `GET /observations/{observation_id}` and show the details described in Requirement 9.
12. IF an area is archived, THEN THE Frontend SHALL show an "Archived" badge on the area and SHALL keep observation history and report links available.
13. IF the Backend returns 404 for an area or observation, THEN THE Frontend SHALL show a not-found state with a link back to the list.
14. THE area details page SHALL provide links to the time-series, comparison and "Create report" screens.

### Requirement 13: Observation Refresh

**User Story:** As a researcher, I want to refresh observations for an area and date range, so that the stored evidence is current.

#### Acceptance Criteria

1. WHEN the user opens the refresh dialog on an area page, THE Frontend SHALL show date inputs `date_from` and `date_to`, an optional source selection (Sentinel-2, Landsat 8, default both) and a confirm control.
2. IF `date_from` is after `date_to`, or `date_to` is in the future, or the range is longer than 366 days, or either date is empty or not a valid calendar date, THEN THE Frontend SHALL show a field error next to the offending input, SHALL NOT send a request and SHALL keep the entered values in the dialog.
3. WHEN the user confirms with valid inputs, THE Frontend SHALL send `POST /areas/{area_id}/observations/refresh` with `date_from`, `date_to` and `sources` (omitted when both sources are selected).
4. WHILE the refresh request is pending, THE Frontend SHALL show a progress indicator with the text that the retrieval can take up to two minutes, SHALL disable the confirm control so that no second request is sent, and SHALL keep the rest of the application usable. Gap G10 applies.
5. WHEN the Backend returns 200 with `status` `success`, THE Frontend SHALL show the counts `new`, `updated` and `skipped`, and SHALL invalidate the cached observation, area and time-series data of that area.
6. WHEN the Backend returns 200 with `status` `empty`, THE Frontend SHALL show that no observations were found for the range, with the counts `new`, `updated` and `skipped` shown as zero.
7. WHEN the Backend returns 200 with `status` `partial`, THE Frontend SHALL show the counts and a warning that the retrieval was incomplete, SHALL show each Backend warning, and SHALL invalidate the cached observation, area and time-series data of that area.
8. IF the Backend returns 409 `REFRESH_IN_PROGRESS`, THEN THE Frontend SHALL show a message that another refresh is running for this area, SHALL offer a control to try again later that closes the dialog, and SHALL keep the cached data unchanged.
9. IF the Backend returns 502 `UPSTREAM_ERROR` or 504 `UPSTREAM_TIMEOUT`, THEN THE Frontend SHALL show the provider-unavailable message of Requirement 5, criterion 6, SHALL state that previously stored observations are unchanged, and SHALL re-enable the confirm control.
10. IF the browser request exceeds 130 seconds, THEN THE Frontend SHALL abort the request, SHALL show a timeout message that states the retrieval result is unknown and advises to check the retrieval history (Admin) or to reload the observation list, and SHALL re-enable the confirm control.
11. WHERE the Backend returns a `retrieval_id`, THE Frontend SHALL show it in the result so that an admin can find it in the retrieval history.

### Requirement 14: Monitoring Area Management (Admin)

**User Story:** As an admin, I want to create, edit, archive and restore monitoring areas, so that observations are tied to the right polygons.

#### Acceptance Criteria

1. WHEN an admin opens `/admin/areas`, THE Frontend SHALL show the area table with all statuses (`status=all`), and controls to create, edit, archive and restore an area.
2. WHEN an admin chooses to create an area, THE Frontend SHALL show a form with a name (1 to 100 characters), a description (optional, 0 to 1000 characters) and a geometry input that accepts GeoJSON text pasted into a text area or loaded from a `.geojson` or `.json` file of at most 1 MB, in which the geometry is a Polygon or MultiPolygon, a Feature that holds one, or a FeatureCollection with one feature that holds one. This minimal approach is chosen over map drawing because the Backend validates the geometry and the MVP needs no drawing library.
3. WHEN geometry text is entered or loaded, THE Frontend SHALL parse it as JSON, show a parse error with the position when parsing fails, and WHEN parsing succeeds SHALL show the polygon on a preview map within 2 seconds, with a coordinate order note "longitude, latitude (EPSG:4326)".
4. IF the geometry is not valid JSON, is not a Polygon or MultiPolygon, or has coordinates outside longitude -180 to 180 or latitude -90 to 90, THEN THE Frontend SHALL show an error identifying which check failed, SHALL NOT send the request, and SHALL keep the entered form values.
5. IF a loaded file is larger than 1 MB or has an extension other than `.geojson` or `.json`, THEN THE Frontend SHALL reject the file, show an error stating the size or type limit, and keep the existing geometry text unchanged.
6. THE Frontend SHALL NOT validate area size, self-intersection or containment in Ghana in the browser and SHALL rely on the Backend result.
7. WHEN the admin submits the form, THE Frontend SHALL send `POST /admin/areas` with `name`, `description` and `geometry`, and WHILE the request is pending SHALL disable the submit control and show a progress state, because the Backend registers the polygon with a provider.
8. IF the Backend returns 422 `GEOMETRY_OUTSIDE_GHANA`, THEN THE Frontend SHALL show that the polygon is not entirely within Ghana and keep the entered form values, and IF it returns `AREA_OUT_OF_RANGE` THEN THE Frontend SHALL show the Backend message that states the area limit, without a hard-coded limit value, and keep the entered form values. Gap G3 applies.
9. IF the Backend returns 409 `CONFLICT` for a duplicate name, THEN THE Frontend SHALL show a name field error and keep the entered form values.
10. IF the Backend returns 502 or 504 on create or update, THEN THE Frontend SHALL show that the provider registration failed and that the area was not saved, keep the entered form values, and re-enable the submit control.
11. WHEN the admin edits an area, THE Frontend SHALL send `PATCH /admin/areas/{area_id}` with only the changed fields among `name`, `description` and `geometry`, and IF no field has changed THEN THE Frontend SHALL keep the submit control disabled and send no request.
12. WHERE the admin changes the geometry, THE Frontend SHALL show before submit a confirmation that existing observations will be marked as belonging to the earlier geometry (`stale_geometry`) and that new data requires a refresh, and SHALL send the request only after the admin confirms.
13. WHEN the admin confirms archiving, THE Frontend SHALL send `POST /admin/areas/{area_id}/archive` and WHEN it succeeds SHALL show the area as archived. WHEN the admin restores an area, THE Frontend SHALL send `POST /admin/areas/{area_id}/restore` and WHEN it succeeds SHALL show the area as active.
14. IF an archive or restore request fails with a network error or a status of 500 or higher, THEN THE Frontend SHALL show an error stating the action failed and leave the area's displayed status unchanged.
15. IF restore returns 409, THEN THE Frontend SHALL show that an active area already uses the same name and leave the area's displayed status unchanged.
16. THE Frontend SHALL show the archive and restore actions, and the create and edit forms, only WHEN the Principal holds the `admin` Role.
17. WHEN an area write succeeds, THE Frontend SHALL invalidate cached area, map and dashboard data.

### Requirement 15: Reports

**User Story:** As a researcher, I want to generate and read evidence reports, so that I can share findings with the caveats attached.

#### Acceptance Criteria

1. WHEN a user opens the "Create report" form, THE Frontend SHALL show the area (fixed when opened from an area page, selectable otherwise), a source selector, `date_from` and `date_to` as calendar dates, an optional title of at most 200 characters, an optional list of at most 10 comparison date pairs (each pair sent with the earlier date first), and an "Include weather context" toggle that is off by default.
2. IF `date_from` is after `date_to`, or the range is longer than 5 years (1826 days), or a comparison pair has equal dates, or the title is longer than 200 characters, or more than 10 comparison pairs are entered, THEN THE Frontend SHALL show a field error next to the offending field, SHALL NOT send a request, and SHALL keep all entered values.
3. WHEN the user submits a valid form, THE Frontend SHALL send `POST /reports`, disable the submit control until the response arrives, and WHEN the Backend returns 201 SHALL navigate to `/reports/{report_id}`.
4. IF the Backend returns 422 `NO_OBSERVATIONS`, THEN THE Frontend SHALL show a message that no observations exist for the area, source and range, SHALL offer a link to refresh observations, and SHALL keep the form values.
5. IF the Backend returns 404 or 422 `VALIDATION_ERROR`, THEN THE Frontend SHALL show the messages according to Requirement 5 and SHALL keep the form values.
6. WHEN a user opens `/reports`, THE Frontend SHALL call `GET /reports` and show a table with title, area name, period, source, created time and creator, sorted by created time with the newest first, with pagination of 20 rows per page, and WHERE the user is an admin a filter by `created_by`, and for all users a filter by `area_id`. IF the result has no rows, THEN THE Frontend SHALL show an empty-state message instead of the table.
7. WHEN a user opens `/reports/:reportId`, THE Report_View SHALL call `GET /reports/{report_id}` with `format=json` and show title, creation time, author, area name, area in hectares, a map with the stored geometry, the period and the source.
8. THE Report_View SHALL show the stored observations in a table and in an NDVI line chart with the same rules as Requirement 10, criteria 5 to 8, using only the stored report content and sending no other data request.
9. THE Report_View SHALL show the stored `summary` fields, each stored comparison with its `flag`, `summary_text`, warnings and limitations as in Requirement 11, the `thresholds_applied` values and the stored `weather` where it is not null.
10. THE Report_View SHALL show every string of `caveats` and `limitations` in a visible section that is on screen without interaction, and SHALL include them in any printed or downloaded output.
11. THE Report_View SHALL provide a "Download JSON" control that saves the report JSON received from the Backend, unmodified, as a file named with the report ID, and a "Print" control that opens the browser print dialog with a print stylesheet that shows the report content, the caveats and the limitations, and hides navigation.
12. THE Report_View SHALL NOT offer a PDF control. IF `format=pdf` is requested and the Backend returns 501 `NOT_IMPLEMENTED`, THEN THE Frontend SHALL show the not-available message.
13. IF the Backend returns 404 for a report, THEN THE Frontend SHALL show a not-found state without revealing whether the report belongs to another user.
14. THE Report_View SHALL label the page with the report creation time and the statement that the report is a snapshot and does not change when data is refreshed.
15. IF a `POST /reports` or `GET /reports` request fails with a network error or a 5xx response, THEN THE Frontend SHALL show an error message with a retry control, SHALL NOT navigate away, and SHALL keep any entered form values.

### Requirement 16: Admin Overview

**User Story:** As an admin, I want one overview of system state, so that I can notice problems early.

#### Acceptance Criteria

1. WHEN an admin opens `/admin`, THE Frontend SHALL call `GET /admin/dashboard` and show cards for `areas_active`, `observations_total`, `reports_total`, the users per Role from `users_by_role`, and the retrieval counts per status from `retrievals_7d_by_status` with the label "Last 7 days".
2. WHEN an admin opens `/admin`, THE Frontend SHALL call `GET /admin/integrations/status` without `probe` and show, for AgroMonitoring and Weather, the values `configured`, `enabled`, `last_success_at`, `last_failure_at`, `failures_24h` and `last_error` (only when not null), with each status indicator carrying a text label in addition to any colour or icon.
3. WHEN the admin selects "Probe providers", THE Frontend SHALL call `GET /admin/integrations/status` with `probe=true`, disable the control until the response or an error arrives, and show the `probe.ok` outcome and `probe.latency_ms` in milliseconds for each provider.
4. IF the probe request fails or does not complete within 30 seconds, THEN THE Frontend SHALL re-enable the "Probe providers" control, show an error state in the integrations card only, and keep the previously shown non-probe values.
5. THE Frontend SHALL NOT show any API key or masked key in the Admin overview, because the Backend does not return one.
6. WHEN an admin opens `/admin`, THE Frontend SHALL call `GET /admin/retrievals` with `status=failed` and `limit=5` and show a "Recent failures" list of at most 5 entries, each with provider, area, time and the sanitised error code and message. IF the list is empty, THEN THE Frontend SHALL show an empty-state text.
7. WHEN an admin opens `/admin`, THE Frontend SHALL call `GET /admin/activity` with `limit=10` and show a "Recent activity" list of at most 10 entries, each with time, actor, action, target type and outcome. IF the list is empty, THEN THE Frontend SHALL show an empty-state text.
8. IF one of the Admin overview requests fails, THEN THE Frontend SHALL show an error state with a retry control in that card only, and keep the other cards and their data unchanged.
9. WHERE a count is zero, THE Frontend SHALL show the number 0 and not an empty value.

### Requirement 17: Admin User and Role Management

**User Story:** As an admin, I want to see users and change their roles, so that access stays controlled.

#### Acceptance Criteria

1. WHEN an admin opens `/admin/users`, THE Frontend SHALL call `GET /admin/users` and show a table with username, email (or "Not available" when null), roles, status and last seen time, with filters `role` and `q`, and pagination with a page size of 1 to 100 (default 25). Gap G8 applies.
2. IF `GET /admin/users` returns no users for the current filters, THEN THE Frontend SHALL show an empty-state message indicating that no users match, and SHALL keep the filters editable.
3. WHEN an admin selects a user, THE Frontend SHALL call `GET /admin/users/{sub}` and show the user details.
4. WHEN an admin opens the role editor for a user, THE Frontend SHALL show checkboxes for `admin` and `researcher` that reflect the current roles, and SHALL send `PUT /admin/users/{sub}/roles` with the selected `roles` on confirmation.
5. WHEN the admin confirms a role change, THE Frontend SHALL disable the confirm control until the Backend responds, so that at most one `PUT /admin/users/{sub}/roles` request is in flight per user.
6. WHEN the Backend returns 200, THE Frontend SHALL show the Backend `message` and the statement that the change takes effect after the user obtains a new token, and SHALL refresh the user row.
7. IF the Backend returns 501 `COGNITO_ADMIN_NOT_ENABLED`, THEN THE Frontend SHALL show that role changes are not enabled on this server, SHALL show how roles are changed in the Cognito console, and SHALL keep the user list readable.
8. IF the Backend returns 409 `SELF_ROLE_CHANGE`, THEN THE Frontend SHALL show that an admin cannot change their own role, and SHALL leave the displayed roles unchanged.
9. IF the Backend returns 409 `LAST_ADMIN`, THEN THE Frontend SHALL show that the last administrator cannot lose the admin role, and SHALL leave the displayed roles unchanged.
10. IF the Backend returns 404, 502 or 504 on a role change, THEN THE Frontend SHALL show an error message indicating whether the user was not found or the service was unavailable, SHALL leave the displayed roles unchanged, and SHALL keep the role editor open with the admin's selections retained.
11. WHERE the target user is the signed-in admin, THE Frontend SHALL disable the role editor and show the reason.
12. THE Frontend SHALL NOT offer user creation, password reset or deletion, because the Backend provides none.
13. THE Frontend SHALL NOT display any token, password or Cognito secret.

### Requirement 18: Admin Retrieval History and Activity

**User Story:** As an admin, I want to review retrieval attempts and audit events, so that I can find data problems and review actions.

#### Acceptance Criteria

1. WHEN an admin opens `/admin/retrievals`, THE Frontend SHALL call `GET /admin/retrievals` and show a table with provider, kind, area, requested range, status, item count, duration in milliseconds, start time and error, ordered as the Backend returns them, with a page size of 1 to 100 rows (default 25).
2. WHEN the Backend returns zero retrievals for the current filters, THE Frontend SHALL show an empty-state message in place of the table rows.
3. IF the `GET /admin/retrievals` or `GET /admin/activity` call fails or does not respond within 30 seconds, THEN THE Frontend SHALL show an error message with a retry control, SHALL keep the current filter values, and SHALL NOT show stale rows as current results.
4. THE Frontend SHALL show the status values `running`, `success`, `partial`, `empty` and `failed` as badges with text labels and distinct semantic colours.
5. THE retrievals page SHALL provide filters `provider`, `area_id`, `status`, `date_from` and `date_to`.
6. IF `date_from` is after `date_to`, THEN THE retrievals page SHALL show a field error on the date filters and SHALL NOT send the request.
7. WHERE a retrieval has an `error`, THE Frontend SHALL show `error.code` and `error.message` as received, and SHALL NOT show any other raw upstream text.
8. WHEN an admin opens `/admin/activity`, THE Frontend SHALL call `GET /admin/activity` and show a table with time, actor, action, target type, target ID, request ID and outcome (`success`, `failure`, `denied`), with filters `actor`, `action`, `date_from` and `date_to`, and a page size of 1 to 100 rows (default 25).
9. IF `date_from` is after `date_to` on the activity page, THEN THE Frontend SHALL show a field error on the date filters and SHALL NOT send the request.
10. THE Frontend SHALL show no control to edit or delete an audit event or a retrieval record.
11. WHERE the `details` of an audit event is shown, THE Frontend SHALL render it as read-only key-value text.

### Requirement 19: Application Settings

**User Story:** As an admin, I want to adjust thresholds, so that flags and quality levels match the project's needs without a redeploy.

#### Acceptance Criteria

1. WHEN an admin opens `/admin/settings`, THE Frontend SHALL call `GET /admin/settings` and show for each item the `key`, `value`, `type`, `default`, `min`, `max`, `updated_by` and `updated_at`.
2. WHEN the admin edits a value, THE Frontend SHALL use an input that matches the `type` (number for `integer` and `decimal`, switch for `boolean`) and SHALL show the allowed range as `min` to `max` next to the input.
3. IF a numeric value is less than `min`, greater than `max`, empty, or not a valid number of the item's `type` (a non-integer for `integer`), THEN THE Frontend SHALL show a field error within 200 ms of the edit, SHALL disable the save action for that item, and SHALL NOT send the request.
4. WHEN the admin saves a value, THE Frontend SHALL send `PUT /admin/settings/{key}` with `{ "value": ... }` and SHALL disable the save action for that item until the response arrives. WHEN the Backend returns 200, THE Frontend SHALL replace the displayed item with the returned record, including the new `updated_by` and `updated_at`.
5. IF the Backend returns 422, THEN THE Frontend SHALL show the constraint message returned by the Backend next to the field, SHALL keep the previously stored value displayed, and SHALL keep the admin's edited input available for correction.
6. IF the Backend returns 404 for a key, THEN THE Frontend SHALL show a message that the setting is unknown and SHALL reload the list from `GET /admin/settings`.
7. IF the Backend returns 500 on a settings update, or the request fails with no response within 30 seconds, THEN THE Frontend SHALL show a message that the update failed and that the previous value remains, and SHALL keep the previously stored value displayed.
8. THE Frontend SHALL show a description of at most 160 characters for each known key (`ndvi_diff_threshold`, `cloud_limit_pct`, `data_coverage_min_pct`, `gap_threshold_days`, `weather_enabled`, `default_page_size`) and SHALL show an unknown key with its name only.
9. THE Frontend SHALL NOT offer a way to enter a key that is not returned by the Backend, and SHALL NOT show or accept any secret, API key or credential as a setting.
10. WHEN a researcher opens a page that needs threshold values, THE Frontend SHALL use `GET /settings` (not `/admin/settings`) and SHALL treat a missing key as "not available" by showing the text "not available" in place of the value.
11. WHEN the Backend returns 200 for a setting save, THE Frontend SHALL invalidate cached `GET /settings` data and SHALL show a note that earlier stored reports are not changed.

### Requirement 20: Evidence Language and Scientific Honesty

**User Story:** As a project owner, I want every screen to present evidence without overclaiming, so that users do not misread the data.

#### Acceptance Criteria

1. THE Frontend SHALL NOT use the words "illegal mining", "illegal", "deforestation", "destruction", "destroyed", "recovery" or "recovered", matched case-insensitively, in any text, label, tooltip, colour legend or alt text that the Frontend authors, and an automated test SHALL scan the Frontend source text and the rendered text of every page and fail on one or more matches. Text returned by the Backend is excluded from this scan.
2. WHEN a result has the status `flagged`, THE Frontend SHALL show the label "Flagged for investigation" and SHALL present the result as a numeric difference above a threshold, showing both the difference value and the threshold value, and SHALL NOT present it as a finding.
3. THE Frontend SHALL show the text "NDVI values are polygon-level aggregates" on every screen that displays NDVI values, in a position visible without interaction.
4. THE Frontend SHALL show the Backend note that correlation does not imply causation, unchanged, on every screen that displays weather values, and SHALL NOT compute or display a correlation value.
5. THE Frontend SHALL show Sentinel-2 and Landsat 8 as separate datasets, each labelled with its sensor name, and SHALL NOT combine, average or overlay values from the two sensors in one chart or table row.
6. WHEN cloud coverage or data coverage is shown, THE Frontend SHALL show them as two separate labelled values, each as a percentage from 0 to 100.
7. THE Frontend SHALL show a Preview_Overlay only together with the low-resolution notice of Requirement 9, criterion 8.
8. THE Frontend SHALL NOT show any statement about the location, extent or shape of a change inside a polygon.
9. THE Frontend SHALL render Backend `summary_text`, `limitations`, `caveats` and warning messages character for character as received, without truncation, abbreviation or ellipsis, at any viewport width from 320 px upward.
10. THE Frontend SHALL keep a single module that maps each Backend warning code and error code to display text.
11. IF a Backend warning code or error code has no mapping in that module, THEN THE Frontend SHALL show the Backend `message` unchanged for that code. IF the Backend `message` is also absent or empty, THEN THE Frontend SHALL show a generic notice that the code is unrecognised, together with the code value.

### Requirement 21: Design System

**User Story:** As a user, I want a consistent, accessible interface in the Eco-Sentinel visual style, so that the platform is easy to read and use.

#### Acceptance Criteria

1. THE Frontend SHALL define the Design_Tokens as Tailwind theme values and CSS variables: Primary Emerald 700 `#047857`, Secondary Emerald 600 `#059669`, Dark accent Emerald 900 `#064E3B`, Light accent Emerald 100 `#D1FAE5`, Subtle background Green 50 `#F0FDF4`, Main background Slate 50 `#F8FAFC`, Surface `#FFFFFF`, Primary text Slate 900 `#0F172A`, Secondary text Slate 600 `#475569`, Border Slate 200 `#E2E8F0`.
2. THE Frontend SHALL use a light theme with the main background token, white surface cards with a subtle shadow (a single shadow level, blur radius at most 8 px, opacity at most 10%), and the emerald tokens for primary buttons, the active navigation item and selected states.
3. THE Frontend SHALL achieve a contrast ratio of at least 4.5:1 for body text (below 18 pt, or below 14 pt bold) and at least 3:1 for large text and interface component boundaries against their backgrounds.
4. WHEN the automated accessibility test (axe) runs on each main page (sign-in landing, dashboard, map, time-series, comparison, observation detail, error page and one admin page), THE Frontend SHALL produce zero violations of the WCAG 2.1 A and AA rules that axe checks.
5. THE Frontend SHALL show status with a text label or icon in addition to colour for observation quality (Good, Limited, Poor), flag status, retrieval status and integration status.
6. THE Frontend SHALL define distinct semantic status colours for success, warning, error and information, each differing from Primary Emerald 700 and Secondary Emerald 600, and SHALL use them only for status.
7. THE Frontend SHALL provide reusable components built with Tailwind and shadcn/ui for: button, navigation and sidebar, dashboard card, data table with pagination, form field and input, dialog, status badge, warning banner, chart container, map control and legend, and auth form (sign-in landing, error page).
8. THE Frontend SHALL show a focus ring of at least 2 px with a contrast of at least 3:1 against adjacent colours on every interactive element, and SHALL support operation by keyboard alone (Tab, Shift+Tab, Enter, Space, Escape, arrow keys) for navigation, tables, dialogs and form submission.
9. WHEN a dialog opens, THE Frontend SHALL move focus into the dialog and keep it there until the dialog closes. WHEN the dialog closes, THE Frontend SHALL return focus to the element that opened it.
10. THE Frontend SHALL use at most one gradient, which SHALL be a background gradient, and SHALL NOT use any animation or transition longer than 200 ms.
11. WHILE the user's system setting prefers reduced motion, THE Frontend SHALL NOT play any animation or transition.
12. THE NDVI chart and any NDVI-coloured layer SHALL use a sequential colour ramp that is perceptually ordered and distinguishable under protanopia, deuteranopia and tritanopia (a viridis-like ramp, not emerald-only), with a legend that shows the value range from -1 to 1 or the range of the displayed data, with minimum and maximum labelled.
13. THE map overlay colours SHALL differ from the basemap and from each other by a contrast ratio of at least 3:1, and the selected polygon SHALL be drawn with an outline at least 2 px thicker than unselected polygons.
14. THE Frontend SHALL load a system font stack and SHALL NOT request fonts or scripts from third-party hosts at run time. Basemap tile requests are the only permitted third-party requests.

### Requirement 22: Local Docker Development

**User Story:** As a developer, I want the Frontend in the Docker Compose stack, so that the whole platform starts with one command.

#### Acceptance Criteria

1. THE Compose_Stack SHALL define the `frontend` service with build context `./frontend`, on the same user-defined network as the Backend, with a bind mount of the `frontend` source directory.
2. WHEN `docker compose up` is run, THE `frontend` service SHALL serve the Vite development server with hot reload on container port 5173, published to `${BIND_ADDRESS:-127.0.0.1}:${FRONTEND_PORT:-5173}`, so that the port is bound to `127.0.0.1` by default, and the server SHALL respond to an HTTP GET of `/` within 60 seconds of container start.
3. WHERE file-change events from the bind mount are not delivered, THE Vite configuration SHALL support polling through an environment variable (`CHOKIDAR_USEPOLLING` or the Vite `server.watch.usePolling` option), documented in the README.
4. WHEN a source file under `frontend/src` is saved, THE `frontend` service SHALL reflect the change in the browser within 5 seconds, without a manual page reload, when file-change events are delivered or polling is enabled.
5. THE `frontend` service SHALL read the Public_Config variables from the root `.env` file, and the root `.env.example` SHALL list every `VITE_` variable with a placeholder value.
6. IF a required Public_Config variable is missing or empty, THEN THE `frontend` service SHALL fail to start with a non-zero exit code and a container log entry naming each missing variable, or SHALL render the configuration error page of Requirement 2, criterion 2, naming each missing variable.
7. THE `frontend` service SHALL write Vite and application build output to the container log, accessible with `docker compose logs -f frontend`.
8. THE Frontend SHALL provide a single documented command that runs the full test suite once inside the container (`docker compose exec frontend npm run test -- --run`) and exits with code 0 when all tests pass and non-zero when any test fails, and a documented command for linting and type checking that exits with code 0 when no errors are reported and non-zero otherwise.
9. THE repository documentation SHALL describe the commands to start, stop, rebuild, view logs and run tests for the `frontend` service.
10. THE repository documentation SHALL state the Cognito local settings, consistent with the Backend documentation: callback URL `http://localhost:5173/auth/callback`, sign-out URL `http://localhost:5173/signed-out`, allowed web origin `http://localhost:5173` (also the Backend `ALLOWED_ORIGINS` value), a public app client with no client secret, the Authorization code grant with the scopes `openid`, `email` and `profile`, and the groups `admin` and `researcher`.
11. THE Compose_Stack SHALL define the Backend service so that its `ALLOWED_ORIGINS` includes the Frontend origin built from `BIND_ADDRESS` and `FRONTEND_PORT` in `.env`, and `http://localhost:5173` when those variables are unset.
12. THE Frontend SHALL pin every direct and transitive dependency to an exact version in a committed lock file, and the `package.json` direct dependencies SHALL contain no version ranges.
13. THE Frontend SHALL declare TypeScript strict mode, and WHEN the test command runs, THE linter and the type checker SHALL report zero errors.

### Requirement 23: Testing

**User Story:** As a maintainer, I want an automated Frontend test suite, so that changes are verified without a live Backend or Cognito.

#### Acceptance Criteria

1. THE Frontend SHALL include Vitest and React Testing Library component tests for the status badge, warning banner, data table with pagination, form fields with Backend field errors, dialog, chart container and legend, each with at least one normal case and one empty or error case.
2. THE Frontend SHALL include authentication tests with a mocked Cognito token endpoint that cover: sign-in redirect URL contents (PKCE S256 challenge, state, scopes), successful callback, state mismatch, `error` callback parameter, token exchange failure, token renewal success, token renewal failure, sign-out redirect and absence of tokens in `localStorage`. Each failure case SHALL assert that no Session is created and that the user sees an error indication.
3. THE Frontend SHALL include route-protection tests that cover: no Session redirected to `/`, restored return path after sign-in, `GET /me` failing with 401, 500 and a network error, and a user with no role. Each case SHALL assert the final URL and the visible notice or error indication.
4. THE Frontend SHALL include role-based navigation tests that assert the exact set of navigation items and reachable routes for a researcher and for an admin, and that a researcher opening an `/admin` route is redirected with a notice.
5. THE Frontend SHALL include API integration tests that use MSW handlers built from the Backend contract and cover, for each endpoint group in the Backend Contract table, one success response and at least one error response from that group's error list.
6. THE Frontend SHALL include tests for the error-handling rules of Requirement 5: 401 with single renewal and replay (exactly one renewal request and exactly one replay of the original request), 403, 422 field errors, 502, 504, 503, 500 with `request_id` display, 413, 501, network failure, unknown error code, and the 130-second refresh timeout. The timeout test SHALL use fake timers and SHALL NOT wait in real time.
7. THE Frontend SHALL include UI interaction tests for: area search debounce, filter application, pagination, time-series source and date selection, comparison date ordering (earlier date sent as `date_a`), equal-date prevention, refresh dialog with success, empty, partial and 409 results, area creation with a pasted GeoJSON and Backend errors, role change with 409 and 501 results, and settings editing with 422. The debounce test SHALL assert that rapid input produces exactly one search request after the 300 ms debounce interval of Requirement 12, criterion 2.
8. THE Frontend SHALL include tests for scientific wording: a test that scans source text and rendered pages for the forbidden terms in Requirement 20, criterion 1, a test that a time-series chart is rendered with one source only, and a test that `summary_text`, `limitations` and `caveats` appear unchanged (character-for-character equal to the mocked Backend values).
9. THE Frontend SHALL include responsive layout tests at the widths 360 px, 768 px and 1280 px that assert: the sidebar is a drawer on mobile (width 360 px), tables do not overflow the page (document scroll width is not greater than viewport width), and the main content is reachable.
10. THE Frontend SHALL include tests for the empty states (zero areas, zero observations, fewer than 2 points, zero reports), the loading states and the error states of every page group. Each test SHALL assert the presence of the state's visible message or indicator and the absence of the normal content.
11. THE Frontend SHALL include a test that fails IF any module in `src` references an AgroMonitoring or Weather API host, or a variable whose name contains `SECRET` or `API_KEY`. The failure output SHALL name the offending file.
12. THE Frontend SHALL include tests for the map data handling (feature collection to layer sources, selection state, preview overlay add and remove) with the MapLibre library mocked, because a WebGL context is not available in the test environment. The overlay test SHALL assert that after removal no preview source or layer remains registered on the mocked map.
13. WHILE the test suite runs, THE Frontend test suite SHALL make no real network request, and IF a test sends an unmocked request THEN THE test SHALL fail with an error that names the URL.
14. THE Frontend SHALL include axe accessibility checks for the pages listed in Requirement 21, criterion 4, and each check SHALL fail IF axe reports one or more violations of any impact level.
15. WHEN the full test suite is run once in non-watch mode with no Backend and no Cognito reachable, THE Frontend test suite SHALL finish with exit code 0 IF all tests pass, and with a non-zero exit code IF any test fails.

### Requirement 24: Non-Functional Requirements

**User Story:** As a user, I want a responsive application, so that I can work efficiently.

#### Acceptance Criteria

1. WHEN a route is opened with cached data absent and a Backend that responds within 500 ms, THE Frontend SHALL show the first meaningful content of that route within 2 seconds on a desktop browser measured in the Compose_Stack, where first meaningful content is the route's page heading and at least one data element or an empty-state message.
2. WHEN the Frontend issues a GET request identical to a successful GET response received less than 30 seconds earlier, THE Frontend SHALL reuse the in-memory cached response and SHALL NOT send a new request, except for `GET /me`, which SHALL be fetched once per Session and again after each sign-in.
3. WHEN the user leaves a page, THE Frontend SHALL cancel all in-flight requests started by that page within 100 ms and SHALL discard their responses without showing an error.
4. WHEN a user opens a route that needs the Admin_Area or the map library, THE Frontend SHALL load that code, and SHALL NOT load it before such a route is opened.
5. THE Frontend SHALL work without functional defects on the current and previous major versions of Chrome, Firefox, Safari and Edge on desktop.
6. WHILE a dashboard is loading, THE Frontend SHALL have at most 6 API requests in flight at the same time for that dashboard and SHALL queue the remaining requests until a slot is free.
7. WHEN a table of 200 rows is rendered on a desktop browser, THE Frontend SHALL complete the render in a main-thread task shorter than 200 ms.
