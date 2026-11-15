/**
 * Typed response factories built from `src/types/api.ts`, and the API base used by tests.
 * A contract change in the types breaks these factories at compile time.
 */
import type {
  AdminDashboard,
  AdminUser,
  Area,
  AreaFeatureCollection,
  AuditEvent,
  ComparisonResult,
  ErrorEnvelope,
  IntegrationsStatus,
  Observation,
  ObservationPage,
  Page,
  PrincipalMe,
  PublicSettings,
  RefreshResult,
  Report,
  ReportSummary,
  RetrievalRecord,
  RoleChangeResult,
  SettingItem,
  TimeSeriesResponse,
} from "@/types/api";

import { builder, testId } from "../factories";

export const API_ORIGIN = "http://localhost:8000";
export const API = `${API_ORIGIN}/api/v1`;

export function page<T>(items: T[], overrides: Partial<Page<T>> = {}): Page<T> {
  return { items, total: items.length, limit: 50, offset: 0, ...overrides };
}

export function envelope(
  code: string,
  message = "Backend message.",
  details: Record<string, unknown> = {},
  requestId = "req-test-1",
): ErrorEnvelope {
  return { error: { code, message, details, request_id: requestId } };
}

export const buildMe = builder<PrincipalMe>(() => ({
  sub: "sub-researcher",
  username: "researcher1",
  email: null,
  roles: ["researcher"],
  permissions: ["areas:read", "observations:read"],
}));

export const buildArea = builder<Area>(() => ({
  id: testId(),
  name: "Eco-Sentinel Prestea Test",
  description: null,
  status: "active",
  area_ha: 122.55,
  external_polygon_id: "6aea6f0f4e13cb67dafaf7d0",
  latest_observation_date: "2026-04-30",
  created_at: "2026-05-01T10:00:00Z",
  updated_at: "2026-05-01T10:00:00Z",
}));

export const buildAreaMap = (): AreaFeatureCollection => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "a1",
      geometry: { type: "Polygon", coordinates: [[[-2.14, 5.43], [-2.13, 5.43], [-2.13, 5.44], [-2.14, 5.43]]] },
      properties: { id: "a1", name: "Prestea", area_ha: 122.55, latest_observation_date: "2026-04-30" },
    },
  ],
});

export const buildObservation = builder<Observation>(() => ({
  id: testId(),
  area_id: "a1",
  date: "2026-04-30",
  source: "sentinel-2",
  ndvi: { mean: 0.6958, min: 0.37, max: 0.79, std: 0.05, median: 0.71 },
  quality: { level: "good", cloud_coverage_pct: 0, data_coverage_pct: 100, warnings: [] },
  preview: { url: null, width_px: null, height_px: null, note: "Preview images are for visual orientation only." },
  geometry_status: "current",
}));

export function buildObservationPage(items: Observation[] = [buildObservation()]): ObservationPage {
  return {
    ...page(items),
    meta: {
      resolution_class: { "sentinel-2": "10 m nominal sensor resolution" },
      counts_by_source: { "sentinel-2": items.length },
    },
  };
}

export const buildRefreshResult = builder<RefreshResult>(() => ({
  retrieval_id: testId(),
  status: "success",
  new: 2,
  updated: 0,
  skipped: 0,
  warnings: [],
}));

export const buildTimeSeries = builder<TimeSeriesResponse>(() => ({
  area_id: "a1",
  source: "sentinel-2",
  points: [],
  summary: { count: 0, first_date: null, last_date: null, min: null, max: null, mean_of_means: null, trend_per_30d: null },
  meta: { excluded_by_cloud: 0, resolution_class: "10 m nominal sensor resolution" },
  warnings: [{ code: "INSUFFICIENT_OBSERVATIONS", message: "Fewer than two observations are available." }],
  limitations: ["NDVI values are polygon-level aggregates."],
}));

