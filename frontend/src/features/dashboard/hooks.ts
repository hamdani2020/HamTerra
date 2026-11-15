import { queryOptions, useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useApi } from "@/core/api/ApiProvider";
import type { Endpoints } from "@/core/api/endpoints";
import { keys } from "@/core/api/keys";
import { addDays } from "@/lib/dates";
import { createLimiter, type Limited } from "@/lib/limiter";
import { mergeRecentObservations, type RecentObservationRow } from "@/lib/merge";
import type { Area, AreaListParams, ObservationListParams, Source, TimeSeriesParams } from "@/types/api";

export const DASHBOARD_AREA_LIMIT = 12;
export const RECENT_AREA_COUNT = 6;
export const DASHBOARD_CONCURRENCY = 6;
export const TIME_SERIES_DAYS = 365;

export const DASHBOARD_AREA_PARAMS: AreaListParams = { status: "active", limit: DASHBOARD_AREA_LIMIT, offset: 0 };
/** One call per area serves the card's source lookup and the recent table (frontend design). */
export const CARD_OBSERVATION_PARAMS: ObservationListParams = { limit: 5, offset: 0 };

export function useDashboardAreas() {
  const api = useApi();
  return useQuery({
    queryKey: keys.areas(DASHBOARD_AREA_PARAMS),
    queryFn: ({ signal }) => api.listAreas(DASHBOARD_AREA_PARAMS, { signal }),
  });
}

/** One limiter per dashboard mount; every per-area call goes through it (Requirement 24.6). */
export function useDashboardLimiter(): Limited {
  const [limiter] = useState(() => createLimiter(DASHBOARD_CONCURRENCY));
  return limiter;
}

function observationsQuery(api: Endpoints, limiter: Limited, area: Area) {
  return queryOptions({
    queryKey: keys.observations(area.id, CARD_OBSERVATION_PARAMS),
    queryFn: ({ signal }) => limiter((s) => api.listObservations(area.id, CARD_OBSERVATION_PARAMS, { signal: s }), signal),
    // No observations: no per-area call at all (Requirement 7.7).
    enabled: area.latest_observation_date !== null,
  });
}

export function useCardObservations(area: Area, limiter: Limited) {
  return useQuery(observationsQuery(useApi(), limiter, area));
}

/** The 365 days up to the latest observation, for the latest observation's sensor (G2). */
export function cardTimeSeriesParams(latest: string, source: Source): TimeSeriesParams {
  return { source, date_from: addDays(latest, -TIME_SERIES_DAYS), date_to: latest };
}

export function useCardTimeSeries(area: Area, source: Source | undefined, limiter: Limited) {
  const api = useApi();
  const latest = area.latest_observation_date;
  const params = latest && source ? cardTimeSeriesParams(latest, source) : undefined;
  return useQuery({
    queryKey: keys.timeseries(area.id, params ?? { source: source ?? "sentinel-2" }),
    queryFn: ({ signal }) => {
      if (!params) throw new Error("time series requested without a source");
      return limiter((s) => api.getTimeSeries(area.id, params, { signal: s }), signal);
    },
    enabled: params !== undefined,
  });
}

/** The 6 areas with the newest `latest_observation_date` (Requirement 7.4). */
export function newestAreas(areas: readonly Area[], count: number = RECENT_AREA_COUNT): Area[] {
  return areas
    .filter((area): area is Area & { latest_observation_date: string } => area.latest_observation_date !== null)
    .sort((a, b) => b.latest_observation_date.localeCompare(a.latest_observation_date) || a.name.localeCompare(b.name))
    .slice(0, count);
}

export interface RecentObservations {
  rows: RecentObservationRow[] | undefined;
  isPending: boolean;
  isFetching: boolean;
  failed: number;
  error: unknown;
  refetchFailed: () => void;
}

/** The merged "Recent observations" table; shares the cards' observation queries. */
export function useRecentObservations(areas: readonly Area[], limiter: Limited): RecentObservations {
  const api = useApi();
  const newest = newestAreas(areas);
  return useQueries({
    queries: newest.map((area) => observationsQuery(api, limiter, area)),
    combine: (results) => {
      const failedResults = results.filter((r) => r.isError);
      const succeeded = results.flatMap((r, i) => {
        const area = newest[i];
        return r.data && area ? [{ areaId: area.id, areaName: area.name, observations: r.data.items }] : [];
      });
      const isPending = results.some((r) => r.isPending);
      const allFailed = results.length > 0 && failedResults.length === results.length;
      return {
        rows: isPending || allFailed ? undefined : mergeRecentObservations(succeeded),
        isPending,
        isFetching: results.some((r) => r.isFetching),
        failed: failedResults.length,
        error: failedResults[0]?.error ?? null,
        refetchFailed: () => {
          for (const r of failedResults) void r.refetch();
        },
      };
    },
  });
}
