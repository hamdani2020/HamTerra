/**
 * Calendar dates as plain `YYYY-MM-DD` strings with UTC arithmetic (frontend design,
 * Technology Choices: no date library, no time-zone conversions). Pure.
 */
import { VALIDATION_TEXT } from "@/lib/messages";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** True for a real calendar date in `YYYY-MM-DD` form (rejects 2023-02-29, 2024-13-01). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC maps years 0 to 99 to 1900 to 1999; setUTCFullYear keeps the given year.
  date.setUTCFullYear(year);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Milliseconds since the epoch at 00:00 UTC of a valid calendar date. */
export function toUtcMs(date: string): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCFullYear(year);
  return value.getTime();
}

export function fromUtcMs(ms: number): string {
  const value = new Date(ms);
  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY);
}

/** Days in the range counting both ends: a range from a date to itself spans 1 day. */
export function inclusiveSpanDays(from: string, to: string): number {
  return daysBetween(from, to) + 1;
}

export function addDays(date: string, days: number): string {
  return fromUtcMs(toUtcMs(date) + days * MS_PER_DAY);
}

/** Today's calendar date in UTC, the calendar the Backend uses. */
export function todayUtc(now: Date = new Date()): string {
  return fromUtcMs(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Lexical order equals date order for valid `YYYY-MM-DD` strings with 4-digit years. */
export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type OrderedDates =
  | { ok: true; date_a: string; date_b: string }
  | { ok: false; errors: { date_a?: string; date_b?: string } };

/**
 * The two comparison dates with the earlier one as `date_a` (Requirements 11.2, 11.3).
 * Missing, invalid or equal dates give field errors and no dates.
 */
export function orderDates(first: string | null | undefined, second: string | null | undefined): OrderedDates {
  const errors: { date_a?: string; date_b?: string } = {};
  if (!first) errors.date_a = VALIDATION_TEXT.dateMissing;
  else if (!isCalendarDate(first)) errors.date_a = VALIDATION_TEXT.dateInvalid;
  if (!second) errors.date_b = VALIDATION_TEXT.dateMissing;
  else if (!isCalendarDate(second)) errors.date_b = VALIDATION_TEXT.dateInvalid;
  if (errors.date_a || errors.date_b || !first || !second) return { ok: false, errors };
  if (first === second) return { ok: false, errors: { date_b: VALIDATION_TEXT.datesEqual } };
  return compareDates(first, second) < 0
    ? { ok: true, date_a: first, date_b: second }
    : { ok: true, date_a: second, date_b: first };
}
