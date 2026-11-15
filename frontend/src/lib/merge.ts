/**
 * The dashboard's "Recent observations" table (Gap G1, Requirement 7.4): per-area lists
 * merged into at most 10 rows, newest date first. Pure.
 */
import type { Observation } from "@/types/api";

export const RECENT_ROWS = 10;

export interface AreaObservations {
  areaId: string;
  areaName: string;
  observations: readonly Observation[];
}

export interface RecentObservationRow {
  areaId: string;
  areaName: string;
  observation: Observation;
}

export function mergeRecentObservations(
  lists: readonly AreaObservations[],
  max: number = RECENT_ROWS,
): RecentObservationRow[] {
  const seen = new Set<string>();
  const rows: RecentObservationRow[] = [];
  for (const list of lists) {
    for (const observation of list.observations) {
      if (seen.has(observation.id)) continue;
      seen.add(observation.id);
      rows.push({ areaId: list.areaId, areaName: list.areaName, observation });
    }
  }
  rows.sort(
    (a, b) =>
      // Newest first; ties broken by area name, source and id so the order is stable.
      b.observation.date.localeCompare(a.observation.date) ||
      a.areaName.localeCompare(b.areaName) ||
      a.observation.source.localeCompare(b.observation.source) ||
      a.observation.id.localeCompare(b.observation.id),
  );
  return rows.slice(0, Math.max(0, max));
}
