# Requirements Document

## Introduction

Eco-Sentinel Ghana is a satellite-based environmental monitoring platform for mining-affected areas of Ghana. This spec covers the BACKEND only. A second spec, `eco-sentinel-frontend`, will consume the API contract defined here.

The backend lets researchers and monitoring organisations manage monitoring areas, retrieve satellite observations and NDVI statistics from AgroMonitoring, add weather context, analyse NDVI trends, compare dates, and generate evidence-based reports. The backend presents evidence and highlights unusual changes. It does not classify any change as illegal mining, destruction or recovery.

### Repository Inspection Findings

The workspace `/Users/lusitech/Projects/Eco` was inspected at spec creation and is **empty**. It contains no Python scripts, no API experiments, no NDVI time-series JSON, no dependency files and no Weather API documentation. The home directory contains no files matching "agro", "ndvi" or "eco-sentinel" within four levels. Consequences:

- No validated integration code exists to reuse. The research results given in the brief (polygon creation, imagery, NDVI stats, preview images, Sentinel-2 and Landsat 8, historical imagery, time-series JSON) are taken as reported by the product owner. They are not independently verifiable from the repository.
- The exact AgroMonitoring endpoint paths, query parameters and response field names MUST be taken from the product owner's test scripts or the AgroMonitoring documentation during design. They are not specified here.
- No Weather API endpoint or field has been validated in the repository. Weather integration stays behind a provider interface until the provider, endpoints and fields are confirmed.

### Reference Data (reported, not repository-verified)

Test polygon "Eco-Sentinel Prestea Test", AgroMonitoring ID `6aea6f0f4e13cb67dafaf7d0`, about 123.36 ha. Sentinel-2 mean NDVI series:

| Date | Mean NDVI | Cloud coverage |
|---|---|---|
| 2026-01-25 | 0.5198 | 4.95% |
| 2026-03-06 | 0.5214 | 5.64% |
| 2026-03-16 | 0.5940 | 0.06% |
| 2026-03-21 | 0.5858 | 0.23% |
| 2026-03-31 | 0.6586 | 0.13% |
| 2026-04-15 | 0.6805 | 0% |
| 2026-04-22 | 0.6303 | 0% |
| 2026-04-30 | 0.6953 | 0% |

These are polygon-level aggregates. They do not prove illegal mining, destruction or recovery. This series is the seed for test fixtures and mocked integration responses.

### Technical Uncertainties (to resolve in design or by a spike)

- **U1**: Exact AgroMonitoring endpoints, parameters, response schemas, and error codes for polygons, imagery search, NDVI stats and NDVI history.
- **U2**: Whether AgroMonitoring exposes a separate data-coverage (valid-pixel) value distinct from cloud coverage, and under what field name. If not, data coverage is reported as unavailable.
- **U3**: Whether AgroMonitoring offers raster or tile endpoints with a resolution better than the 117x117 px preview images, and under what licence and plan limits. Advanced spatial analysis is out of the MVP until this is confirmed.
- **U4**: AgroMonitoring rate limits, polygon-count and area limits, and historical-depth limits of the account plan.
- **U5**: The Weather API provider, endpoints, fields, units, historical depth and rate limits.
- **U6**: Whether the NDVI scale and rendering are consistent between Sentinel-2 and Landsat 8 responses.
- **U7**: Cognito capabilities available for user and group management through the AWS SDK with the IAM permissions granted to the backend. Admin role management is limited to what the granted permissions allow.
- **U8**: Whether the initial admin is provisioned through the AWS console, the AWS CLI, or a documented bootstrap script.

## Glossary

- **Backend**: The FastAPI service that implements this spec.
- **API**: The versioned REST interface of the Backend, served under `/api/v1`.
- **Frontend**: The browser application defined in the `eco-sentinel-frontend` spec. The Frontend calls only the API.
- **Cognito**: AWS Cognito User Pools, the identity provider. Cognito resources are created manually by the developer and are not provisioned by this project.
- **Access_Token**: A Cognito JWT with `token_use` equal to `access`, presented as a Bearer token.
- **Token_Validator**: The Backend component that validates Cognito JWTs.
- **Role**: An application role derived from a Cognito group. The values are `admin` and `researcher`.
- **Admin**: A user holding the `admin` Role.
- **Researcher**: A user holding the `researcher` Role.
- **Authorization_Guard**: The Backend dependency that enforces the Role required by each protected operation.
- **Monitoring_Area**: A user-defined polygon in Ghana that is monitored, stored in PostGIS with SRID 4326.
- **Observation**: Metadata of one satellite acquisition for a Monitoring_Area: date, satellite source, cloud coverage, data coverage, NDVI statistics, and an external image reference.
- **Satellite_Source**: The sensor that produced an Observation, either `sentinel-2` or `landsat-8`.
- **NDVI_Stats**: Statistics of NDVI for one Observation: mean, minimum, maximum, standard deviation and median where the provider returns them.
- **Cloud_Coverage**: The percentage of the area obscured by cloud, as reported by the provider.
- **Data_Coverage**: The percentage of the Monitoring_Area with valid pixels. This is a separate metric from Cloud_Coverage.
- **Time_Series**: An ordered list of Observations of one Monitoring_Area and one Satellite_Source.
- **Comparison**: A stored or computed analysis of two Observations of one Monitoring_Area and one Satellite_Source.
- **Change_Summary**: The numeric NDVI difference of a Comparison, its flag status, and its caveats. It is not a classification of cause.
- **Threshold_Config**: The configurable parameters that decide whether a difference is flagged for investigation.
- **Quality_Indicator**: A per-Observation and per-Comparison data-quality assessment: Cloud_Coverage, Data_Coverage, temporal gap, and quality level (`good`, `limited`, `poor`).
- **Report**: A stored evidence document for a Monitoring_Area generated by the Backend.
- **Agro_Client**: The Backend component that calls AgroMonitoring.
- **Weather_Client**: The Backend component that calls the Weather API.
- **Weather_Context**: Weather values for an Observation date or period, used only as environmental context.
- **Retrieval_Record**: A stored record of one attempt to retrieve data from an external provider, with status and error details.
- **Audit_Event**: A stored record of a security-relevant or administrative action.
- **App_Setting**: A named, typed, application-level configuration value editable by an Admin.
- **Error_Envelope**: The JSON error body `{"error": {"code": string, "message": string, "details": object|null, "request_id": string}}`.
- **Health_Endpoint**: The `/health/live` and `/health/ready` operations.
- **Compose_Stack**: The Docker Compose environment with Frontend, Backend, PostgreSQL/PostGIS and pgAdmin.

## Requirements

### Requirement 1: API Structure and Conventions

**User Story:** As a frontend developer, I want a consistent, versioned REST API, so that I can build against it without guessing behaviour.

#### Acceptance Criteria

1. THE API SHALL serve all business operations under the path prefix `/api/v1`.
2. THE API SHALL publish an OpenAPI 3 document at `/api/v1/openapi.json` that describes every endpoint in the API Contract section.
3. THE API SHALL use JSON request and response bodies encoded as UTF-8, with dates in ISO 8601 format (`YYYY-MM-DD` for dates, UTC with `Z` suffix for timestamps).
4. THE API SHALL represent geometries as GeoJSON in WGS84 (EPSG:4326) with coordinate order longitude, latitude.
5. IF a request body or parameter fails schema validation, THEN THE API SHALL return HTTP 422 with an Error_Envelope that lists each invalid field by name together with a reason for its rejection, and SHALL leave server state unchanged.
6. IF an unhandled exception occurs, THEN THE API SHALL return HTTP 500 with an Error_Envelope that contains a `request_id` and no stack trace, secret or SQL text, and SHALL roll back any partial changes made by the failed request.
7. THE API SHALL return a `request_id` in the `X-Request-ID` response header for every response, including error responses.
8. WHEN a request contains an `X-Request-ID` header whose value is 1 to 128 characters long and consists only of letters, digits, hyphens and underscores, THE API SHALL return that same value in the `X-Request-ID` response header.
9. IF a request contains no `X-Request-ID` header or a value that does not meet the format in criterion 8, THEN THE API SHALL generate a new unique `request_id` and return it in the `X-Request-ID` response header.
10. WHEN a list endpoint is called, THE API SHALL support integer `limit` (default 50, minimum 1, maximum 200) and integer `offset` (default 0, minimum 0) parameters, and SHALL return `items`, `total` (the count of all matching records ignoring `limit` and `offset`), `limit` and `offset`.
11. IF `limit` is greater than 200 or less than 1, or `offset` is less than 0, or either is not an integer, THEN THE API SHALL return HTTP 422 with an Error_Envelope identifying the invalid parameter.
12. WHERE the allowed-origins setting is configured, THE API SHALL accept cross-origin requests only from the listed origins, and SHALL omit the `Access-Control-Allow-Origin` response header for requests from any other origin.

