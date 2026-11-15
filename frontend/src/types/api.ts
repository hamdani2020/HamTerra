/**
 * Types mirroring the Backend API contract (backend design.md, "API Contract"), including
 * the recorded differences: observation-list `meta`, report `warnings`, probe `outcome`.
 * MSW handlers are typed with these interfaces, so a contract change breaks compilation.
 */
import type { KnownErrorCode, KnownWarningCode } from "@/lib/messages";
import type { FlagStatus, QualityLevel } from "@/types/display";

export type { FlagStatus, KnownErrorCode, KnownWarningCode, QualityLevel };

export type Source = "sentinel-2" | "landsat-8";
export type Role = "admin" | "researcher";
export type GeometryStatus = "current" | "stale_geometry";
export type AreaStatus = "active" | "archived";
export type AreaStatusFilter = AreaStatus | "all";
export type RetrievalStatus = "running" | "success" | "partial" | "empty" | "failed";
export type RetrievalProvider = "agromonitoring" | "weather";
export type AuditOutcome = "success" | "failure" | "denied";

export interface Warning {
  code: string;
  message: string;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown> | null;
    request_id: string | null;
  };
}

export interface FieldError {
  field: string;
  reason: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Quality {
  level: QualityLevel;
  cloud_coverage_pct: number | null;
  data_coverage_pct: number | null;
  warnings: Warning[];
}

export interface NdviStats {
  mean: number;
  min: number | null;
  max: number | null;
  std: number | null;
  median: number | null;
}

export interface Preview {
  url: string | null;
  width_px: number | null;
  height_px: number | null;
  note: string;
}

export interface Observation {
  id: string;
  area_id: string;
  date: string;
  source: Source;
  ndvi: NdviStats;
  quality: Quality;
  preview: Preview;
  geometry_status: GeometryStatus;
}

/** `GET /areas/{id}/observations`: a page plus per-sensor metadata, never merged. */
export interface ObservationPage extends Page<Observation> {
  meta: {
    resolution_class: Partial<Record<Source, string>>;
    counts_by_source: Partial<Record<Source, number>>;
  };
}

export interface GeoJsonGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
}

