import { useQuery } from "@tanstack/react-query";

import { useApi } from "@/core/api/ApiProvider";
import { keys } from "@/core/api/keys";
import type { ObservationListParams, TimeSeriesParams } from "@/types/api";

const LATEST_PARAMS: ObservationListParams = { limit: 1, offset: 0 };

/** The newest observation's sensor, used to preselect the source (Requirement 10.3). */
export function useLatestSource(areaId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: keys.observations(areaId, LATEST_PARAMS),
    queryFn: ({ signal }) => api.listObservations(areaId, LATEST_PARAMS, { signal }),
    select: (page) => page.items[0]?.source ?? null,
    enabled,
  });
}

/** One request per applied filter set, always with exactly one `source` (Requirement 10.2). */
export function useTimeSeries(areaId: string, params: TimeSeriesParams | null) {
  const api = useApi();
  return useQuery({
    queryKey: keys.timeseries(areaId, params ?? { source: "sentinel-2" }),
    queryFn: ({ signal }) => {
      if (!params) throw new Error("time series requested without a source");
      return api.getTimeSeries(areaId, params, { signal });
    },
    enabled: params !== null,
  });
}