### Requirement 2: Authentication with Cognito

**User Story:** As a user, I want to sign in through Cognito, so that only authenticated people reach the platform.

#### Acceptance Criteria

1. WHEN a request to a protected operation carries a Bearer Access_Token, THE Token_Validator SHALL verify the signature against the Cognito JWKS, `iss` matching the configured Cognito user pool issuer, `client_id` matching the configured app client ID, `token_use` equal to `access`, and `exp` later than the current time.
2. IF the Authorization header is missing, is not of the form `Bearer <token>`, or the token fails any check in criterion 1, THEN THE API SHALL reject the request, return HTTP 401 with an Error_Envelope and a `WWW-Authenticate: Bearer` header, and not execute the protected operation.
3. WHEN a token carries a `kid` that is not in the cached JWKS, THE Token_Validator SHALL refresh the JWKS, limited to one refresh per 60 seconds.
4. THE Token_Validator SHALL keep the fetched JWKS in memory and reuse it for subsequent validations.
5. IF a token carries an unknown `kid` and a JWKS refresh is not permitted because the last refresh occurred less than 60 seconds earlier, THEN THE Token_Validator SHALL treat the token as failing criterion 1 without fetching the JWKS.
6. IF the JWKS cannot be fetched within 5 seconds, or the fetch returns an error, and no cached copy exists, THEN THE API SHALL return HTTP 503 with an Error_Envelope and not execute the protected operation.
7. IF a JWKS refresh fails and a cached copy exists, THEN THE Token_Validator SHALL continue to validate tokens against the cached copy.
8. WHEN a token is valid, THE API SHALL make the Cognito `sub`, username, email (only if present in the token), and Roles available to the handling operation.
9. WHEN a valid token carries a `sub` that has no local user record, THE API SHALL create exactly one local user record for that `sub` with the Roles from the token, before the handling operation runs.
10. IF a token carries a `token_use` value other than `access`, including an ID token, THEN THE API SHALL reject the request as specified in criterion 2.
11. THE Backend SHALL read the Cognito user pool ID, region, app client ID and JWKS cache settings from environment variables.
12. IF the user pool ID, region, or app client ID environment variable is missing or empty at startup, THEN THE Backend SHALL fail to start and report which variable is missing.
13. THE Backend SHALL perform token validation independently of the Frontend and SHALL NOT use any identity or Role claim supplied outside a validated token.

### Requirement 3: Role-Based Authorization

**User Story:** As an administrator, I want the backend to enforce roles on every protected operation, so that access does not depend on the frontend.

#### Acceptance Criteria

1. WHEN a request carries a validated token, THE Authorization_Guard SHALL derive Roles from the `cognito:groups` claim, mapping the group `admin` to Role `admin` and the group `researcher` to Role `researcher`, and SHALL ignore any group name other than `admin` and `researcher` (matched case-sensitively).
2. THE API SHALL declare exactly one required Role on every endpoint except the Health_Endpoint, and an automated test SHALL fail if any endpoint other than the Health_Endpoint lacks an authentication dependency or a declared required Role.
3. IF an authenticated user holds none of the Roles required by an operation, THEN THE API SHALL reject the request without executing the operation, SHALL return HTTP 403 with an Error_Envelope whose error indicates insufficient permissions, and SHALL leave stored data unchanged.
4. WHEN a user holds the `admin` Role, THE Authorization_Guard SHALL grant access to every operation that requires the `researcher` Role, in addition to all operations requiring the `admin` Role.
5. IF a valid token has a `cognito:groups` claim that is absent, empty, or contains only unrecognised groups, THEN THE API SHALL return HTTP 403 with an Error_Envelope for every protected operation except `GET /api/v1/me`.
6. WHEN a request is received, THE Authorization_Guard SHALL read Roles from that request's validated token and SHALL NOT reuse a Role decision from any previous request, so that a token with changed groups takes effect on its next request.
7. WHEN an authorization failure occurs, THE API SHALL record an Audit_Event containing the user `sub`, the requested endpoint, the HTTP method, the required Role and the UTC timestamp, within 5 seconds of the failure.
8. IF recording an Audit_Event fails, THEN THE API SHALL still return the HTTP 403 response with an Error_Envelope, and SHALL NOT grant access to the operation.

### Requirement 4: Monitoring Area Management

**User Story:** As a researcher, I want to view Ghana monitoring areas, and as an admin I want to manage them, so that observations are tied to known polygons.

#### Acceptance Criteria

1. WHEN an Admin submits a valid GeoJSON Polygon or MultiPolygon with a name of 1 to 100 characters, THE API SHALL store the Monitoring_Area in PostGIS with SRID 4326, set its status to `active`, and return HTTP 201 with the created Monitoring_Area including its id, name, area in hectares, and status.
2. IF a submitted geometry is not a Polygon or MultiPolygon, has fewer than 4 coordinates in a ring, has an unclosed ring, is self-intersecting, or has coordinates outside longitude -180 to 180 or latitude -90 to 90, THEN THE API SHALL return HTTP 422 with an error indicating which defect was found and SHALL NOT store the Monitoring_Area.
3. IF a submitted geometry does not lie entirely within the Ghana boundary configured for the Backend, THEN THE API SHALL return HTTP 422 with code `GEOMETRY_OUTSIDE_GHANA` and SHALL NOT store the Monitoring_Area.
4. WHEN a valid geometry is submitted, THE Backend SHALL compute the area in hectares using a geography-aware or projected calculation, round it to 2 decimal places, and store it with the Monitoring_Area.
5. IF the computed area is below the configured minimum or above the configured maximum (defaults 1 ha and 5000 ha, subject to the AgroMonitoring limits found in U4), THEN THE API SHALL return HTTP 422 with code `AREA_OUT_OF_RANGE` and SHALL NOT store the Monitoring_Area. An area exactly equal to the minimum or maximum SHALL be accepted.
6. WHEN a Monitoring_Area passes validation, THE Backend SHALL register the polygon with AgroMonitoring, store the returned external polygon ID, and complete registration within 10 seconds.
7. IF AgroMonitoring polygon registration fails or does not respond within 10 seconds, THEN THE Backend SHALL NOT persist the Monitoring_Area and SHALL return HTTP 502 with code `UPSTREAM_ERROR`.
8. WHEN an Admin deletes a Monitoring_Area, THE Backend SHALL set its status to `archived`, keep its stored Observations and Reports, and exclude it from default list results.
9. WHEN a user requests a Monitoring_Area list, THE API SHALL support filtering by `status`, by case-insensitive name substring, and by bounding box `bbox=minLon,minLat,maxLon,maxLat`, and SHALL return only Monitoring_Areas whose geometry intersects the bounding box when `bbox` is given.
10. IF the `bbox` parameter does not contain 4 numeric values, has minLon greater than maxLon or minLat greater than maxLat, or has values outside longitude -180 to 180 or latitude -90 to 90, THEN THE API SHALL return HTTP 422 identifying the invalid parameter.
11. WHEN a user requests the Monitoring_Area map data, THE API SHALL return a GeoJSON FeatureCollection of non-archived Monitoring_Areas whose features carry id, name, area in hectares, and the date of the latest Observation, with a null date when the Monitoring_Area has no Observations.
12. THE database SHALL hold a GiST spatial index on the Monitoring_Area geometry column.
13. IF a Monitoring_Area name duplicates an active Monitoring_Area name (case-insensitive), THEN THE API SHALL return HTTP 409 and SHALL NOT store the Monitoring_Area.

### Requirement 5: AgroMonitoring Integration

**User Story:** As a researcher, I want the backend to fetch satellite data reliably, so that I can rely on observations without calling providers myself.

#### Acceptance Criteria

