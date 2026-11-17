/**
 * Endpoints for the sign-in-free demo, answered from `data/evidence/demo.json`: saved Backend
 * responses for one area, exported by `backend/scripts/export_pitch_snapshot.py --demo`.
 *
 * A request is answered only when the snapshot holds the Backend's answer to it. Requests
 * that need the Backend to compute something new (other date ranges, cloud filters, weather,
 * comparisons that were not saved, other thresholds) get a "not part of the demo" error, so
 * nothing the Backend computes (quality, flags, warnings, summaries) is computed here. The
 * only work done in the browser is choosing a saved response and slicing a saved list into
 * pages. Writes and administration are refused.
 */
import type { Endpoints } from "@/core/api/endpoints";
import { ApiError } from "@/core/api/errors";
import raw from "@/data/evidence/demo.json";
import { PREVIEW_URLS } from "@/data/evidence/previews";
import { DEMO_TEXT } from "@/lib/messages";
import type {
  Area,
  AreaFeatureCollection,
  AreaListParams,
  ComparisonRequest,
  ComparisonResult,
  ObservationListParams,
  ObservationPage,
  Page,
  PrincipalMe,
  PublicSettings,
  ReportListParams,
  ReportSummary,
  Source,
  TimeSeriesParams,
  TimeSeriesResponse,
} from "@/types/api";

export interface DemoSnapshot {
  exported_at: string;
  area: Area;
  area_list: Page<Area>;
  area_map: AreaFeatureCollection;
  settings: PublicSettings;
  observation_pages: Record<"all" | Source, ObservationPage>;
  /** Observation ID to preview file name. */
  preview_files: Record<string, string>;
  timeseries: Record<Source, TimeSeriesResponse>;
  comparisons: ComparisonResult[];
  reports: { summary: ReportSummary; raw: string }[];
}

// The JSON is a set of API responses typed by the contract; JSON imports widen literal types.
export const DEMO_SNAPSHOT = raw as unknown as DemoSnapshot;

/** Researcher permissions without refresh and report creation, which the demo cannot do. */
export const DEMO_PRINCIPAL: PrincipalMe = {
  sub: "demo-visitor",
  username: DEMO_TEXT.username,
  email: null,
  roles: ["researcher"],
  permissions: ["areas:read", "comparisons:create", "me:read", "observations:read", "reports:read", "settings:read", "timeseries:read"],
};

const DEFAULT_LIMIT = 50;

const error = (status: number, code: string, message: string): ApiError => new ApiError(status, code, message, null, null, true);
const notSaved = (message: string = DEMO_TEXT.notSaved): ApiError => error(501, "DEMO_NOT_AVAILABLE", message);
const readOnly = (): ApiError => error(501, "DEMO_READ_ONLY", DEMO_TEXT.readOnly);
const notFound = (): ApiError => error(404, "NOT_FOUND", DEMO_TEXT.notFound);
const forbidden = (): ApiError => error(403, "FORBIDDEN", DEMO_TEXT.forbidden);

const fail = (e: ApiError) => async (): Promise<never> => {
  throw e;
};

/** True when a date range (inclusive, either end optional) contains every given date. */
export function coversAll(dates: readonly string[], from: string | undefined, to: string | undefined): boolean {
  if (dates.length === 0) return true;
  const sorted = [...dates].sort();
  const first = sorted[0] as string;
  const last = sorted[sorted.length - 1] as string;
  return (!from || from <= first) && (!to || to >= last);
}

/** The items of one page of a saved list, as the Backend pages it: `offset`, then `limit`. */
export function slicePage<T>(items: readonly T[], limit: number | undefined, offset: number | undefined): { items: T[]; limit: number; offset: number } {
  const l = limit ?? DEFAULT_LIMIT;
  const o = offset ?? 0;
  return { items: items.slice(o, o + l), limit: l, offset: o };
}

