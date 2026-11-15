/**
 * Comparison request building (Requirements 11.2, 11.3, 11.15, 11.16). Pure. The Backend
 * computes the difference, percentage, flag, quality and warnings; nothing here does.
 */
import { orderDates } from "@/lib/dates";
import { COMPARISON_TEXT } from "@/lib/messages";
import type { ComparisonRequest, PublicSettings, Source, ThresholdsApplied } from "@/types/api";

export type ThresholdKey = keyof ThresholdsApplied;

export const THRESHOLD_KEYS: readonly ThresholdKey[] = ["ndvi_diff", "max_cloud", "min_data_coverage"];

/** The ranges the Backend accepts for overrides. */
export const THRESHOLD_RANGE: Record<ThresholdKey, { min: number; max: number }> = {
  ndvi_diff: { min: 0, max: 2 },
  max_cloud: { min: 0, max: 100 },
  min_data_coverage: { min: 0, max: 100 },
};

/** Where each override's default comes from in `GET /settings`. */
export const THRESHOLD_SETTING: Record<ThresholdKey, keyof PublicSettings> = {
  ndvi_diff: "ndvi_diff_threshold",
  max_cloud: "cloud_limit_pct",
  min_data_coverage: "data_coverage_min_pct",
};

export type ThresholdInputs = Record<ThresholdKey, string>;
export type ThresholdDefaults = Partial<Record<ThresholdKey, number>>;

export function thresholdDefaults(settings: PublicSettings | undefined): ThresholdDefaults {
  const defaults: ThresholdDefaults = {};
  if (!settings) return defaults;
  for (const key of THRESHOLD_KEYS) {
    const value = settings[THRESHOLD_SETTING[key]];
    if (typeof value === "number" && Number.isFinite(value)) defaults[key] = value;
  }
  return defaults;
}

/** The inputs prefilled from the defaults; a missing default leaves the field empty. */
export function prefillInputs(defaults: ThresholdDefaults): ThresholdInputs {
  return {
    ndvi_diff: defaults.ndvi_diff === undefined ? "" : String(defaults.ndvi_diff),
    max_cloud: defaults.max_cloud === undefined ? "" : String(defaults.max_cloud),
    min_data_coverage: defaults.min_data_coverage === undefined ? "" : String(defaults.min_data_coverage),
  };
}

const NUMBER = /^-?(\d+(\.\d*)?|\.\d+)$/;

export type ThresholdResult =
  | { ok: true; values: Partial<Record<ThresholdKey, number>> }
  | { ok: false; errors: Partial<Record<ThresholdKey, string>> };

/** Each non-empty field must be a number within its range (Requirement 11.16). */
export function validateThresholdOverrides(inputs: ThresholdInputs): ThresholdResult {
  const values: Partial<Record<ThresholdKey, number>> = {};
  const errors: Partial<Record<ThresholdKey, string>> = {};
  for (const key of THRESHOLD_KEYS) {
    const text = inputs[key].trim();
    if (text === "") continue;
    const value = NUMBER.test(text) ? Number(text) : Number.NaN;
    const { min, max } = THRESHOLD_RANGE[key];
    if (!Number.isFinite(value) || value < min || value > max) {
      errors[key] = key === "ndvi_diff" ? COMPARISON_TEXT.rangeNdvi : COMPARISON_TEXT.rangePercent;
    } else {
      values[key] = value;
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}

/** Only the overrides that differ from the defaults; undefined when none does (11.15). */
export function buildThresholds(
  defaults: ThresholdDefaults,
  values: Partial<Record<ThresholdKey, number>>,
): Partial<ThresholdsApplied> | undefined {
  const changed: Partial<ThresholdsApplied> = {};
  for (const key of THRESHOLD_KEYS) {
    const value = values[key];
    if (value !== undefined && value !== defaults[key]) changed[key] = value;
  }
  return Object.keys(changed).length > 0 ? changed : undefined;
}

export interface ComparisonForm {
  source: Source;
  first: string;
  second: string;
  include_weather: boolean;
  thresholds: ThresholdInputs;
}

export type FormErrors = Partial<Record<"first" | "second" | ThresholdKey, string>>;

export type RequestResult = { ok: true; body: ComparisonRequest } | { ok: false; errors: FormErrors };

/** The request body with the earlier date as `date_a`, or field errors and no body. */
export function buildComparisonRequest(form: ComparisonForm, defaults: ThresholdDefaults): RequestResult {
  const ordered = orderDates(form.first, form.second);
  const overrides = validateThresholdOverrides(form.thresholds);
  const errors: FormErrors = {};
  if (!ordered.ok) {
    if (ordered.errors.date_a) errors.first = ordered.errors.date_a;
    if (ordered.errors.date_b) errors.second = ordered.errors.date_b;
  }
  if (!overrides.ok) Object.assign(errors, overrides.errors);
  if (!ordered.ok || !overrides.ok) return { ok: false, errors };
  const body: ComparisonRequest = {
    source: form.source,
    date_a: ordered.date_a,
    date_b: ordered.date_b,
    include_weather: form.include_weather,
  };
  const thresholds = buildThresholds(defaults, overrides.values);
  if (thresholds) body.thresholds = thresholds;
  return { ok: true, body };
}