1. THE Agro_Client SHALL read the AgroMonitoring API key from an environment variable and SHALL send it only in requests from the Backend to AgroMonitoring.
2. IF the AgroMonitoring API key environment variable is unset or empty, THEN THE Backend SHALL fail startup or reject the retrieval before any request is sent, with an error that names the missing variable and does not contain any key value.
3. THE Agro_Client SHALL apply a connect timeout and a read timeout, each configurable from 1 to 30 seconds, with defaults of 5 seconds and 30 seconds.
4. IF AgroMonitoring responds with HTTP 429, 502, 503 or 504 or the request times out, THEN THE Agro_Client SHALL retry up to 3 times, with a delay before retry n of min(2^(n-1) seconds, 30 seconds) plus random jitter between 0 and 1 second. When a `Retry-After` header is present, THE Agro_Client SHALL wait at least the stated delay, capped at 60 seconds.
5. IF AgroMonitoring responds with another 4xx status, THEN THE Agro_Client SHALL not retry and SHALL raise a typed error that carries the upstream status.
6. WHEN retries are exhausted, THE API SHALL return HTTP 502 for upstream failure or HTTP 504 for timeout, with an Error_Envelope that contains no credential and no upstream raw body. THE Backend SHALL retain any items already stored from earlier successful requests of the same retrieval.
7. THE Agro_Client SHALL normalise each provider response into internal schemas: Satellite_Source, acquisition date as UTC date (YYYY-MM-DD), Cloud_Coverage (percentage, 0 to 100), Data_Coverage (percentage, 0 to 100), NDVI_Stats and image references.
8. IF a provider response item lacks a required field, has an unparseable value, or has Cloud_Coverage or Data_Coverage outside 0 to 100, THEN THE Agro_Client SHALL discard that item, log one warning per discarded item with the Monitoring_Area ID and field name, and continue with the remaining items.
9. IF Data_Coverage is not provided by the provider, THEN THE Backend SHALL store it as null and expose it as `null`, and SHALL not substitute `100 - Cloud_Coverage`.
10. THE Agro_Client SHALL write log entries in which the API key value is replaced by a redaction marker or omitted, including URLs where the key appears in a query string.
11. THE Agro_Client SHALL enforce a configurable maximum number of concurrent in-flight requests (1 to 20) and a configurable maximum request rate (1 to 60 requests per minute), with defaults to be set in design from U4, so that one retrieval does not exhaust the provider quota.
12. WHEN a retrieval attempt ends, whether it succeeds, partially succeeds or fails, THE Backend SHALL record a Retrieval_Record with provider, Monitoring_Area, date range, status (success, partial or failed), item count (stored items), duration in milliseconds and sanitised error (null on success, and containing no credential or raw upstream body otherwise).
13. THE Backend SHALL expose the Agro_Client behind an interface so that tests substitute a mock without network access.

### Requirement 6: Satellite Observation Retrieval and Storage

**User Story:** As a researcher, I want observations of an area listed by date and sensor, so that I can explore the imagery history.

#### Acceptance Criteria

1. WHEN an Admin or Researcher requests a refresh of a Monitoring_Area for a date range, THE API SHALL retrieve Observations from AgroMonitoring for the range, store them, and return the count of new, updated and skipped Observations, where each Observation is counted in exactly one of the three categories and the three counts sum to the number of Observations retrieved.
2. IF the date range is longer than the configured maximum (default 366 days), has `start` after `end`, or ends in the future, THEN THE API SHALL return HTTP 422 with an error indicating which rule was violated, and SHALL NOT retrieve or store any Observations and SHALL NOT create a Retrieval_Record with status `running`.
3. THE Backend SHALL enforce uniqueness of Observation on Monitoring_Area, Satellite_Source and acquisition date.
4. WHEN a refresh is repeated for the same Monitoring_Area and range with unchanged provider data, THE Backend SHALL create zero new Observations, SHALL report zero new and zero updated Observations, and SHALL leave the stored Observation count unchanged.
5. THE Backend SHALL store Observation metadata, NDVI_Stats and external image URLs, and SHALL NOT store image binaries in the database.
6. WHEN a user lists Observations, THE API SHALL support filtering by `source`, `date_from` (inclusive), `date_to` (inclusive), `max_cloud_coverage` (0 to 100, inclusive upper bound) and `min_data_coverage` (0 to 100, inclusive lower bound), SHALL combine multiple filters with logical AND, and SHALL return results ordered by acquisition date descending.
7. IF a list filter value is outside its valid range, is not a valid date or number, or `date_from` is after `date_to`, THEN THE API SHALL return HTTP 422 with an error indicating the invalid filter and SHALL return no Observations.
8. THE API SHALL return Cloud_Coverage and Data_Coverage as separate numeric fields (percentage 0 to 100) on every Observation, and SHALL return null for a value the provider did not supply.
9. WHEN a user requests an Observation, THE API SHALL return its Quality_Indicator and, where available, preview image references.
10. IF a user requests an Observation that does not exist or does not belong to a Monitoring_Area the user may access, THEN THE API SHALL return HTTP 404 and no Observation data.
11. WHEN a preview image is requested, THE API SHALL return the stored provider reference, the image pixel size, and a statement that preview images (117x117 px in validated tests) are for visual orientation only.
12. IF the refresh returns zero Observations, THEN THE API SHALL return HTTP 200 with new, updated and skipped counts all equal to zero and SHALL record a Retrieval_Record with status `empty`.
13. IF a previous refresh for the same Monitoring_Area is still running, THEN THE API SHALL return HTTP 409 with code `REFRESH_IN_PROGRESS` and SHALL NOT start a second retrieval.
14. THE Backend SHALL treat each Satellite_Source as a separate dataset in storage, queries and analysis, and SHALL NOT merge or average Observations from different Satellite_Sources.
15. IF the retrieval for a range partially succeeds, THEN THE Backend SHALL keep the successfully stored Observations, SHALL mark the Retrieval_Record `partial`, and THE API SHALL return the counts of stored Observations together with an error indication that the retrieval was incomplete.
16. IF AgroMonitoring is unreachable or returns an error before any Observation is retrieved, THEN THE Backend SHALL mark the Retrieval_Record `failed`, SHALL leave previously stored Observations unchanged, and THE API SHALL return an error response indicating the provider failure.

### Requirement 7: NDVI Time Series

**User Story:** As a researcher, I want NDVI trends over time, so that I can see how vegetation signals vary.

#### Acceptance Criteria

1. WHEN a user requests a Time_Series with a Monitoring_Area, a Satellite_Source and a date range, THE API SHALL return the stored Observations whose date falls within the range (inclusive of start and end dates), ordered by date ascending, each with mean NDVI (range -1.0 to 1.0), Cloud_Coverage (0 to 100 percent), Data_Coverage (0 to 100 percent) and Quality_Indicator.
2. IF the `source` parameter is missing or is not a supported Satellite_Source, THEN THE API SHALL reject the request with a validation error identifying the `source` parameter and SHALL return no Observations.
3. THE API SHALL return Observations from exactly one Satellite_Source per response.
4. IF the date range has an end date before its start date, or spans more than 3,660 days, THEN THE API SHALL reject the request with a validation error identifying the date range and SHALL return no Observations.
5. IF the Monitoring_Area does not exist, THEN THE API SHALL return a not-found error identifying the Monitoring_Area and SHALL return no Observations.
6. WHERE `max_cloud_coverage` (a number from 0 to 100) is supplied, THE API SHALL exclude Observations whose Cloud_Coverage is greater than that value, SHALL include Observations equal to that value, and SHALL report the excluded count as an integer in the response `meta`.
7. IF `max_cloud_coverage` is supplied with a non-numeric value or a value outside 0 to 100, THEN THE API SHALL reject the request with a validation error identifying `max_cloud_coverage` and SHALL return no Observations.
8. WHEN a Time_Series contains fewer than 2 Observations after filtering, THE API SHALL return the available points (0 or 1), SHALL set every summary statistic field except count to null, and SHALL include the warning code `INSUFFICIENT_OBSERVATIONS`.
9. WHEN a Time_Series contains 2 or more Observations, THE API SHALL return for each point after the first the temporal gap in whole days since the preceding point, and SHALL return null for the first point.
10. IF any temporal gap exceeds the gap threshold (a positive integer number of days, default 30), THEN THE API SHALL include the warning code `IRREGULAR_SAMPLING` in the response.
11. WHEN a Time_Series contains 2 or more Observations, THE API SHALL return series summary statistics (count, first date, last date, minimum, maximum, mean of means, and linear trend slope in NDVI units per 30 days), computed only over points that pass the cloud filter, with NDVI values rounded to 4 decimal places.
12. THE API SHALL include in every Time_Series response, including those with 0 Observations, the limitations: values are polygon-level aggregates, seasonality is not removed, and weather is not controlled.
13. WHERE `include_weather=true` is supplied, THE API SHALL add Weather_Context to each point and SHALL label it as environmental context that does not establish causation.
14. IF the Weather_Client fails or does not respond within 10 seconds while `include_weather=true`, THEN THE API SHALL return the NDVI series with `weather` set to null and the warning code `WEATHER_UNAVAILABLE`, and SHALL leave the NDVI values and summary statistics unchanged.
15. FOR ALL Time_Series built from the reference table in the Introduction, THE API SHALL return mean NDVI values equal to the stored values at 4 decimal places, in ascending date order.
16. THE API SHALL read every Time_Series from stored Observations and SHALL NOT call AgroMonitoring during a Time_Series request; AgroMonitoring SHALL be called only by the refresh operation.

