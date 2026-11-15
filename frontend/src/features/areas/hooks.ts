import { useQuery } from "@tanstack/react-query";

import { useApi } from "@/core/api/ApiProvider";
import { keys } from "@/core/api/keys";
import type { AreaListParams, ObservationListParams } from "@/types/api";

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
