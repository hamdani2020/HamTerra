/**
 * Time-series filters, validation, the single-source guard and the screen-reader summary
 * (Requirement 10). Pure. The Backend computes every statistic; nothing here derives one.
 */
import { compareDates } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { SOURCE_LABEL, TIME_SERIES_TEXT, WARNING_TEXT, warningText } from "@/lib/messages";
import { MAX_SPAN_DAYS, validateDateRange } from "@/lib/validators";
import type { Quality, Source, TimeSeriesParams, TimeSeriesResponse, WeatherContext } from "@/types/api";

export const SOURCES: readonly Source[] = ["sentinel-2", "landsat-8"];

export function isSource(value: unknown): value is Source {
  return value === "sentinel-2" || value === "landsat-8";
}

/** The filter form as typed, all strings except the toggle. */
export interface TimeSeriesFilters {
  source: Source | null;
  date_from: string;
  date_to: string;
  max_cloud_coverage: string;
  include_weather: boolean;
}

export const EMPTY_FILTERS: TimeSeriesFilters = {
  source: null,
  date_from: "",
  date_to: "",
  max_cloud_coverage: "",
  include_weather: false,
};

/** Filters from the URL query string, so back and forward restore them. */
export function filtersFromSearch(search: URLSearchParams): TimeSeriesFilters {
  const source = search.get("source");
  return {
    source: isSource(source) ? source : null,
    date_from: search.get("date_from") ?? "",
    date_to: search.get("date_to") ?? "",
    max_cloud_coverage: search.get("max_cloud_coverage") ?? "",
    include_weather: search.get("include_weather") === "true",
  };
}

export function filtersToSearch(filters: TimeSeriesFilters): URLSearchParams {
  const search = new URLSearchParams();
  if (filters.source) search.set("source", filters.source);
  if (filters.date_from) search.set("date_from", filters.date_from);
  if (filters.date_to) search.set("date_to", filters.date_to);
  if (filters.max_cloud_coverage.trim() !== "") search.set("max_cloud_coverage", filters.max_cloud_coverage.trim());
  if (filters.include_weather) search.set("include_weather", "true");
  return search;
}

export type FilterErrors = Partial<Record<"source" | "date_from" | "date_to" | "max_cloud_coverage", string>>;

export type FilterResult = { ok: true; params: TimeSeriesParams } | { ok: false; errors: FilterErrors };

/**
 * Valid filters become request parameters with exactly one `source` (Requirements 10.2,
 * 10.6, 10.18). Dates are optional; when both are given the range is at most 3660 days.
 */
export function validateTimeSeriesFilters(filters: TimeSeriesFilters): FilterResult {
  const errors: FilterErrors = {};
  if (!filters.source) errors.source = TIME_SERIES_TEXT.chooseSource;
  const range = validateDateRange(filters.date_from, filters.date_to, { maxSpanDays: MAX_SPAN_DAYS.timeSeries, required: false });
  if (!range.ok) Object.assign(errors, range.errors);
  const cloudText = filters.max_cloud_coverage.trim();
  let cloud: number | undefined;
  if (cloudText !== "") {
    cloud = /^\d{1,3}$/.test(cloudText) ? Number(cloudText) : Number.NaN;
    if (!Number.isInteger(cloud) || cloud < 0 || cloud > 100) errors.max_cloud_coverage = TIME_SERIES_TEXT.maxCloudInvalid;
  }
  if (Object.keys(errors).length > 0 || !filters.source || !range.ok) return { ok: false, errors };
  const params: TimeSeriesParams = { source: filters.source };
  if (range.from) params.date_from = range.from;
  if (range.to) params.date_to = range.to;
  if (cloud !== undefined) params.max_cloud_coverage = cloud;
  if (filters.include_weather) params.include_weather = true;
  return { ok: true, params };
}

/** A chart point; it carries its sensor so the chart can refuse a mixed input. */
export interface ChartPoint {
  date: string;
  source: Source;
  ndvi_mean: number;
  cloud_coverage_pct: number | null;
  data_coverage_pct: number | null;
  quality: Quality;
  gap_days_from_previous: number | null;
  weather: WeatherContext | null;
}

/**
 * The chart input guard (Requirement 10.6, 20.5): one sensor and at least one point, sorted
 * by date; null for an empty or mixed input, which the chart then does not draw.
 */
export function singleSourceSeries(points: readonly ChartPoint[]): { source: Source; points: ChartPoint[] } | null {
  const first = points[0];
  if (!first) return null;
  if (points.some((point) => point.source !== first.source)) return null;
  return { source: first.source, points: [...points].sort((a, b) => compareDates(a.date, b.date)) };
}

/** "Chart of N NDVI points for <Source> from <first> to <last>." (Requirement 10.22) */
export function chartSummaryText(points: readonly Pick<ChartPoint, "date">[], source: Source): string {
  const dates = points.map((p) => p.date).sort(compareDates);
  const first = dates[0];
  const last = dates.at(-1);
  const count = points.length;
  const noun = count === 1 ? "point" : "points";
  if (!first || !last) return `Chart of 0 NDVI points for ${SOURCE_LABEL[source]}.`;
  return `Chart of ${count} NDVI ${noun} for ${SOURCE_LABEL[source]} from ${formatDate(first)} to ${formatDate(last)}.`;
}

/** The y-axis range: -1 to 1, narrowed to the data with padding when the data is narrower. */
export function ndviDomain(values: readonly number[]): [number, number] {
  if (values.length === 0) return [-1, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(0.05, (max - min) * 0.1);
  const round = (v: number) => Math.round(v * 100) / 100;
  return [round(Math.max(-1, min - pad)), round(Math.min(1, max + pad))];
}

export function chartPoints(response: TimeSeriesResponse): ChartPoint[] {
  return response.points.map((p) => ({ ...p, source: response.source }));
}

/** Backend warnings as text; one point always carries the insufficient-observations text (10.14). */
export function seriesNotices(response: TimeSeriesResponse): string[] {
  const notices = response.warnings.map(warningText);
  const insufficient = response.points.length === 1 || response.summary.trend_per_30d === null;
  if (response.points.length > 0 && insufficient && !response.warnings.some((w) => w.code === "INSUFFICIENT_OBSERVATIONS")) {
    notices.unshift(WARNING_TEXT.INSUFFICIENT_OBSERVATIONS);
  }
  return notices;
}