### Requirement 8: Date Comparisons and Change Summaries

**User Story:** As a researcher, I want to compare two observation dates, so that I can see whether the NDVI difference warrants investigation.

#### Acceptance Criteria

1. WHEN a user requests a Comparison with two Observation dates and one Satellite_Source for a Monitoring_Area, THE API SHALL return both NDVI_Stats, the absolute NDVI difference (later mean NDVI minus earlier mean NDVI, rounded to 4 decimal places), the percentage difference relative to the earlier mean NDVI (rounded to 2 decimal places), the interval in whole days, and a Change_Summary.
2. IF the earlier Observation mean NDVI is 0, THEN THE API SHALL return the percentage difference as null, SHALL include warning code `PERCENT_DIFFERENCE_UNDEFINED`, and SHALL still return all other Comparison fields.
3. IF the two Observations have different Satellite_Sources, THEN THE API SHALL return HTTP 422 with code `CROSS_SENSOR_COMPARISON` and SHALL not return a Comparison.
4. IF the two dates are equal, THEN THE API SHALL return HTTP 422 with an error code indicating equal dates and SHALL not return a Comparison.
5. IF an Observation is not stored for either date, THEN THE API SHALL return HTTP 404 with an error indicating which date has no stored Observation and SHALL not return a Comparison.
6. IF both the equal-date condition and the missing-Observation condition apply, THEN THE API SHALL return the HTTP 422 equal-dates error.
7. WHEN a Comparison is computed, THE Backend SHALL set flag status to `flagged` if the absolute mean NDVI difference is greater than or equal to the applied Threshold_Config value, and to `not_flagged` otherwise.
8. THE Threshold_Config SHALL provide a default mean-NDVI-difference threshold of 0.10 (valid range 0.00 to 2.00), a maximum acceptable Cloud_Coverage of 20% (valid range 0 to 100), and a minimum Data_Coverage of 80% (valid range 0 to 100), each changeable by an Admin through App_Settings.
9. IF an Admin submits a Threshold_Config value outside its valid range, THEN THE API SHALL reject the change with HTTP 422 and SHALL keep the previously stored values.
10. WHERE a request supplies a threshold override, THE API SHALL validate it against the ranges in criterion 8, apply it for that request only, leave stored Threshold_Config unchanged, and echo the applied threshold, cloud limit, and data-coverage limit values in the response.
11. IF a supplied threshold override is outside its valid range, THEN THE API SHALL return HTTP 422 and SHALL not return a Comparison.
12. IF either Observation has Cloud_Coverage greater than the cloud limit or Data_Coverage less than the data-coverage limit, THEN THE API SHALL set the Quality_Indicator of the Comparison to `poor` and SHALL include warning code `LOW_QUALITY_OBSERVATION`.
13. IF the interval in days is not within ±15 days of any positive multiple of 365 days (so intervals shorter than 350 days are always outside the window), THEN THE API SHALL include warning code `SEASONALITY_NOT_CONTROLLED`.
14. THE Change_Summary SHALL state that the result is a polygon-level aggregate, that no spatial change is inferred, and that the result does not identify the cause of any change.
15. THE Backend SHALL use the neutral wording "difference flagged for investigation" for flagged results and SHALL NOT include the terms "illegal mining", "deforestation", "destruction", or "recovery" (case-insensitive) in any Change_Summary or flag text.
16. WHERE `include_weather=true` is supplied, THE API SHALL add Weather_Context for both dates and for the interval between them, each labelled as context only.
17. IF Weather_Context is unavailable for a requested date or interval, THEN THE API SHALL return the Comparison without that Weather_Context and SHALL include warning code `WEATHER_UNAVAILABLE`.
18. FOR ALL pairs of Observations A and B of one Satellite_Source, comparing (A,B) and then (B,A) SHALL yield NDVI differences equal in magnitude and opposite in sign, with equal interval days and equal flag status.
19. WHEN the same inputs and thresholds are supplied, THE API SHALL return identical numeric values in the Comparison response (determinism).

### Requirement 9: Data Quality Indicators

**User Story:** As a researcher, I want data quality shown separately from NDVI values, so that I judge how reliable each observation is.

#### Acceptance Criteria

1. WHEN an Observation is stored or retrieved, THE Backend SHALL compute a Quality_Indicator for that Observation from its Cloud_Coverage (0 to 100%), its Data_Coverage (0 to 100% or null), the configured cloud limit and the configured minimum Data_Coverage.
2. WHEN the Backend computes a Quality_Indicator, THE Backend SHALL set the quality level to `poor` if Cloud_Coverage exceeds the configured cloud limit or Data_Coverage is not null and is below the configured minimum. Otherwise, THE Backend SHALL set it to `good` if Cloud_Coverage is at most 10% and (Data_Coverage is at least 90% or null). Otherwise, THE Backend SHALL set it to `limited`. The `poor` rule SHALL take precedence over `good` and `limited`.
3. IF Data_Coverage is null, THEN THE Backend SHALL include the warning code `DATA_COVERAGE_UNKNOWN` in the Quality_Indicator of that Observation and SHALL NOT use Data_Coverage to set the quality level to `poor`.
4. IF Cloud_Coverage is null or outside 0 to 100%, THEN THE Backend SHALL set the quality level to `poor`, SHALL include a warning code indicating invalid cloud coverage in the Quality_Indicator, and SHALL keep the Observation stored unchanged.
5. THE Backend SHALL store, calculate and return Cloud_Coverage and Data_Coverage as two separate values, and SHALL NOT combine them into a single value.
6. WHEN a response contains Observations from more than one Satellite_Source, THE API SHALL group the Observations by Satellite_Source and SHALL NOT merge, average or interpolate values across sources.
7. THE API SHALL include in the response `meta` the resolution class of each Satellite_Source present in the response, using the value configured in the Backend, and SHALL return the same value for the same Satellite_Source in every response.

### Requirement 10: Weather Context Integration

**User Story:** As a researcher, I want weather context beside NDVI, so that I can consider conditions without drawing causal claims.

#### Acceptance Criteria

1. THE Weather_Client SHALL read its API key and base URL from environment variables.
2. IF the API key or base URL environment variable is missing or empty at startup, THEN THE Weather_Client SHALL treat the Weather API as not configured, SHALL not send any request to the provider, and SHALL not prevent the Backend from starting.
3. THE Weather_Client SHALL call only endpoints that the product owner has confirmed in the design phase (see U5) and SHALL not assume any endpoint or field.
4. THE Weather_Client SHALL apply the same timeout, retry, backoff and credential-redaction rules as Requirement 5 criteria 3 to 6 and 10.
5. WHEN the Weather_Client receives a provider response, THE Weather_Client SHALL normalise it to internal Weather_Context fields, each with an explicit unit.
6. IF a provider response is malformed, is missing a field required for a Weather_Context value, or contains a value in a unit that cannot be converted to the internal unit, THEN THE Weather_Client SHALL discard the affected value, SHALL return the remaining valid values, and THE API SHALL include a warning code identifying the invalid weather data in the response.
7. IF the Weather API is not configured or disabled in App_Settings, THEN THE API SHALL return `weather` as null with warning code `WEATHER_DISABLED` and SHALL not fail the request.
8. IF all weather requests still fail after the retries defined in Requirement 5, THEN THE API SHALL return `weather` as null with the warning code `WEATHER_UNAVAILABLE`, SHALL return the NDVI data unchanged, and SHALL not fail the request.
9. WHEN THE API returns a Weather_Context value, THE API SHALL label it with its provider name, the start and end dates of the period it covers, and the statement that correlation does not imply causation.
10. THE Backend SHALL not compute or return any weather-to-NDVI correlation coefficient or causal claim in the MVP.

### Requirement 11: Evidence-Based Reports

**User Story:** As a researcher, I want to generate a report for an area, so that I can share evidence with stakeholders.

#### Acceptance Criteria

