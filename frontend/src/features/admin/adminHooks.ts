import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApi } from "@/core/api/ApiProvider";
import { keys } from "@/core/api/keys";
import type {
  ActivityListParams,
  AdminUserListParams,
  RetrievalListParams,
  Role,
  RoleChangeResult,
  SettingItem,
} from "@/types/api";

export const ADMIN_PAGE_SIZE = 25;
export const RECENT_FAILURES: RetrievalListParams = { status: "failed", limit: 5, offset: 0 };
export const RECENT_ACTIVITY: ActivityListParams = { limit: 10, offset: 0 };

export function useAdminDashboard() {
  const api = useApi();
  return useQuery({ queryKey: keys.adminDashboard(), queryFn: ({ signal }) => api.getAdminDashboard({ signal }) });
}

/** Status without a probe; the probe has its own key and runs only on request (16.3). */
export function useIntegrations(probe: boolean, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: keys.adminIntegrations(probe),
    queryFn: ({ signal }) => api.getIntegrationStatus(probe, { signal }),
    enabled,
    // A probe is a live check: never served from the cache.
    ...(probe ? { staleTime: 0, gcTime: 0 } : {}),
  });
}

export function useRetrievals(params: RetrievalListParams, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: keys.adminRetrievals(params), queryFn: ({ signal }) => api.listRetrievals(params, { signal }), enabled });
}

export function useActivity(params: ActivityListParams, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: keys.adminActivity(params), queryFn: ({ signal }) => api.listActivity(params, { signal }), enabled });
}

export function useAdminUsers(params: AdminUserListParams) {
  const api = useApi();
  return useQuery({ queryKey: keys.adminUsers(params), queryFn: ({ signal }) => api.listAdminUsers(params, { signal }) });
}

export function useAdminUser(sub: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: keys.adminUser(sub ?? ""),
    queryFn: ({ signal }) => api.getAdminUser(sub ?? "", { signal }),
    enabled: sub !== null,
  });
}

/** One mutation per editor, so at most one role change is in flight per user (17.5). */
export function useChangeRoles(sub: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<RoleChangeResult, unknown, Role[]>({
    mutationFn: (roles) => api.putUserRoles(sub, roles),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.adminUser(sub) }),
        queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
        queryClient.invalidateQueries({ queryKey: keys.adminDashboard() }),
      ]),
  });
}

export function useAdminSettings() {
  const api = useApi();
  return useQuery({ queryKey: keys.adminSettings(), queryFn: ({ signal }) => api.getAdminSettings({ signal }) });
}

export function useSaveSetting(key: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<SettingItem, unknown, number | boolean>({
    mutationFn: (value) => api.putAdminSetting(key, value),
    onSuccess: async (item) => {
      // Replace the row with the returned record (19.4), and drop the public copy (19.11).
      queryClient.setQueryData(keys.adminSettings(), (old: { items: SettingItem[] } | undefined) =>
        old ? { ...old, items: old.items.map((i) => (i.key === item.key ? item : i)) } : old,
      );
      await queryClient.invalidateQueries({ queryKey: keys.settings() });
    },
  });
}
