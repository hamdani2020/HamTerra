import { useQuery } from "@tanstack/react-query";

import { useApi } from "@/core/api/ApiProvider";
import { keys } from "@/core/api/keys";

/** `GET /observations/{id}` for the observation detail (Requirement 9). */
export function useObservation(observationId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: keys.observation(observationId ?? ""),
    queryFn: ({ signal }) => api.getObservation(observationId ?? "", { signal }),
    enabled: observationId !== null,
  });
}