1. WHEN an authenticated user submits a request to generate a Report with a Monitoring_Area ID, a Satellite_Source and a date range (start date and end date, inclusive, start date on or before end date, maximum span 5 years), THE API SHALL generate and store the Report and return HTTP 201 with the Report ID.
2. THE Report SHALL contain: Monitoring_Area name, ID and area in hectares, the geometry, report date range, generation timestamp (UTC) and author, Satellite_Source, the list of Observation dates, mean NDVI per Observation, Cloud_Coverage, Data_Coverage, Quality_Indicators, series summary, selected Comparisons with Change_Summaries, applied Threshold_Config and, WHERE Weather_Context is requested, Weather_Context.
3. THE Report SHALL contain a fixed caveats section that states: NDVI values are polygon-level aggregates; seasonality, rainfall and acquisition conditions affect NDVI; different sensors are not equivalent; cloud and data coverage limit reliability; preview images are low-resolution; and the platform does not determine the cause of any change. THE caveats text SHALL be identical in every Report.
4. THE Report SHALL store a snapshot of the data it presents, so that any later refresh, edit or deletion of Observations, Monitoring_Area geometry or Threshold_Config leaves the stored Report content unchanged.
5. WHEN a user retrieves a Report by ID, THE API SHALL return it as JSON.
6. WHERE `format=pdf` is requested on Report retrieval, THE API SHALL return a PDF rendering containing the same fields and values as the JSON Report.
7. IF the date range contains no Observations for the Monitoring_Area and Satellite_Source, THEN THE API SHALL return HTTP 422 with code `NO_OBSERVATIONS` and SHALL NOT store a Report.
8. IF the request has a missing or malformed field, a start date after the end date, a date range longer than 5 years, or an unsupported `format` value, THEN THE API SHALL return HTTP 422 with an error code identifying the invalid field and SHALL NOT store a Report.
9. WHEN a user lists Reports, THE API SHALL return only Reports created by that user if the user is a Researcher, and all Reports if the user is an Admin.
10. IF a Researcher requests a Report created by another user, or a Report ID that does not exist, THEN THE API SHALL return HTTP 404 with the same response body in both cases.
11. WHEN a Report is generated for a Time_Series of up to 100 Observations on the Compose_Stack, THE API SHALL complete generation and return the response within 10 seconds, measured at the 95th percentile over at least 20 runs.
12. WHERE the `format=pdf` option is not delivered in the MVP build, THE API SHALL return HTTP 501 with an error code indicating the format is not supported, and the JSON format SHALL remain available.

### Requirement 12: Admin — Users and Roles

**User Story:** As an admin, I want to see and manage users and roles, so that access stays controlled.

#### Acceptance Criteria

1. WHEN an Admin lists users, THE API SHALL return local user records, each containing `sub`, username, email, Roles, status and last-seen timestamp, in pages of at most 100 records with a default page size of 50.
2. IF a caller without the `admin` Role requests the user list or attempts a role-change operation, THEN THE API SHALL reject the request with an authorization error and SHALL leave all user and Role data unchanged.
3. WHERE the Backend holds Cognito admin permissions (U7), WHEN an Admin adds a user to or removes a user from the `admin` or `researcher` group, THE API SHALL apply the change in Cognito, SHALL return a success response, and SHALL record an Audit_Event containing the acting Admin's `sub`, the target user's `sub`, the group, the action (add or remove) and the timestamp.
4. IF a Cognito group change fails or does not complete within 10 seconds, THEN THE API SHALL return an error response indicating the change was not applied, SHALL leave the user's Roles unchanged, and SHALL record an Audit_Event of the failed attempt.
5. WHERE the Backend lacks Cognito admin permissions, THE API SHALL return HTTP 501 with code `COGNITO_ADMIN_NOT_ENABLED` for role-change operations, SHALL leave Roles unchanged, and SHALL keep read operations available.
6. IF an Admin attempts to remove the `admin` group from the last remaining Admin, THEN THE API SHALL return HTTP 409 and SHALL leave the user's Roles unchanged.
7. IF an Admin attempts to change their own Role, THEN THE API SHALL return HTTP 409 with code `SELF_ROLE_CHANGE` and SHALL leave the Role unchanged.
8. THE API SHALL not offer an operation that creates users with a self-selected Role, and SHALL ignore and reject any Role supplied in the request body of a non-admin operation without applying it.
9. THE Backend SHALL not include passwords, tokens or Cognito secrets in any API response, including error responses.
10. WHEN a role change succeeds, THE Backend SHALL apply the new Role to tokens the user obtains after the change, and THE API response SHALL include a message stating that the change takes effect after the user obtains a new token.

### Requirement 13: Admin — Monitoring, Retrieval and Integration Status

**User Story:** As an admin, I want to inspect retrieval history and integration health, so that I can find and fix data problems.

#### Acceptance Criteria

1. WHEN an Admin lists Retrieval_Records, THE API SHALL support filtering by provider, Monitoring_Area, status and an inclusive start-time date range, combinable with logical AND, and SHALL return results ordered by start time descending in pages of at most 100 records (default 25).
2. IF an Admin lists Retrieval_Records with an unknown filter value, a malformed date, or a date range whose start is after its end, THEN THE API SHALL reject the request with an error indicating the invalid filter and SHALL return no records.
3. WHEN an Admin requests integration status, THE API SHALL return for each of AgroMonitoring and the Weather API: configured (boolean), enabled (boolean), last success time (null if none), last failure time (null if none), last sanitised error (null if none, at most 500 characters), and count of failures in the last 24 hours (integer ≥ 0).
4. THE API SHALL NOT include API keys, or any part or masked form of them, in the integration status response.
5. WHEN an Admin requests integration status with `probe=true`, THE API SHALL perform exactly one lightweight provider call per provider, with a timeout of 10 seconds, and SHALL report for each provider the outcome (success, failure or timeout) and latency in milliseconds.
6. IF a probe call fails or times out, THEN THE API SHALL still return the integration status with the failed outcome and a sanitised error for that provider, and SHALL record the failure in the failure count.
7. WHEN an Admin lists Audit_Events, THE API SHALL support filtering by actor, action and an inclusive time range, combinable with logical AND, and SHALL return results ordered by time descending in pages of at most 100 events (default 25).
8. WHEN an Admin requests a dashboard summary, THE API SHALL return counts of active Monitoring_Areas, Observations, Reports, users per Role, and Retrieval_Records by status over the last 7 days (rolling 168 hours ending at request time), within 3 seconds.
9. THE API SHALL provide Admin Monitoring_Area operations to create, update name or description, archive, restore, and trigger refresh.
10. IF an Admin updates a Monitoring_Area geometry, THEN THE API SHALL apply the validation of Requirement 4, SHALL mark all existing Observations of that Monitoring_Area as `stale_geometry` without deleting them, and, if validation fails, SHALL reject the update with an error indicating the validation failure and leave the geometry and Observations unchanged.

### Requirement 14: Application Settings

**User Story:** As an admin, I want to manage app-level settings, so that I can tune thresholds and integrations without redeploying.

#### Acceptance Criteria

1. THE Backend SHALL store each App_Setting as a typed key-value record containing a default value, a data type (integer, decimal, or boolean), an allowed minimum and maximum (numeric types only), the last-modified user, and the last-modified timestamp.
2. WHEN an Admin submits a valid value for an allow-listed App_Setting, THE API SHALL persist the value, update the last-modified user and timestamp, and return the updated record within 2 seconds.
3. IF an Admin submits an App_Setting value that violates the setting's type or allowed range, THEN THE API SHALL return HTTP 422 with an error indicating the key and the violated constraint, and THE Backend SHALL keep the previous value and last-modified fields unchanged.
4. THE API SHALL expose only the following allow-listed keys: NDVI difference threshold, cloud-coverage limit, data-coverage minimum, time-series gap threshold, weather enabled, and default list page size.
5. IF a request reads or writes a key that is not on the allow-list, THEN THE API SHALL reject the request with an error indicating the key is unknown, and THE Backend SHALL leave all stored settings unchanged.
6. IF a request attempts to read or write a secret, API key, or database credential as an App_Setting, THEN THE API SHALL reject the request with an error indicating the key is not permitted, and THE Backend SHALL not store or return the value.
7. WHEN an App_Setting value changes, THE Backend SHALL record an Audit_Event containing the key, old value, new value, acting user, and timestamp, in the same transaction as the change.
8. IF recording the Audit_Event fails, THEN THE Backend SHALL roll back the setting change, keep the previous value, and THE API SHALL return an error indicating the update failed.
9. WHEN a Researcher reads settings, THE API SHALL return only the keys NDVI difference threshold, cloud-coverage limit, data-coverage minimum, time-series gap threshold, and default list page size, each with its current value, and SHALL omit weather enabled and all last-modified user fields.
10. IF a Researcher attempts to update an App_Setting, THEN THE API SHALL reject the request with an authorization error and THE Backend SHALL leave all stored settings unchanged.

### Requirement 15: Authenticated User Context

**User Story:** As a frontend developer, I want one endpoint that describes the signed-in user, so that the UI can adapt without re-implementing authorization.

#### Acceptance Criteria

