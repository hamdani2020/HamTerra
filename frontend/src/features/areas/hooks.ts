import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApi } from "@/core/api/ApiProvider";
import { keys } from "@/core/api/keys";
import type { AreaListParams, ObservationListParams, RefreshRequest, RefreshResult } from "@/types/api";

export const AREA_PAGE_SIZE = 20;
export const HISTORY_PAGE_SIZE = 20;

export function useAreaList(params: AreaListParams, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: keys.areas(params),
    queryFn: ({ signal }) => api.listAreas(params, { signal }),
    enabled,
  });
}

/** The observation history; runs only while its section is open (frontend design). */
export function useObservationHistory(areaId: string, params: ObservationListParams, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: keys.observations(areaId, params),
    queryFn: ({ signal }) => api.listObservations(areaId, params, { signal }),
    enabled,
  });
}

/**
 * `POST /areas/{id}/observations/refresh` (Requirement 13). Kept by the page, not the dialog,
 * so closing the dialog with Escape never aborts it. Only `success` and `partial` change
 * stored data, so only they invalidate: the area's observations (including the date lists),
 * its time series, and every area query, because the latest date may change.
 */
export function useRefreshObservations(areaId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<RefreshResult, unknown, RefreshRequest>({
    mutationFn: (body) => api.refreshObservations(areaId, body),
    onSuccess: async (result) => {
      if (result.status !== "success" && result.status !== "partial") return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["observations", areaId] }),
        queryClient.invalidateQueries({ queryKey: ["timeseries", areaId] }),
        queryClient.invalidateQueries({ queryKey: ["areas"] }),
      ]);
    },
  });
}
