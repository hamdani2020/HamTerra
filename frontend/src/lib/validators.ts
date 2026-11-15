/**
 * Pure input validators. A rejected input yields field errors and no request is built
 * (frontend design, Property 11). Per-form limits are parameters.
 */
import { compareDates, inclusiveSpanDays, isCalendarDate, todayUtc } from "@/lib/dates";
import { spanTooLongText, VALIDATION_TEXT } from "@/lib/messages";

/** Maximum inclusive spans used by the forms. */
export const MAX_SPAN_DAYS = {
  timeSeries: 3660, // Requirement 10.18
  refresh: 366, // Requirement 13.2
  report: 1826, // Requirement 15.2
} as const;

export interface DateRangeOptions {
  /** Longest permitted inclusive span; no limit when omitted. */
  maxSpanDays?: number;
  /** When given, `to` must not be after this date (refresh ranges, Requirement 13.2). */
  today?: string;
  /** False for optional filters: empty values are allowed and skip the checks that need both. */
  required?: boolean;
}

export type DateRangeErrors = { date_from?: string; date_to?: string };

export type DateRangeResult =
  | { ok: true; from: string | undefined; to: string | undefined }
  | { ok: false; errors: DateRangeErrors };

const blank = (value: string | null | undefined): boolean => value === undefined || value === null || value.trim() === "";

export function validateDateRange(
  from: string | null | undefined,
  to: string | null | undefined,
  { maxSpanDays, today, required = true }: DateRangeOptions = {},
): DateRangeResult {
  const errors: DateRangeErrors = {};
  const check = (value: string | null | undefined, key: keyof DateRangeErrors): void => {
    if (blank(value)) {
      if (required) errors[key] = VALIDATION_TEXT.dateMissing;
    } else if (!isCalendarDate(value)) {
      errors[key] = VALIDATION_TEXT.dateInvalid;
    }
  };
  check(from, "date_from");
  check(to, "date_to");
  if (errors.date_from || errors.date_to) return { ok: false, errors };

  const f = blank(from) ? undefined : (from as string);
  const t = blank(to) ? undefined : (to as string);
  if (t !== undefined && today !== undefined && compareDates(t, today) > 0) {
    errors.date_to = VALIDATION_TEXT.toInFuture;
  }
  if (f !== undefined && t !== undefined) {
    if (compareDates(f, t) > 0) {
      errors.date_from = VALIDATION_TEXT.fromAfterTo;
    } else if (maxSpanDays !== undefined && inclusiveSpanDays(f, t) > maxSpanDays) {
      errors.date_to ??= spanTooLongText(maxSpanDays);
    }
  }
  if (errors.date_from || errors.date_to) return { ok: false, errors };
  return { ok: true, from: f, to: t };
}

/** The refresh dialog's range: required, at most 366 days, not after today (UTC). */
export function validateRefreshRange(from: string, to: string, today: string = todayUtc()): DateRangeResult {
  return validateDateRange(from, to, { maxSpanDays: MAX_SPAN_DAYS.refresh, today });
}