1. WHEN an authenticated user calls `GET /api/v1/me`, THE API SHALL return a response containing `sub`, username, email, Roles (a list of zero or more role names), and permissions (a list of zero or more permission strings), within 500 ms at the 95th percentile.
2. WHEN the API derives permissions for the user, THE API SHALL return the deduplicated union of the permission strings mapped to each of the user's Roles, with no permission appearing more than once.
3. IF the authenticated user has no Roles, THEN THE API SHALL return HTTP 200 with an empty Roles list and an empty permissions list.
4. IF the user's token lacks an email claim, THEN THE API SHALL return HTTP 200 with the email field set to null.
5. THE API SHALL define all permission strings in a single Backend module, and THE API SHALL use those same definitions in endpoint guards, so that no permission string literal is declared outside that module.
6. IF the token is missing, malformed, expired, or has an invalid signature, THEN THE API SHALL return HTTP 401, SHALL NOT include any user data in the response body, and SHALL NOT change any stored state.

### Requirement 16: Persistence and Migrations

**User Story:** As a developer, I want a migrated PostGIS schema, so that environments are reproducible.

#### Acceptance Criteria

1. THE Backend SHALL define one SQLAlchemy model and one database table for each of the following entities: users, monitoring areas, observations, retrieval records, comparisons (optional cache), reports, app settings and audit events.
2. THE Backend SHALL manage all schema changes through Alembic migrations.
3. WHEN the automated test suite runs, THE Backend SHALL apply all Alembic migrations to an empty PostGIS database, AND the test SHALL fail IF the resulting schema differs from the SQLAlchemy models in any table, column, column type, nullability, index, foreign key, unique constraint or check constraint.
4. THE Backend SHALL enable the PostGIS extension in the first migration.
5. THE Backend SHALL define a foreign key from each child table to its parent table, a unique constraint on (Monitoring_Area, Satellite_Source, acquisition date), and check constraints requiring Cloud_Coverage and Data_Coverage to each be between 0 and 100 inclusive.
6. IF an insert or update violates a foreign key, unique constraint or check constraint, THEN THE Backend SHALL reject the write, roll back the transaction, leave existing rows unchanged, and return an error identifying the violated constraint type.
7. THE Backend SHALL store Observation metadata and NDVI_Stats only, and SHALL NOT store external raw responses, except for one raw-payload field per Retrieval_Record limited to 64 KB (65,536 bytes) and containing no credentials.
8. IF a raw payload exceeds 65,536 bytes, THEN THE Backend SHALL reject the payload, store the Retrieval_Record without the raw-payload field, and record an error indicating the size limit was exceeded.
9. WHEN a migration is applied downward by one revision and then upward again, THE Backend SHALL complete both steps without error AND SHALL retain all rows in the tables defined in this spec that are not dropped by that revision's downgrade, with row counts and column values unchanged.
10. THE Backend SHALL store all created and updated timestamp fields as timezone-aware values in UTC.

### Requirement 17: Security and Secrets

**User Story:** As a project owner, I want credentials kept on the backend, so that they are never exposed or committed.

#### Acceptance Criteria

1. THE Backend SHALL read all credentials (AgroMonitoring key, Weather key, database password, Cognito settings, optional AWS credentials) from environment variables and SHALL NOT contain any credential value in source-controlled files other than placeholder values in `.env.example`.
2. THE repository SHALL include a `.env.example` file that lists every environment variable the Backend reads, each with a placeholder value that is not a real credential, and a `.gitignore` entry that excludes `.env` files while keeping `.env.example` tracked.
3. IF a required environment variable is missing or empty at startup, THEN THE Backend SHALL terminate startup with a non-zero exit code within 10 seconds, SHALL NOT accept any requests, and SHALL log the names of all missing variables in a single message without logging any variable values.
4. THE API SHALL NOT include any credential or environment variable value in any response body or header, including error responses and OpenAPI examples.
5. THE Backend SHALL replace the value of each credential with the fixed text `[REDACTED]` in all log output, including API key values in query strings and the Authorization header value. This applies to logs for both inbound requests and outbound provider requests.
6. THE API SHALL NOT include the AgroMonitoring API key or the Weather API key in any URL or body returned to the Frontend, including image URLs.
7. IF a provider image URL contains an API key, THEN THE API SHALL return a Backend proxy URL for that image instead. WHEN the Frontend requests the proxy URL, THE Backend SHALL verify that the caller is authorized, SHALL fetch the image from the provider with the key server-side, and SHALL return the image content without the key.
8. IF an authorization check on a proxied image request fails, THEN THE API SHALL return an error response indicating the request is unauthorized, SHALL NOT contact the provider, and SHALL NOT include the provider URL or key in the response.
9. IF the request body size exceeds the configured maximum (default 1 MB, configurable from 1 KB to 10 MB), THEN THE API SHALL reject the request with an error response indicating the payload is too large, without processing the body.

### Requirement 18: Audit and Activity

**User Story:** As an admin, I want a record of significant actions, so that I can review system activity.

#### Acceptance Criteria

1. WHEN a Monitoring_Area is created, updated, archived or restored, a refresh is triggered, a Report is created, a role is changed, or an App_Setting is changed, THE Backend SHALL record one Audit_Event for that action within 5 seconds of the action completing.
2. IF a request fails authorization, THEN THE Backend SHALL record one Audit_Event with outcome "denied" within 5 seconds of the failure.
3. THE Audit_Event SHALL contain actor `sub`, action, target type, target ID, timestamp in UTC, request ID, and outcome with a value of "success", "failure" or "denied".
4. THE Audit_Event SHALL exclude credentials, tokens, and request bodies, and SHALL store only the target ID and the names of changed fields for update actions, except that App_Setting changes SHALL also store old and new values as defined in Requirement 14.
5. THE Backend SHALL make Audit_Events append-only, and SHALL expose no API operation that updates or deletes an Audit_Event.
6. IF an Audit_Event for a state-changing action cannot be persisted, THEN THE Backend SHALL return an error indicating the audit write failed, and SHALL roll back the action it describes, so that no audited action completes without an Audit_Event. Authorization-failure events follow Requirement 3 criterion 8.

### Requirement 19: Health Checks and Observability

**User Story:** As a developer, I want health checks and logs, so that Docker and operators can see service state.

#### Acceptance Criteria

1. WHEN a client sends `GET /health/live` without credentials while the Backend process is running, THE Health_Endpoint SHALL return HTTP 200 within 500 ms without requiring authentication.
2. WHEN a client sends `GET /health/ready` without credentials, AND the database accepts a connection within 2 seconds, AND the database migrations are at head, THE Health_Endpoint SHALL return HTTP 200 within 3 seconds without requiring authentication.
3. IF the database does not accept a connection within 2 seconds OR the database migrations are not at head, THEN THE Health_Endpoint SHALL return HTTP 503 for `GET /health/ready` within 3 seconds, with a response body that lists only the names of the failed checks and contains no connection strings, hostnames, credentials, or exception details.
4. THE Health_Endpoint SHALL complete `GET /health/live` and `GET /health/ready` without sending any request to an external provider.
5. WHEN the Backend starts, THE Backend SHALL write logs to standard output as one JSON object per line, using the log level from the environment variable `LOG_LEVEL`, and SHALL accept only the values DEBUG, INFO, WARNING, ERROR and CRITICAL, case-insensitively.
6. IF `LOG_LEVEL` is unset, THEN THE Backend SHALL use the level INFO.
7. IF `LOG_LEVEL` is set to a value outside DEBUG, INFO, WARNING, ERROR and CRITICAL, THEN THE Backend SHALL fail to start and write an error to standard output that names `LOG_LEVEL` as the invalid setting.
8. WHEN the Backend handles an HTTP request, THE Backend SHALL write at least one log entry for that request that includes a non-empty `request_id` field, and every log entry written while handling that request SHALL carry the same `request_id` value.

### Requirement 20: Local Docker Development

**User Story:** As a developer, I want to run the stack locally with Docker, so that anyone can reproduce the environment.

#### Acceptance Criteria

