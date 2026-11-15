import { useSyncExternalStore } from "react";

import type { FlagStatus, Source } from "@/types/api";

/**
 * The Backend `flag` of the last comparison the user ran per area in this Session (Gap
 * G7, Requirement 7.6). Memory only; cleared when the Session ends. The browser never
 * computes a flag: only values returned by the Backend are recorded.
 */
export interface SessionComparison {
  flag: FlagStatus;
  source: Source;
  date_a: string;
  date_b: string;
}

const entries = new Map<string, SessionComparison>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export const sessionComparisons = {
  record(areaId: string, comparison: SessionComparison): void {
    entries.set(areaId, comparison);
    emit();
  },
  get(areaId: string): SessionComparison | undefined {
    return entries.get(areaId);
  },
  clear(): void {
    if (entries.size === 0) return;
    entries.clear();
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useSessionComparison(areaId: string): SessionComparison | undefined {
  useSyncExternalStore(sessionComparisons.subscribe, () => version, () => version);
  return sessionComparisons.get(areaId);
}