export const buildComparison = builder<ComparisonResult>(() => ({
  area_id: "a1",
  source: "sentinel-2",
  a: buildObservation({ date: "2026-03-06" }),
  b: buildObservation({ date: "2026-04-30" }),
  ndvi_diff: 0.1739,
  ndvi_diff_pct: 33.35,
  interval_days: 55,
  flag: "flagged",
  thresholds_applied: { ndvi_diff: 0.1, max_cloud: 20, min_data_coverage: 80 },
  quality: { level: "good", cloud_coverage_pct: 5.64, data_coverage_pct: 100, warnings: [] },
  spatial_analysis_available: false,
  summary_text: "Difference flagged for investigation: mean NDVI changed by +0.1739.",
  weather: null,
  warnings: [{ code: "SEASONALITY_NOT_CONTROLLED", message: "Backend text." }],
  limitations: ["NDVI values are polygon-level aggregates."],
}));

export const buildReport = builder<Report>(() => ({
  id: testId(),
  title: "Prestea: sentinel-2 NDVI",
  created_at: "2026-05-01T10:00:00Z",
  created_by: { sub: "sub-researcher", username: "researcher1" },
  area: { id: "a1", name: "Prestea", area_ha: 122.55, geometry: { type: "Polygon", coordinates: [] } },
  period: { from: "2026-01-01", to: "2026-04-30" },
  source: "sentinel-2",
  observations: [],
  summary: buildTimeSeries().summary,
  comparisons: [],
  thresholds_applied: { ndvi_diff: 0.1, max_cloud: 20, min_data_coverage: 80 },
  weather: null,
  warnings: [],
  caveats: ["The platform does not determine the cause of any change."],
  limitations: ["NDVI values are polygon-level aggregates."],
}));

export const buildReportSummary = builder<ReportSummary>(() => ({
  id: testId(),
  title: "Prestea report",
  area_id: "a1",
  area_name: "Prestea",
  period: { from: "2026-01-01", to: "2026-04-30" },
  source: "sentinel-2",
  created_at: "2026-05-01T10:00:00Z",
  created_by: { sub: "sub-researcher", username: "researcher1" },
}));

export const buildPublicSettings = (): PublicSettings => ({
  ndvi_diff_threshold: 0.1,
  cloud_limit_pct: 20,
  data_coverage_min_pct: 80,
  gap_threshold_days: 30,
  default_page_size: 50,
});

export const buildSetting = builder<SettingItem>(() => ({
  key: "cloud_limit_pct",
  value: 20,
  type: "decimal",
  default: 20,
  min: 0,
  max: 100,
  updated_by: null,
  updated_at: "2026-05-01T10:00:00Z",
}));

export const buildAdminUser = builder<AdminUser>(() => ({
  sub: "sub-researcher",
  username: "researcher1",
  email: null,
  roles: ["researcher"],
  status: "active",
  last_seen_at: "2026-05-01T10:00:00Z",
}));

export const buildRoleChange = builder<RoleChangeResult>(() => ({
  sub: "sub-researcher",
  roles: ["admin", "researcher"],
  effective_after_next_login: true,
  message: "The change takes effect after the user obtains a new token.",
}));

export const buildRetrieval = builder<RetrievalRecord>(() => ({
  id: testId(),
  provider: "agromonitoring",
  kind: "refresh",
  area_id: "a1",
  requested_range: { from: "2026-01-01", to: "2026-04-30" },
  status: "success",
  item_count: 42,
  duration_ms: 3100,
  started_at: "2026-05-01T10:00:00Z",
  error: null,
}));

export const buildAuditEvent = builder<AuditEvent>(() => ({
  id: testId(),
  occurred_at: "2026-05-01T10:00:00Z",
  actor_sub: "sub-admin",
  action: "area.create",
  target_type: "area",
  target_id: "a1",
  request_id: "req-1",
  outcome: "success",
  details: { changed_fields: ["name"] },
}));

export const buildIntegrations = (): IntegrationsStatus => ({
  agromonitoring: {
    configured: true,
    enabled: true,
    last_success_at: "2026-05-01T10:00:00Z",
    last_failure_at: null,
    last_error: null,
    failures_24h: 0,
    probe: null,
  },
  weather: {
    configured: false,
    enabled: false,
    last_success_at: null,
    last_failure_at: null,
    last_error: null,
    failures_24h: 0,
    probe: null,
  },
});

export const buildDashboard = (): AdminDashboard => ({
  areas_active: 1,
  observations_total: 42,
  reports_total: 0,
  users_by_role: { admin: 1, researcher: 2 },
  retrievals_7d_by_status: { running: 0, success: 1, partial: 0, empty: 0, failed: 0 },
});