1. THE Compose_Stack SHALL define exactly four services (Frontend, Backend, PostgreSQL with PostGIS, and pgAdmin) attached to one user-defined Docker network, and every service SHALL be able to reach each other service by service name on that network.
2. THE Compose_Stack SHALL persist PostgreSQL data and pgAdmin data in named volumes, so that data written before `docker compose down` (without the volume-removal option) is still present after `docker compose up`.
3. THE Compose_Stack SHALL read all configuration values from an `.env` file, and THE repository SHALL include an `.env.example` listing every variable the Compose_Stack reads, with no real secrets as values.
4. IF a required variable is missing or empty in `.env`, THEN THE Compose_Stack SHALL fail to start and SHALL display an error naming the missing variable, with no containers started.
5. THE Compose_Stack SHALL define a health check for PostgreSQL and a health check for the Backend, each with an interval of 10 seconds, a timeout of 5 seconds, and a maximum of 5 consecutive failures before the service is reported unhealthy.
6. WHEN `docker compose up` is run, THE Compose_Stack SHALL start the Backend only after PostgreSQL reports healthy.
7. WHEN the Backend container starts, THE Backend SHALL run Alembic migrations to head before it accepts requests, unless the documented environment variable that disables automatic migration is set to its documented disabling value.
8. IF an Alembic migration fails at Backend startup, THEN THE Backend container SHALL exit with a non-zero exit code, SHALL write the failure cause to the container log, and SHALL NOT accept requests.
9. WHILE the Backend runs in development mode, THE Backend container SHALL mount the Backend source directory from the host with a bind mount and SHALL restart the application within 5 seconds after a source file change is saved.
10. THE repository documentation SHALL describe the command for each of these tasks: start, stop, rebuild, view logs, open a PostgreSQL shell, run migrations manually, and run the test suite inside the Backend container.
11. WHEN `docker compose up` is run on a machine with Docker installed and a completed `.env`, THE Compose_Stack SHALL report the Backend as healthy within 120 seconds, with no AWS deployment and no manual database steps.
12. THE repository documentation SHALL describe the Cognito local-development configuration: callback URLs, logout URLs, allowed origins, app client settings, group names, and the token validation variables, each with an example value.
13. THE repository documentation SHALL describe first-Admin provisioning as an existing Cognito administrator adding a user to the `admin` group through the AWS console or AWS CLI, and SHALL state that the API provides no public route that grants the `admin` Role.
14. THE Backend SHALL NOT create, modify, or delete Cognito resources at any time, including at startup; Admin role changes under Requirement 12 modify only group membership of existing users.
15. THE Compose_Stack SHALL bind every published port to `127.0.0.1` by default, and a request to a published port from another host on the network SHALL be refused unless the user overrides the bind address in `.env`.

### Requirement 21: Spatial Analysis Boundaries

**User Story:** As a researcher, I want the platform to be honest about spatial limits, so that I do not over-interpret low-resolution data.

#### Acceptance Criteria

1. THE Backend SHALL NOT produce any statement about the location, extent, shape or area of change in any response field derived from polygon-level aggregate NDVI.
2. WHEN an endpoint returns a Change_Summary, THE API SHALL include the field `spatial_analysis_available` with the boolean value `false` in 100% of Change_Summary responses, until a raster source with a confirmed resolution is adopted.
3. WHERE a raster source with a confirmed resolution finer than the 117x117 px preview is identified by the U3 investigation, THE Backend SHALL treat Rasterio-based raster processing as out of scope for this specification and SHALL NOT include any raster processing in the MVP.
4. WHEN the U3 investigation is completed, THE Backend project SHALL record in the design document the investigated raster sources, the confirmed resolution of each source (or a statement that resolution could not be confirmed), and the adopt or reject decision for each source.
5. THE Backend SHALL NOT label any Observation, Comparison or Monitoring_Area as illegal mining in any response field.
6. THE Backend SHALL NOT include any machine-learning or predictive component in the MVP.

### Requirement 22: Testing

**User Story:** As a maintainer, I want an automated test suite, so that changes are verified without live providers.

#### Acceptance Criteria

1. THE Backend SHALL include Pytest unit tests that cover validation rules, threshold logic, quality indicators, summary statistics and trend calculation, with at least one passing case and one failing or boundary case for each of these five areas.
2. THE Backend SHALL include integration tests that run against a PostGIS database and cover migrations (applying all migrations to an empty database and reverting them), spatial index presence, uniqueness constraint violations, and spatial queries that return the expected rows for a fixed fixture dataset.
3. THE Backend SHALL include external-API tests that use mocked HTTPX transports and cover these cases: success; timeout; 429 with a `Retry-After` header, where the test asserts the retry waits at least the header value; 5xx responses, where the test asserts retries stop at the maximum retry count defined in Requirement 5; 4xx responses other than 429, where the test asserts exactly one request is made; malformed payloads, where the test asserts a handled error rather than an unhandled exception; and empty results.
4. THE Backend SHALL include authentication tests that use locally generated test keys and cover these tokens: valid, expired, wrong-issuer, wrong-client, ID-token (used in place of an access token), bad-signature, unknown-`kid` and missing. The tests SHALL assert that the valid token is accepted and that each other token is rejected with the documented authentication-failure response.
5. THE Backend SHALL include authorization tests that call every non-health endpoint with no token, a Researcher token and an Admin token, and assert for each combination the status code documented for that endpoint. The tests SHALL fail if an endpoint is registered but not covered by the test matrix.
6. THE Backend SHALL include geospatial tests that cover invalid rings, self-intersection, polygons outside Ghana, polygons below the minimum and above the maximum area limits, and area calculation of a known reference polygon, where the calculated area is within 1% of the known value.
7. THE Backend SHALL include error-handling tests that assert the Error_Envelope shape for validation, authentication, authorization, not-found, upstream-failure and unexpected-error responses. The tests SHALL also assert that no configured secret value (such as credentials, tokens and signing keys) appears in any error response body or captured log output.
8. THE Backend SHALL include tests that use the reference NDVI series to verify observation ordering, summary values and comparison results. The tests SHALL also verify that a comparison across different sensors is refused, and that swapping the two inputs of a comparison produces the symmetric result defined in Requirement 8 criterion 18.
9. THE Backend SHALL include Hypothesis property-based tests, each run with at least 100 generated examples, that verify the following. Geometry validation never raises an unhandled exception and returns accept or reject for any generated polygon. Comparison results are symmetric when the inputs are swapped. Running refresh twice with identical input produces the same stored state as running it once (idempotent refresh).
10. THE Backend SHALL provide a single documented command that runs the full test suite inside the Backend container. WHILE the suite runs, THE Backend test suite SHALL make no outbound network connections and SHALL use no real credentials. IF any test attempts an outbound network connection, THEN THE test suite SHALL fail that test with an error identifying the attempt.

### Requirement 23: Non-Functional Requirements

**User Story:** As a project owner, I want measurable performance and reliability targets, so that the MVP is usable.

#### Acceptance Criteria

1. WHEN a client requests a read endpoint that serves stored data for a Monitoring_Area with up to 500 Observations, THE API SHALL respond within 500 ms at the 95th percentile, measured over at least 100 consecutive requests on the Compose_Stack with no other concurrent requests.
2. WHEN a client requests the map-data endpoint while the Monitoring_Area list holds up to 1000 areas, THE API SHALL respond within 1000 ms at the 95th percentile, measured over at least 100 consecutive requests on the Compose_Stack with no other concurrent requests.
3. WHILE an external provider is unavailable, THE API SHALL serve every operation that reads stored data with the same response content and the same 500 ms (single-area reads) or 1000 ms (map-data) 95th percentile limits as when the provider is available.
4. THE Backend SHALL apply a configured maximum wait of no more than 30 seconds to each individual request to an external provider.
5. IF a refresh request does not complete within 120 seconds, THEN THE API SHALL terminate the refresh, return an error response indicating a timeout, and retain all previously stored data unchanged.
6. THE Backend SHALL pin every direct and transitive dependency to an exact version in a committed lock file.
7. THE Backend SHALL declare type annotations on the parameters and return value of 100% of public functions.
8. WHEN the test command runs, THE Backend SHALL complete the configured linter and type checker with zero errors, and IF either reports one or more errors, THEN THE test command SHALL exit with a non-zero status.

## API Contract

All paths are relative to `/api/v1` unless stated. All endpoints except Health require `Authorization: Bearer <Cognito access token>`. Common errors on every protected endpoint: **401** unauthenticated, **403** missing role, **422** validation, **500** internal. Every error body is the Error_Envelope. Roles: **R** = Researcher or Admin, **A** = Admin only.

Common types:

- `Geometry`: GeoJSON Polygon or MultiPolygon, EPSG:4326.
- `Warning`: `{code: string, message: string}`.
- `Quality`: `{level: "good"|"limited"|"poor", cloud_coverage_pct: number, data_coverage_pct: number|null, warnings: Warning[]}`.
- `NdviStats`: `{mean: number, min: number|null, max: number|null, std: number|null, median: number|null}`.
- `Observation`: `{id: uuid, area_id: uuid, date: date, source: "sentinel-2"|"landsat-8", ndvi: NdviStats, quality: Quality, preview: {url: string|null, width_px: int|null, height_px: int|null}, geometry_status: "current"|"stale_geometry"}`.
- `Area`: `{id: uuid, name: string, description: string|null, status: "active"|"archived", area_ha: number, geometry: Geometry, external_polygon_id: string|null, latest_observation_date: date|null, created_at: timestamp, updated_at: timestamp}`.
- `Page<T>`: `{items: T[], total: int, limit: int, offset: int}`.
- `WeatherContext`: `{provider: string, period: {from: date, to: date}, values: object with explicit units, note: "Context only; correlation does not imply causation."}`.

