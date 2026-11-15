import { useQuery } from "@tanstack/react-query";

import { useApi } from "@/core/api/ApiProvider";
import { keys } from "@/core/api/keys";
import type { AreaMapParams, ObservationListParams } from "@/types/api";

export const MAP_PARAMS: AreaMapParams = { status: "active" };
export const PANEL_OBSERVATION_PARAMS: ObservationListParams = { limit: 10, offset: 0 };

export function useAreaMap() {
  const api = useApi();
  return useQuery({ queryKey: keys.areaMap(MAP_PARAMS), queryFn: ({ signal }) => api.getAreaMap(MAP_PARAMS, { signal }) });
}

export function useArea(areaId: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.area(areaId), queryFn: ({ signal }) => api.getArea(areaId, { signal }) });
}

export function usePanelObservations(areaId: string) {
  const api = useApi();
  return useQuery({
    queryKey: keys.observations(areaId, PANEL_OBSERVATION_PARAMS),
    queryFn: ({ signal }) => api.listObservations(areaId, PANEL_OBSERVATION_PARAMS, { signal }),
  });
}
