/**
 * The refresh request (Requirements 13.1 to 13.3). Pure. `sources` is left out when both
 * sensors are selected, which asks the Backend for both.
 */
import { todayUtc } from "@/lib/dates";
import { REFRESH_TEXT } from "@/lib/messages";
import { SOURCES } from "@/lib/timeseries";
import { validateRefreshRange } from "@/lib/validators";
import type { RefreshRequest, Source } from "@/types/api";

export interface RefreshForm {
  date_from: string;
  date_to: string;
  sources: readonly Source[];
}

export type RefreshErrors = Partial<Record<"date_from" | "date_to" | "sources", string>>;

export type RefreshBuild = { ok: true; body: RefreshRequest } | { ok: false; errors: RefreshErrors };

/** `sources` exactly as selected, or omitted when both are selected (Property 22). */
export function refreshSources(selected: readonly Source[]): Source[] | undefined {
  const unique = SOURCES.filter((s) => selected.includes(s));
  return unique.length === SOURCES.length ? undefined : unique;
}

export function buildRefreshRequest(form: RefreshForm, today: string = todayUtc()): RefreshBuild {
  const errors: RefreshErrors = {};
  const range = validateRefreshRange(form.date_from, form.date_to, today);
  if (!range.ok) Object.assign(errors, range.errors);
  const sources = refreshSources(form.sources);
  if (sources !== undefined && sources.length === 0) errors.sources = REFRESH_TEXT.noSource;
  if (Object.keys(errors).length > 0 || !range.ok || !range.from || !range.to) return { ok: false, errors };
  const body: RefreshRequest = { date_from: range.from, date_to: range.to };
  if (sources) body.sources = sources;
  return { ok: true, body };
}
