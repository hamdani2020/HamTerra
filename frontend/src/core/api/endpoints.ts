/**
 * One typed function per Backend endpoint (backend design, endpoint index). This is the
 * only module in `src` that writes Backend paths; a test enforces that.
 */
import { REFRESH_TIMEOUT_MS, type ApiClient } from "@/core/api/client";
import { DisallowedHostError } from "@/core/api/errors";
import type {
  ActivityListParams,
  AdminDashboard,
  AdminUser,
  AdminUserListParams,
  Area,
  AreaCreateRequest,
  AreaFeatureCollection,
  AreaListParams,
  AreaMapParams,
  AreaUpdateRequest,
  AuditEvent,
  ComparisonRequest,
  ComparisonResult,
  HealthLive,
  HealthReady,
  IntegrationsStatus,
  Observation,
  ObservationListParams,
  ObservationPage,
  Page,
  PrincipalMe,
  PublicSettings,
  RefreshRequest,
  RefreshResult,
  Report,
  ReportFormat,
  ReportListParams,
  ReportRequest,
  ReportSummary,
  RetrievalListParams,
  RetrievalRecord,
  Role,
  RoleChangeResult,
  SettingItem,
  SettingList,
  TimeSeriesParams,
  TimeSeriesResponse,
} from "@/types/api";

type Signal = { signal?: AbortSignal | undefined };
const seg = (value: string): string => encodeURIComponent(value);

export function createEndpoints(client: ApiClient) {
  const { request } = client;
  return {
    // Health (unversioned, no token)
    getHealthLive: (o: Signal = {}) =>
      request<HealthLive>("/health/live", { auth: false, root: true, signal: o.signal }),
    getHealthReady: (o: Signal = {}) =>
      request<HealthReady>("/health/ready", { auth: false, root: true, signal: o.signal }),

    // Identity
    getMe: (o: Signal = {}) => request<PrincipalMe>("/me", { signal: o.signal }),

    // Areas
    listAreas: (params: AreaListParams = {}, o: Signal = {}) =>
      request<Page<Area>>("/areas", { query: { ...params }, signal: o.signal }),
    getAreaMap: (params: AreaMapParams = {}, o: Signal = {}) =>
      request<AreaFeatureCollection>("/areas/map", { query: { ...params }, signal: o.signal }),
    getArea: (areaId: string, o: Signal = {}) =>
      request<Area>(`/areas/${seg(areaId)}`, { signal: o.signal }),

    // Observations
    listObservations: (areaId: string, params: ObservationListParams = {}, o: Signal = {}) =>
      request<ObservationPage>(`/areas/${seg(areaId)}/observations`, {
        query: { ...params },
        signal: o.signal,
      }),
    getObservation: (observationId: string, o: Signal = {}) =>
      request<Observation>(`/observations/${seg(observationId)}`, { signal: o.signal }),
    /** `previewUrl` is `Observation.preview.url`, a Backend proxy path on the API host. */
    fetchPreviewBlob: (previewUrl: string, o: Signal = {}) => {
      const base = client.guard.apiBasePath;
      const resolved = client.guard.check(new URL(previewUrl, client.guard.apiRootUrl("/").origin));
      if (!resolved.pathname.startsWith(`${base}/observations/`) || !resolved.pathname.endsWith("/preview")) {
        throw new DisallowedHostError("not a Backend preview URL");
      }
      return request<Blob>(resolved.pathname.slice(base.length), {
        responseType: "blob",
        signal: o.signal,
      });
    },
    refreshObservations: (areaId: string, body: RefreshRequest, o: Signal = {}) =>
      request<RefreshResult>(`/areas/${seg(areaId)}/observations/refresh`, {
        method: "POST",
        body,
        timeoutMs: REFRESH_TIMEOUT_MS,
        signal: o.signal,
      }),

    // Analysis
    getTimeSeries: (areaId: string, params: TimeSeriesParams, o: Signal = {}) =>
      request<TimeSeriesResponse>(`/areas/${seg(areaId)}/ndvi/timeseries`, {
        query: { ...params },
        signal: o.signal,
      }),
    createComparison: (areaId: string, body: ComparisonRequest, o: Signal = {}) =>
      request<ComparisonResult>(`/areas/${seg(areaId)}/comparisons`, {
        method: "POST",
        body,
        signal: o.signal,
      }),

    // Reports
    createReport: (body: ReportRequest, o: Signal = {}) =>
      request<Report>("/reports", { method: "POST", body, signal: o.signal }),
    listReports: (params: ReportListParams = {}, o: Signal = {}) =>
      request<Page<ReportSummary>>("/reports", { query: { ...params }, signal: o.signal }),
    getReport: (reportId: string, format: ReportFormat = "json", o: Signal = {}) =>
      request<Report>(`/reports/${seg(reportId)}`, { query: { format }, signal: o.signal }),

    // Settings
    getSettings: (o: Signal = {}) => request<PublicSettings>("/settings", { signal: o.signal }),
    getAdminSettings: (o: Signal = {}) =>
      request<SettingList>("/admin/settings", { signal: o.signal }),
    putAdminSetting: (key: string, value: number | boolean, o: Signal = {}) =>
      request<SettingItem>(`/admin/settings/${seg(key)}`, {
        method: "PUT",
        body: { value },
        signal: o.signal,
      }),

    // Admin users
    listAdminUsers: (params: AdminUserListParams = {}, o: Signal = {}) =>
      request<Page<AdminUser>>("/admin/users", { query: { ...params }, signal: o.signal }),
    getAdminUser: (sub: string, o: Signal = {}) =>
      request<AdminUser>(`/admin/users/${seg(sub)}`, { signal: o.signal }),
    putUserRoles: (sub: string, roles: Role[], o: Signal = {}) =>
      request<RoleChangeResult>(`/admin/users/${seg(sub)}/roles`, {
        method: "PUT",
        body: { roles },
        signal: o.signal,
      }),

    // Admin areas
    createAdminArea: (body: AreaCreateRequest, o: Signal = {}) =>
      request<Area>("/admin/areas", { method: "POST", body, signal: o.signal }),
    patchAdminArea: (areaId: string, body: AreaUpdateRequest, o: Signal = {}) =>
      request<Area>(`/admin/areas/${seg(areaId)}`, { method: "PATCH", body, signal: o.signal }),
    archiveAdminArea: (areaId: string, o: Signal = {}) =>
      request<Area>(`/admin/areas/${seg(areaId)}/archive`, { method: "POST", signal: o.signal }),
    restoreAdminArea: (areaId: string, o: Signal = {}) =>
      request<Area>(`/admin/areas/${seg(areaId)}/restore`, { method: "POST", signal: o.signal }),

    // Admin operations
    listRetrievals: (params: RetrievalListParams = {}, o: Signal = {}) =>
      request<Page<RetrievalRecord>>("/admin/retrievals", { query: { ...params }, signal: o.signal }),
    getIntegrationStatus: (probe = false, o: Signal = {}) =>
      request<IntegrationsStatus>("/admin/integrations/status", {
        query: { probe },
        signal: o.signal,
      }),
    listActivity: (params: ActivityListParams = {}, o: Signal = {}) =>
      request<Page<AuditEvent>>("/admin/activity", { query: { ...params }, signal: o.signal }),
    getAdminDashboard: (o: Signal = {}) =>
      request<AdminDashboard>("/admin/dashboard", { signal: o.signal }),
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
