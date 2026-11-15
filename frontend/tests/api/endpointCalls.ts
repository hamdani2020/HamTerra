import type { Endpoints } from "@/core/api/endpoints";

/** One sample call per endpoint function; a test checks the table covers every function. */
export const ENDPOINT_CALLS: Record<keyof Endpoints, (api: Endpoints) => Promise<unknown>> = {
  getHealthLive: (api) => api.getHealthLive(),
  getHealthReady: (api) => api.getHealthReady(),
  getMe: (api) => api.getMe(),
  listAreas: (api) => api.listAreas({ status: "active", limit: 10, offset: 0 }),
  getAreaMap: (api) => api.getAreaMap({ status: "active" }),
  getArea: (api) => api.getArea("a1"),
  listObservations: (api) => api.listObservations("a1", { source: "sentinel-2", limit: 5 }),
  getObservation: (api) => api.getObservation("o1"),
  fetchPreviewBlob: (api) => api.fetchPreviewBlob("/api/v1/observations/o1/preview"),
  refreshObservations: (api) =>
    api.refreshObservations("a1", { date_from: "2026-01-01", date_to: "2026-01-31" }),
  getTimeSeries: (api) => api.getTimeSeries("a1", { source: "sentinel-2" }),
  createComparison: (api) =>
    api.createComparison("a1", { source: "sentinel-2", date_a: "2026-03-06", date_b: "2026-04-30", include_weather: false }),
  createReport: (api) =>
    api.createReport({ area_id: "a1", source: "sentinel-2", date_from: "2026-01-01", date_to: "2026-04-30", include_weather: false }),
  listReports: (api) => api.listReports({ limit: 20 }),
  getReport: (api) => api.getReport("r1"),
  getReportJson: (api) => api.getReportJson("r1"),
  getSettings: (api) => api.getSettings(),
  getAdminSettings: (api) => api.getAdminSettings(),
  putAdminSetting: (api) => api.putAdminSetting("cloud_limit_pct", 15),
  listAdminUsers: (api) => api.listAdminUsers({ role: "researcher" }),
  getAdminUser: (api) => api.getAdminUser("sub-1"),
  putUserRoles: (api) => api.putUserRoles("sub-1", ["admin"]),
  createAdminArea: (api) =>
    api.createAdminArea({ name: "New", geometry: { type: "Polygon", coordinates: [] } }),
  patchAdminArea: (api) => api.patchAdminArea("a1", { name: "Renamed" }),
  archiveAdminArea: (api) => api.archiveAdminArea("a1"),
  restoreAdminArea: (api) => api.restoreAdminArea("a1"),
  listRetrievals: (api) => api.listRetrievals({ status: "failed" }),
  getIntegrationStatus: (api) => api.getIntegrationStatus(true),
  listActivity: (api) => api.listActivity({ action: "area.create" }),
  getAdminDashboard: (api) => api.getAdminDashboard(),
};

export const HEALTH_ENDPOINTS = new Set<keyof Endpoints>(["getHealthLive", "getHealthReady"]);
