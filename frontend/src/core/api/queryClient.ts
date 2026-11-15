import { QueryClient } from "@tanstack/react-query";

export const STALE_TIME_MS = 30_000;
/** `GET /me` is loaded once per Session. */
export const ME_STALE_TIME = Number.POSITIVE_INFINITY;

/**
 * Defaults (frontend design, Data Fetching): 30 s reuse, 5 min garbage collection, no
 * automatic retries (a retry happens only when the user asks), no refetch on focus. An abort
 * caused by navigation is a cancellation to TanStack Query, not an error (Requirement 24.3).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        gcTime: 300_000,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false },
    },
  });
}
