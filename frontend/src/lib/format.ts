/**
 * Number and date formatting for display. Formatting never changes a Backend value beyond
 * rounding for display; missing values have explicit labels (Requirement 20). Pure.
 */
import { EVIDENCE_TEXT } from "@/lib/messages";

const LOCALE = "en-GB";

/** `+0.1234` / `-0.1234`: an explicit sign and fixed decimals (Requirement 11.8). */
export function formatSigned(value: number, digits: number): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

/** A fixed-decimal number, or "Not available" when missing. */
export function formatNumber(value: number | null | undefined, digits: number): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : EVIDENCE_TEXT.notAvailable;
}

export const NDVI_DIGITS = 4;

export function formatNdvi(value: number | null | undefined): string {
  return formatNumber(value, NDVI_DIGITS);
}

/**
 * Cloud or data coverage as a percentage. Missing coverage is "Not reported"; it is never
 * derived from another metric (product steering).
 */
export function formatCoverage(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : EVIDENCE_TEXT.notReported;
}

/** Percentage difference with 2 decimals and a sign, or "Not defined" (Requirement 11.8). */
export function formatPercentDifference(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${formatSigned(value, 2)}%` : EVIDENCE_TEXT.notDefined;
}

export function formatInteger(value: number): string {
  return Math.round(value).toLocaleString(LOCALE);
}

export function formatHectares(value: number): string {
  return `${value.toLocaleString(LOCALE, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} ha`;
}

export function formatDays(value: number): string {
  return value === 1 ? "1 day" : `${formatInteger(value)} days`;
}

const DATE_FORMAT = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/** A calendar date (`YYYY-MM-DD`) as "12 Mar 2024"; other input is shown unchanged. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return EVIDENCE_TEXT.notAvailable;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return DATE_FORMAT.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

/** A timestamp as "12 Mar 2024, 14:03 UTC"; unparseable input is shown unchanged. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return EVIDENCE_TEXT.notAvailable;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : `${DATE_TIME_FORMAT.format(new Date(ms))} UTC`;
}
