/** TanStack Query keys. Every parameter is part of the key, so identical requests share it. */
import type {
  ActivityListParams,
  AdminUserListParams,
  AreaListParams,
  AreaMapParams,
  ObservationListParams,
  ReportListParams,
  RetrievalListParams,
  TimeSeriesParams,
} from "@/types/api";

export const keys = {
  me: () => ["me"] as const,
  areas: (params: AreaListParams) => ["areas", params] as const,
  areaMap: (params: AreaMapParams) => ["areas", "map", params] as const,
  area: (id: string) => ["areas", id] as const,
  observations: (areaId: string, params: ObservationListParams) =>
    ["observations", areaId, params] as const,
  observation: (id: string) => ["observation", id] as const,
  timeseries: (areaId: string, params: TimeSeriesParams) => ["timeseries", areaId, params] as const,
  reports: (params: ReportListParams) => ["reports", params] as const,
  report: (id: string) => ["reports", id] as const,
  settings: () => ["settings"] as const,
  adminSettings: () => ["admin", "settings"] as const,
  adminUsers: (params: AdminUserListParams) => ["admin", "users", params] as const,
  adminUser: (sub: string) => ["admin", "users", sub] as const,
  adminRetrievals: (params: RetrievalListParams) => ["admin", "retrievals", params] as const,
  adminActivity: (params: ActivityListParams) => ["admin", "activity", params] as const,
  adminIntegrations: (probe: boolean) => ["admin", "integrations", probe] as const,
  adminDashboard: () => ["admin", "dashboard"] as const,
};
