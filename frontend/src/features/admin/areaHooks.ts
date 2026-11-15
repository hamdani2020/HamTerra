import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { useApi } from "@/core/api/ApiProvider";
import { keys } from "@/core/api/keys";
import type { Area, AreaCreateRequest, AreaUpdateRequest } from "@/types/api";

/**
 * After an area write: every area query (lists, map, details, dashboard area list), the
 * admin dashboard, and for a changed area its observations, whose geometry status may change
 * (Requirement 14.17).
 */
async function invalidateAreas(queryClient: QueryClient, areaId?: string): Promise<void> {
  const work = [
    queryClient.invalidateQueries({ queryKey: ["areas"] }),
    queryClient.invalidateQueries({ queryKey: keys.adminDashboard() }),
  ];
  if (areaId) work.push(queryClient.invalidateQueries({ queryKey: ["observations", areaId] }));
  await Promise.all(work);
}

export function useCreateArea() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<Area, unknown, AreaCreateRequest>({
    mutationFn: (body) => api.createAdminArea(body),
    onSuccess: () => invalidateAreas(queryClient),
  });
}

export function useUpdateArea(areaId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<Area, unknown, AreaUpdateRequest>({
    mutationFn: (body) => api.patchAdminArea(areaId, body),
    onSuccess: () => invalidateAreas(queryClient, areaId),
  });
}

export function useArchiveRestore() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<Area, unknown, { areaId: string; action: "archive" | "restore" }>({
    mutationFn: ({ areaId, action }) => (action === "archive" ? api.archiveAdminArea(areaId) : api.restoreAdminArea(areaId)),
    onSuccess: (_area, { areaId }) => invalidateAreas(queryClient, areaId),
  });
}
