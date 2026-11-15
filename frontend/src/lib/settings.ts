/**
 * Application settings (Requirement 19). Pure. Values are validated synchronously on every
 * edit, so a field error shows at once (19.3).
 */
import { ADMIN_TEXT, settingRangeError } from "@/lib/messages";
import type { SettingItem } from "@/types/api";

/** Descriptions for the known keys, each at most 160 characters (19.8). */
export const SETTING_DESCRIPTIONS: Record<string, string> = {
  ndvi_diff_threshold: "Mean NDVI difference at or above which a comparison is flagged for investigation.",
  cloud_limit_pct: "Highest cloud coverage, in percent, for an observation to count as good quality.",
  data_coverage_min_pct: "Lowest data coverage, in percent, for an observation to count as good quality.",
  gap_threshold_days: "Days between observations above which a time series is reported as irregularly sampled.",
  weather_enabled: "Whether weather context is retrieved and shown with observations and comparisons.",
  default_page_size: "Rows per page that lists use when the request gives no page size.",
};

export type SettingResult = { ok: true; value: number | boolean } | { ok: false; error: string };

const NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;

/**
 * Accepts the raw input iff it is non-empty, parses as a number (a boolean for boolean items),
 * is an integer for integer items, and lies within `min` and `max` when they are set.
 */
export function validateSetting(item: Pick<SettingItem, "type" | "min" | "max">, raw: string | boolean): SettingResult {
  if (item.type === "boolean") {
    if (typeof raw === "boolean") return { ok: true, value: raw };
    if (raw === "true" || raw === "false") return { ok: true, value: raw === "true" };
    return { ok: false, error: ADMIN_TEXT.settingRequired };
  }
  const text = typeof raw === "boolean" ? "" : raw.trim();
  if (text === "") return { ok: false, error: ADMIN_TEXT.settingRequired };
  if (!NUMBER.test(text)) return { ok: false, error: ADMIN_TEXT.settingNotNumber };
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, error: ADMIN_TEXT.settingNotNumber };
  if (item.type === "integer" && !Number.isInteger(value)) return { ok: false, error: ADMIN_TEXT.settingNotInteger };
  if ((item.min !== null && value < item.min) || (item.max !== null && value > item.max)) {
    return { ok: false, error: settingRangeError(item.min, item.max) };
  }
  return { ok: true, value };
}