### Health (no auth)

| Method | Path | Purpose | Success | Errors |
|---|---|---|---|---|
| GET | `/health/live` (root, not versioned) | Process liveness | 200 `{status: "ok"}` | none |
| GET | `/health/ready` (root, not versioned) | DB and migration readiness | 200 `{status: "ok", checks: {database: "ok", migrations: "ok"}}` | 503 `{status: "unavailable", failed: string[]}` |

### User context

| Method | Path | Role | Params / Body | Response | Errors |
|---|---|---|---|---|---|
| GET | `/me` | any authenticated (including no group) | none | 200 `{sub: string, username: string, email: string|null, roles: ("admin"\|"researcher")[], permissions: string[]}` | 401 |

### Monitoring areas

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/areas` | R | Query: `status` (active default, archived, all), `q`, `bbox`, `limit`, `offset` | 200 `Page<Area>` (geometry omitted unless `include_geometry=true`) | 422 bad bbox |
| GET | `/areas/map` | R | Query: `status`, `bbox` | 200 GeoJSON FeatureCollection; properties `{id, name, area_ha, latest_observation_date}` | 422 |
| GET | `/areas/{area_id}` | R | Path: uuid | 200 `Area` | 404 |

### Satellite observations

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/areas/{area_id}/observations` | R | Query: `source`, `date_from`, `date_to`, `max_cloud_coverage`, `min_data_coverage`, `limit`, `offset` | 200 `Page<Observation>` | 404 area, 422 |
| GET | `/observations/{observation_id}` | R | Path: uuid | 200 `Observation` | 404 |
| GET | `/observations/{observation_id}/preview` | R | none | 200 image bytes proxied by the Backend (key applied server-side), or 404 when no preview | 404, 502, 504 |
| POST | `/areas/{area_id}/observations/refresh` | R | Body: `{date_from: date, date_to: date, sources?: ("sentinel-2"\|"landsat-8")[]}` | 200 `{retrieval_id: uuid, status: "success"\|"partial"\|"empty", new: int, updated: int, skipped: int, warnings: Warning[]}` | 404, 409 `REFRESH_IN_PROGRESS`, 422, 502, 504 |

### NDVI time series

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/areas/{area_id}/ndvi/timeseries` | R | Query: `source` (required), `date_from`, `date_to`, `max_cloud_coverage`, `include_weather` (default false) | 200 `{area_id, source, points: [{date, ndvi_mean, cloud_coverage_pct, data_coverage_pct, quality, gap_days_from_previous: int|null, weather: WeatherContext|null}], summary: {count, first_date, last_date, min, max, mean_of_means, trend_per_30d} \| null, meta: {excluded_by_cloud: int, resolution_class: string}, warnings: Warning[], limitations: string[]}` | 404, 422 |

### Environmental comparisons

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| POST | `/areas/{area_id}/comparisons` | R | Body: `{source, date_a: date, date_b: date, thresholds?: {ndvi_diff?: number, max_cloud?: number, min_data_coverage?: number}, include_weather?: bool}` | 200 `{area_id, source, a: Observation, b: Observation, ndvi_diff: number, ndvi_diff_pct: number\|null, interval_days: int, flag: "flagged"\|"not_flagged", thresholds_applied: object, quality: Quality, spatial_analysis_available: false, summary_text: string, weather: {a, b, between}\|null, warnings: Warning[], limitations: string[]}` | 404 missing observation, 422 `CROSS_SENSOR_COMPARISON` or equal dates |

Comparisons are computed on demand and not persisted unless included in a Report.

### Environmental reports

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| POST | `/reports` | R | Body: `{area_id, source, date_from, date_to, comparisons?: [{date_a, date_b}], include_weather?: bool, title?: string}` | 201 `Report` | 404, 422 `NO_OBSERVATIONS` |
| GET | `/reports` | R (own) / A (all) | Query: `area_id`, `created_by` (admin only), `limit`, `offset` | 200 `Page<ReportSummary>` | 422 |
| GET | `/reports/{report_id}` | R (own) / A | Query: `format` = `json` (default) or `pdf` | 200 `Report` JSON or `application/pdf` | 404, 501 pdf not enabled |

`Report`: `{id, title, created_at, created_by: {sub, username}, area: {id, name, area_ha, geometry}, period: {from, to}, source, observations: [{date, ndvi_mean, cloud_coverage_pct, data_coverage_pct, quality}], summary, comparisons: [ComparisonResult], thresholds_applied, weather: object|null, caveats: string[], limitations: string[]}`.
`ReportSummary`: `{id, title, area_id, area_name, period, source, created_at, created_by}`.

### Application settings

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/settings` | R | none | 200 `{ndvi_diff_threshold, cloud_limit_pct, data_coverage_min_pct, default_page_size}` | none |
| GET | `/admin/settings` | A | none | 200 `{items: [{key, value, type, default, min, max, updated_by, updated_at}]}` | 403 |
| PUT | `/admin/settings/{key}` | A | Body: `{value}` | 200 updated setting | 404 unknown key, 422 |

### Admin: users

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/admin/users` | A | Query: `role`, `q`, `limit`, `offset` | 200 `Page<{sub, username, email, roles, status, last_seen_at}>` | 403 |
| GET | `/admin/users/{sub}` | A | none | 200 user | 404 |
| PUT | `/admin/users/{sub}/roles` | A | Body: `{roles: ("admin"\|"researcher")[]}` | 200 `{sub, roles, effective_after_next_login: true}` | 404, 409 `LAST_ADMIN` or `SELF_ROLE_CHANGE`, 501 `COGNITO_ADMIN_NOT_ENABLED`, 502 |

### Admin: monitoring areas

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| POST | `/admin/areas` | A | Body: `{name, description?, geometry}` | 201 `Area` | 409 duplicate name, 422 geometry codes, 502 |
| PATCH | `/admin/areas/{area_id}` | A | Body: `{name?, description?, geometry?}` | 200 `Area` | 404, 409, 422, 502 |
| POST | `/admin/areas/{area_id}/archive` | A | none | 200 `Area` | 404 |
| POST | `/admin/areas/{area_id}/restore` | A | none | 200 `Area` | 404, 409 duplicate name |

### Admin: observation and integration history

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/admin/retrievals` | A | Query: `provider`, `area_id`, `status`, `date_from`, `date_to`, `limit`, `offset` | 200 `Page<{id, provider, area_id, requested_range, status, item_count, duration_ms, started_at, error: {code, message}\|null}>` | 422 |
| GET | `/admin/integrations/status` | A | Query: `probe` (default false) | 200 `{agromonitoring: IntegrationStatus, weather: IntegrationStatus}` where `IntegrationStatus = {configured, enabled, last_success_at, last_failure_at, last_error, failures_24h, probe: {ok, latency_ms}\|null}` | 403, 504 on probe timeout reported inside `probe` |
| GET | `/admin/activity` | A | Query: `actor`, `action`, `date_from`, `date_to`, `limit`, `offset` | 200 `Page<AuditEvent>` | 422 |
| GET | `/admin/dashboard` | A | none | 200 `{areas_active, observations_total, reports_total, users_by_role, retrievals_7d_by_status}` | 403 |

### Error codes (stable identifiers)

`UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `GEOMETRY_OUTSIDE_GHANA`, `AREA_OUT_OF_RANGE`, `CROSS_SENSOR_COMPARISON`, `NO_OBSERVATIONS`, `REFRESH_IN_PROGRESS`, `LAST_ADMIN`, `SELF_ROLE_CHANGE`, `COGNITO_ADMIN_NOT_ENABLED`, `UPSTREAM_ERROR`, `UPSTREAM_TIMEOUT`, `NOT_IMPLEMENTED`, `INTERNAL_ERROR`.

### Warning codes (stable identifiers)

`INSUFFICIENT_OBSERVATIONS`, `IRREGULAR_SAMPLING`, `WEATHER_UNAVAILABLE`, `WEATHER_DISABLED`, `LOW_QUALITY_OBSERVATION`, `SEASONALITY_NOT_CONTROLLED`, `DATA_COVERAGE_UNKNOWN`.

## Out of Scope (MVP)

Machine learning, automated illegal-mining classification, predictive modelling, complex alerting, spatial or raster change detection, weather-NDVI correlation statistics, production AWS infrastructure, automatic Cognito provisioning, and creation of project steering files and hooks (planned for a later phase).
