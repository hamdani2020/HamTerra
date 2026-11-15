import { useMutation, useQuery } from "@tanstack/react-query";

import { useApi } from "@/core/api/ApiProvider";
import { keys } from "@/core/api/keys";
import { compareDates } from "@/lib/dates";
import type { ComparisonRequest, ComparisonResult, Source } from "@/types/api";

import { sessionComparisons } from "./sessionComparisons";

export const DATES_PAGE_SIZE = 200;
export const DATES_MAX_PAGES = 10;

/**
 * Every stored observation date for one sensor, newest first and without duplicates
 * (frontend design, Comparison Page). Pages are read until the total is reached, at most 10.
 */
export function useObservationDates(areaId: string, source: Source | null) {
  const api = useApi();
  return useQuery({
    queryKey: keys.observationDates(areaId, source),
    enabled: source !== null,
    queryFn: async ({ signal }) => {
      const dates = new Set<string>();
      for (let pageIndex = 0; pageIndex < DATES_MAX_PAGES; pageIndex += 1) {
        const offset = pageIndex * DATES_PAGE_SIZE;
        const page = await api.listObservations(
          areaId,
          { source: source ?? undefined, limit: DATES_PAGE_SIZE, offset },
          { signal },
        );
        for (const item of page.items) dates.add(item.date);
        if (page.items.length === 0 || offset + page.items.length >= page.total) break;
      }
      return [...dates].sort((a, b) => compareDates(b, a));
    },
  });
}

/** `GET /settings`, for the threshold prefill (Requirement 11.15). */
export function useSettings() {
  const api = useApi();
  return useQuery({ queryKey: keys.settings(), queryFn: ({ signal }) => api.getSettings({ signal }) });
}

/**
 * `POST /areas/{id}/comparisons`. A comparison is not cached; a successful result is kept in
 * the in-session store for the dashboard indicator, with the Backend flag only.
 */
export function useCreateComparison(areaId: string) {
  const api = useApi();
  return useMutation<ComparisonResult, unknown, ComparisonRequest>({
    mutationFn: (body) => api.createComparison(areaId, body),
    onSuccess: (result, body) => {
      sessionComparisons.record(areaId, { flag: result.flag, source: body.source, date_a: body.date_a, date_b: body.date_b });
    },
  });
}