export function createDemoApi(snapshot: DemoSnapshot = DEMO_SNAPSHOT, fetchAsset: typeof fetch = (input, init) => fetch(input, init)): Endpoints {
  const area = snapshot.area;
  const requireArea = (areaId: string): void => {
    if (areaId !== area.id) throw notFound();
  };
  const observationDates = (source: Source | "all"): string[] => snapshot.observation_pages[source].items.map((o) => o.date);

  return {
    getHealthLive: async () => ({ status: "ok" }),
    getHealthReady: async () => ({ status: "ok" }),
    getMe: async () => DEMO_PRINCIPAL,

    listAreas: async (params: AreaListParams = {}) => {
      const status = params.status ?? "active";
      const q = params.q?.trim().toLowerCase();
      const matches = snapshot.area_list.items
        .filter((a) => status === "all" || a.status === status)
        .filter((a) => !q || a.name.toLowerCase().includes(q))
        .map((a) => (params.include_geometry && a.id === area.id && area.geometry ? { ...a, geometry: area.geometry } : a));
      return { ...slicePage(matches, params.limit, params.offset), total: matches.length };
    },
    getAreaMap: async (params = {}) => (params.status === "archived" && area.status !== "archived" ? { type: "FeatureCollection", features: [] } : snapshot.area_map),
    getArea: async (areaId) => {
      requireArea(areaId);
      return area;
    },

    listObservations: async (areaId, params: ObservationListParams = {}) => {
      requireArea(areaId);
      const key = params.source ?? "all";
      if (params.max_cloud_coverage !== undefined || params.min_data_coverage !== undefined || !coversAll(observationDates(key), params.date_from, params.date_to)) {
        throw notSaved();
      }
      const page = snapshot.observation_pages[key];
      return { ...page, ...slicePage(page.items, params.limit, params.offset) };
    },
    getObservation: async (observationId) => {
      const found = snapshot.observation_pages.all.items.find((o) => o.id === observationId);
      if (!found) throw notFound();
      return found;
    },
    fetchPreviewBlob: async (previewUrl, o = {}) => {
      // `preview.url` is `<api>/observations/<id>/preview`; the ID is the second-to-last segment.
      const segments = previewUrl.split("/").filter(Boolean);
      const file = snapshot.preview_files[segments[segments.length - 2] ?? ""];
      const url = file ? PREVIEW_URLS[file] : undefined;
      if (!url) throw notFound();
      const response = await fetchAsset(url, { signal: o.signal ?? null });
      if (!response.ok) throw notFound();
      return response.blob();
    },
    refreshObservations: fail(readOnly()),

    getTimeSeries: async (areaId, params: TimeSeriesParams) => {
      requireArea(areaId);
      if (params.max_cloud_coverage !== undefined || params.include_weather || !coversAll(observationDates(params.source), params.date_from, params.date_to)) {
        throw notSaved();
      }
      return snapshot.timeseries[params.source];
    },
    createComparison: async (areaId, body: ComparisonRequest) => {
      requireArea(areaId);
      const saved = snapshot.comparisons.find((c) => c.source === body.source && c.a.date === body.date_a && c.b.date === body.date_b);
      const t = body.thresholds ?? {};
      const sameThresholds =
        saved !== undefined &&
        (t.ndvi_diff === undefined || t.ndvi_diff === saved.thresholds_applied.ndvi_diff) &&
        (t.max_cloud === undefined || t.max_cloud === saved.thresholds_applied.max_cloud) &&
        (t.min_data_coverage === undefined || t.min_data_coverage === saved.thresholds_applied.min_data_coverage);
      if (!saved || !sameThresholds || body.include_weather) throw notSaved(DEMO_TEXT.comparisonNotSaved);
      return saved;
    },

    createReport: fail(readOnly()),
    listReports: async (params: ReportListParams = {}) => {
      if (params.created_by) throw notSaved();
      const items = snapshot.reports.map((r) => r.summary).filter((r) => !params.area_id || r.area_id === params.area_id);
      return { ...slicePage(items, params.limit, params.offset), total: items.length };
    },
    getReport: async (reportId) => {
      const found = snapshot.reports.find((r) => r.summary.id === reportId);
      if (!found) throw notFound();
      return JSON.parse(found.raw);
    },
    getReportJson: async (reportId) => {
      const found = snapshot.reports.find((r) => r.summary.id === reportId);
      if (!found) throw notFound();
      return { raw: found.raw, report: JSON.parse(found.raw) };
    },

    getSettings: async () => snapshot.settings,
    getAdminSettings: fail(forbidden()),
    putAdminSetting: fail(forbidden()),
    listAdminUsers: fail(forbidden()),
    getAdminUser: fail(forbidden()),
    putUserRoles: fail(forbidden()),
    createAdminArea: fail(forbidden()),
    patchAdminArea: fail(forbidden()),
    archiveAdminArea: fail(forbidden()),
    restoreAdminArea: fail(forbidden()),
    listRetrievals: fail(forbidden()),
    getIntegrationStatus: fail(forbidden()),
    listActivity: fail(forbidden()),
    getAdminDashboard: fail(forbidden()),
  };
}
