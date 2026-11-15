/**
 * The create-report form (Requirements 15.1, 15.2). Pure. Pairs are sent earlier date first.
 */
import { orderDates } from "@/lib/dates";
import { REPORT_TEXT } from "@/lib/messages";
import { MAX_SPAN_DAYS, validateDateRange } from "@/lib/validators";
import type { ReportRequest, Source } from "@/types/api";

export const TITLE_MAX = 200;
export const PAIRS_MAX = 10;

export interface ReportPairInput {
  first: string;
  second: string;
}

export interface ReportFormInput {
  area_id: string;
  source: Source;
  date_from: string;
  date_to: string;
  title: string;
  pairs: readonly ReportPairInput[];
  include_weather: boolean;
}

export interface ReportFormErrors {
  area_id?: string;
  date_from?: string;
  date_to?: string;
  title?: string;
  pairs?: string;
  /** Per pair: errors on its first and second date, by index. */
  pairErrors?: Record<number, { first?: string; second?: string }>;
}

export type ReportFormResult = { ok: true; body: ReportRequest } | { ok: false; errors: ReportFormErrors };

export function validateReportForm(input: ReportFormInput): ReportFormResult {
  const errors: ReportFormErrors = {};
  if (!input.area_id) errors.area_id = REPORT_TEXT.areaRequired;
  const range = validateDateRange(input.date_from, input.date_to, { maxSpanDays: MAX_SPAN_DAYS.report });
  if (!range.ok) Object.assign(errors, range.errors);
  if (input.title.length > TITLE_MAX) errors.title = REPORT_TEXT.titleTooLong;
  if (input.pairs.length > PAIRS_MAX) errors.pairs = REPORT_TEXT.tooManyPairs;

  const comparisons: { date_a: string; date_b: string }[] = [];
  input.pairs.forEach((pair, index) => {
    const ordered = orderDates(pair.first, pair.second);
    if (ordered.ok) {
      comparisons.push({ date_a: ordered.date_a, date_b: ordered.date_b });
    } else {
      errors.pairErrors ??= {};
      errors.pairErrors[index] = { first: ordered.errors.date_a, second: ordered.errors.date_b };
    }
  });

  if (Object.keys(errors).length > 0 || !range.ok || !range.from || !range.to) return { ok: false, errors };
  const body: ReportRequest = {
    area_id: input.area_id,
    source: input.source,
    date_from: range.from,
    date_to: range.to,
    include_weather: input.include_weather,
  };
  if (input.title.trim() !== "") body.title = input.title.trim();
  if (comparisons.length > 0) body.comparisons = comparisons;
  return { ok: true, body };
}