export interface Area {
  id: string;
  name: string;
  description: string | null;
  status: AreaStatus;
  area_ha: number;
  geometry?: GeoJsonGeometry;
  external_polygon_id: string | null;
  latest_observation_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface AreaFeature {
  type: "Feature";
  id: string;
  geometry: GeoJsonGeometry;
  properties: {
    id: string;
    name: string;
    area_ha: number;
    latest_observation_date: string | null;
  };
}

export interface AreaFeatureCollection {
  type: "FeatureCollection";
  features: AreaFeature[];
}

export interface WeatherValue {
  value: number;
  unit: string;
}

export interface WeatherContext {
  provider: string;
  period: { from: string; to: string };
  values: Record<string, WeatherValue>;
  note: string;
}

export interface PrincipalMe {
  sub: string;
  username: string;
  email: string | null;
  roles: string[];
  permissions: string[];
}

export interface TimeSeriesPoint {
  date: string;
  ndvi_mean: number;
  cloud_coverage_pct: number | null;
  data_coverage_pct: number | null;
  quality: Quality;
  gap_days_from_previous: number | null;
  weather: WeatherContext | null;
}

export interface TimeSeriesSummary {
  count: number;
  first_date: string | null;
  last_date: string | null;
  min: number | null;
  max: number | null;
  mean_of_means: number | null;
  trend_per_30d: number | null;
}

export interface TimeSeriesResponse {
  area_id: string;
  source: Source;
  points: TimeSeriesPoint[];
  summary: TimeSeriesSummary;
  meta: { excluded_by_cloud: number; resolution_class: string };
  warnings: Warning[];
  limitations: string[];
}

export interface ThresholdsApplied {
  ndvi_diff: number;
  max_cloud: number;
  min_data_coverage: number;
}

export interface ComparisonRequest {
  source: Source;
  date_a: string;
  date_b: string;
  thresholds?: Partial<ThresholdsApplied>;
  include_weather: boolean;
}

export interface ComparisonResult {
  area_id: string;
  source: Source;
  a: Observation;
  b: Observation;
  ndvi_diff: number;
  ndvi_diff_pct: number | null;
  interval_days: number;
  flag: FlagStatus;
  thresholds_applied: ThresholdsApplied;
  quality: Quality;
  spatial_analysis_available: false;
  summary_text: string;
  weather: {
    a: WeatherContext | null;
    b: WeatherContext | null;
    between: WeatherContext | null;
  } | null;
  warnings: Warning[];
  limitations: string[];
}

export interface RefreshRequest {
  date_from: string;
  date_to: string;
  sources?: Source[];
}

export interface RefreshResult {
  retrieval_id: string;
  status: "success" | "partial" | "empty";
  new: number;
  updated: number;
  skipped: number;
  warnings: Warning[];
}

/** At most 10 comparison pairs (backend design, Differences item 10). */
export const MAX_REPORT_COMPARISONS = 10;

export interface ReportRequest {
  area_id: string;
  source: Source;
  date_from: string;
  date_to: string;
  title?: string;
  comparisons?: { date_a: string; date_b: string }[];
  include_weather: boolean;
}

export interface ReportAuthor {
  sub: string;
  username: string;
}

export interface ReportSummary {
  id: string;
  title: string;
  area_id: string;
  area_name: string;
  period: { from: string; to: string };
  source: Source;
  created_at: string;
  created_by: ReportAuthor;
}

export interface ReportObservation {
  date: string;
  ndvi_mean: number;
  cloud_coverage_pct: number | null;
  data_coverage_pct: number | null;
  quality: Quality;
}

export interface Report {
  id: string;
  title: string;
  created_at: string;
  created_by: ReportAuthor;
  area: { id: string; name: string; area_ha: number; geometry: GeoJsonGeometry };
  period: { from: string; to: string };
  source: Source;
  observations: ReportObservation[];
  summary: TimeSeriesSummary;
  comparisons: ComparisonResult[];
  thresholds_applied: ThresholdsApplied;
  weather: WeatherContext | null;
  /** Series and weather warnings (backend design, Differences item 8). */
  warnings: Warning[];
  caveats: string[];
  limitations: string[];
}

export type ReportFormat = "json" | "pdf";

export interface SettingItem {
  key: string;
  value: number | boolean;
  type: "integer" | "decimal" | "boolean";
  default: number | boolean;
  min: number | null;
  max: number | null;
  updated_by: string | null;
  updated_at: string | null;
}

export interface SettingList {
  items: SettingItem[];
}

export interface PublicSettings {
  ndvi_diff_threshold: number;
  cloud_limit_pct: number;
  data_coverage_min_pct: number;
  gap_threshold_days: number;
  default_page_size: number;
}

export interface AdminUser {
  sub: string;
  username: string;
  email: string | null;
  roles: string[];
  status: string;
  last_seen_at: string | null;
}

export interface RoleChangeResult {
  sub: string;
  roles: string[];
  effective_after_next_login: true;
  message: string;
}

export interface RetrievalRecord {
  id: string;
  provider: RetrievalProvider;
  kind: string;
  area_id: string | null;
  requested_range: { from: string | null; to: string | null } | null;
  status: RetrievalStatus;
  item_count: number;
  duration_ms: number | null;
  started_at: string;
  error: { code: string | null; message: string | null } | null;
}

export interface AuditEvent {
  id: string;
  occurred_at: string;
  actor_sub: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  request_id: string;
  outcome: AuditOutcome;
  details: Record<string, unknown>;
}

export interface IntegrationStatus {
  configured: boolean;
  enabled: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  failures_24h: number;
  /** `outcome` added by the Backend (Differences item 9). */
  probe: { ok: boolean; latency_ms: number; outcome: "success" | "failure" | "timeout" } | null;
}

export interface IntegrationsStatus {
  agromonitoring: IntegrationStatus;
  weather: IntegrationStatus;
}

export interface AdminDashboard {
  areas_active: number;
  observations_total: number;
  reports_total: number;
  users_by_role: Record<string, number>;
  retrievals_7d_by_status: Record<string, number>;
}

export interface HealthLive {
  status: "ok";
}

export interface HealthReady {
  status: "ok" | "unavailable";
  checks?: Record<string, string>;
  failed?: string[];
}

// Request parameter shapes.

export interface PageParams {
  limit?: number;
  offset?: number;
}

export interface AreaListParams extends PageParams {
  status?: AreaStatusFilter;
  q?: string;
  bbox?: string;
  include_geometry?: boolean;
}

export interface AreaMapParams {
  status?: AreaStatusFilter;
  bbox?: string;
}

export interface ObservationListParams extends PageParams {
  source?: Source;
  date_from?: string;
  date_to?: string;
  max_cloud_coverage?: number;
  min_data_coverage?: number;
}

export interface TimeSeriesParams {
  source: Source;
  date_from?: string;
  date_to?: string;
  max_cloud_coverage?: number;
  include_weather?: boolean;
}

export interface ReportListParams extends PageParams {
  area_id?: string;
  created_by?: string;
}

export interface AdminUserListParams extends PageParams {
  role?: Role;
  q?: string;
}

export interface RetrievalListParams extends PageParams {
  provider?: RetrievalProvider;
  area_id?: string;
  status?: RetrievalStatus;
  date_from?: string;
  date_to?: string;
}

export interface ActivityListParams extends PageParams {
  actor?: string;
  action?: string;
  date_from?: string;
  date_to?: string;
}

export interface AreaCreateRequest {
  name: string;
  description?: string | null;
  geometry: GeoJsonGeometry;
}

export interface AreaUpdateRequest {
  name?: string;
  description?: string | null;
  geometry?: GeoJsonGeometry;
}

/** Client-side model: a thrown error turned into display text (see `describeError`). */
export interface DisplayError {
  kind:
    | "unauthenticated"
    | "forbidden"
    | "validation"
    | "not_found"
    | "conflict"
    | "too_large"
    | "not_implemented"
    | "unavailable"
    | "internal"
    | "network"
    | "timeout"
    | "unknown";
  title: string;
  body: string;
  requestId?: string;
  retry: boolean;
}
