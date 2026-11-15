import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { sessionComparisons } from "@/features/comparison/sessionComparisons";
import { DASHBOARD_TEXT, EVIDENCE_TEXT, REGION_TEXT, WARNING_TEXT } from "@/lib/messages";
import type { Area, Observation, Source, TimeSeriesResponse } from "@/types/api";

import { renderSignedIn } from "../auth/authHarness";
import { tokenRequests } from "../msw/cognito";
import { API, buildArea, buildObservation, buildTimeSeries, envelope, page } from "../msw/contract";
import { server } from "../msw/server";

interface Calls {
  areas: number;
  observations: string[];
  timeseries: { id: string; params: URLSearchParams }[];
  inFlight: number;
  peak: number;
}

let calls: Calls;

beforeEach(() => {
  sessionStorage.clear();
  tokenRequests.length = 0;
  calls = { areas: 0, observations: [], timeseries: [], inFlight: 0, peak: 0 };
  sessionComparisons.clear();
});

function point(date: string, mean: number, level: "good" | "limited" | "poor" = "good") {
  return {
    date,
    ndvi_mean: mean,
    cloud_coverage_pct: 5,
    data_coverage_pct: 100,
    quality: { level, cloud_coverage_pct: 5, data_coverage_pct: 100, warnings: [] },
    gap_days_from_previous: null,
    weather: null,
  };
}

function series(overrides: Partial<TimeSeriesResponse> = {}): TimeSeriesResponse {
  return buildTimeSeries({
    points: [point("2026-03-01", 0.61), point("2026-04-30", 0.6958, "limited")],
    summary: {
      count: 2,
      first_date: "2026-03-01",
      last_date: "2026-04-30",
      min: 0.61,
      max: 0.6958,
      mean_of_means: 0.65,
      trend_per_30d: 0.0585,
    },
    warnings: [],
    ...overrides,
  });
}

interface Fixture {
  areas: Area[];
  total?: number;
  observations?: Record<string, Observation[]>;
  series?: Record<string, TimeSeriesResponse | "fail">;
  holdMs?: number;
}

const track = async <T,>(work: () => Promise<T> | T, holdMs: number): Promise<T> => {
  calls.inFlight += 1;
  calls.peak = Math.max(calls.peak, calls.inFlight);
  try {
    if (holdMs > 0) await delay(holdMs);
    return await work();
  } finally {
    calls.inFlight -= 1;
  }
};

function install({ areas, total, observations = {}, series: ts = {}, holdMs = 0 }: Fixture): void {
  server.use(
    http.get(`${API}/areas`, ({ request }) => {
      calls.areas += 1;
      const q = new URL(request.url).searchParams;
      expect(q.get("status")).toBe("active");
      expect(q.get("limit")).toBe("12");
      return HttpResponse.json(page(areas, { total: total ?? areas.length, limit: 12 }));
    }),
    http.get(`${API}/areas/:id/observations`, ({ params, request }) =>
      track(() => {
        const id = String(params.id);
        calls.observations.push(id);
        expect(new URL(request.url).searchParams.get("limit")).toBe("5");
        const items = observations[id] ?? [];
        return HttpResponse.json({ ...page(items, { limit: 5 }), meta: { resolution_class: {} } });
      }, holdMs),
    ),
    http.get(`${API}/areas/:id/ndvi/timeseries`, ({ params, request }) =>
      track(() => {
        const id = String(params.id);
        calls.timeseries.push({ id, params: new URL(request.url).searchParams });
        const value = ts[id] ?? series();
        if (value === "fail") return HttpResponse.json(envelope("INTERNAL_ERROR", "x"), { status: 500 });
        return HttpResponse.json(value);
      }, holdMs),
    ),
  );
}

const area = (id: string, name: string, latest: string | null, extra: Partial<Area> = {}) =>
  buildArea({ id, name, latest_observation_date: latest, area_ha: 120.5, ...extra });
const obs = (areaId: string, date: string, source: Source = "sentinel-2", mean = 0.7) =>
  buildObservation({ id: `${areaId}-${date}-${source}`, area_id: areaId, date, source, ndvi: { mean, min: null, max: null, std: null, median: null } });

function card(name: string): HTMLElement {
  return screen.getByRole("article", { name });
}

describe("dashboard (Requirement 7)", () => {
  it("shows the count, one card per area and each card's NDVI summary", async () => {
    install({
      areas: [area("a1", "Prestea", "2026-04-30"), area("a2", "Tarkwa", "2026-04-20")],
      total: 2,
      observations: { a1: [obs("a1", "2026-04-30", "landsat-8")], a2: [obs("a2", "2026-04-20")] },
    });
    await renderSignedIn("/dashboard");
    expect(await screen.findByTestId("active-area-count")).toHaveTextContent("2");
    expect(screen.getByText(EVIDENCE_TEXT.aggregateNote)).toBeInTheDocument();
    expect(screen.getByText(EVIDENCE_TEXT.investigationNote)).toBeInTheDocument();

    const prestea = card("Prestea");
    await waitFor(() => expect(within(prestea).getByText("+0.0585")).toBeInTheDocument());
    expect(within(prestea).getByText("120.5 ha", { exact: false })).toBeInTheDocument();
    expect(within(prestea).getByText(/30 Apr 2026/)).toBeInTheDocument();
    expect(within(prestea).getByText("0.6958")).toBeInTheDocument();
    expect(within(prestea).getByText("2")).toBeInTheDocument();
    // The Backend quality level of the latest point, as received (7.5).
    expect(within(prestea).getByText("Limited")).toBeInTheDocument();

    // The time series uses the latest observation's sensor and the 365 days before it.
    const request = calls.timeseries.find((c) => c.id === "a1")?.params;
    expect(request?.get("source")).toBe("landsat-8");
    expect(request?.get("date_from")).toBe("2025-04-30");
    expect(request?.get("date_to")).toBe("2026-04-30");
    expect(calls.areas).toBe(1);
  });

  it('shows "Not enough observations" and the warning when the trend is null', async () => {
    install({
      areas: [area("a1", "Prestea", "2026-04-30")],
      observations: { a1: [obs("a1", "2026-04-30")] },
      series: {
        a1: series({
          points: [point("2026-04-30", 0.7)],
          summary: { count: 1, first_date: "2026-04-30", last_date: "2026-04-30", min: 0.7, max: 0.7, mean_of_means: 0.7, trend_per_30d: null },
          warnings: [{ code: "INSUFFICIENT_OBSERVATIONS", message: "Backend wording" }],
        }),
      },
    });
    await renderSignedIn("/dashboard");
    const prestea = await screen.findByRole("article", { name: "Prestea" });
    expect(await within(prestea).findByText(DASHBOARD_TEXT.notEnoughObservations)).toBeInTheDocument();
    expect(within(prestea).getAllByText(WARNING_TEXT.INSUFFICIENT_OBSERVATIONS)).toHaveLength(1);
  });

  it("makes no per-area calls for an area without observations", async () => {
    install({
      areas: [area("a1", "Prestea", "2026-04-30"), area("a2", "Empty", null)],
      observations: { a1: [obs("a1", "2026-04-30")] },
    });
    await renderSignedIn("/dashboard");
    const empty = await screen.findByRole("article", { name: "Empty" });
    expect(within(empty).getByText(DASHBOARD_TEXT.noObservationsYet)).toBeInTheDocument();
    await waitFor(() => expect(within(card("Prestea")).getByText("+0.0585")).toBeInTheDocument());
    expect(calls.observations).toEqual(["a1"]);
    expect(calls.timeseries.map((c) => c.id)).toEqual(["a1"]);
    expect(empty).toHaveAttribute("aria-busy", "false");
  });

  it("keeps the other cards when one card's call fails, and shows no partial values on it", async () => {
    install({
      areas: [area("a1", "Prestea", "2026-04-30"), area("a2", "Tarkwa", "2026-04-20")],
      observations: { a1: [obs("a1", "2026-04-30")], a2: [obs("a2", "2026-04-20")] },
      series: { a2: "fail" },
    });
    await renderSignedIn("/dashboard");
    const tarkwa = await screen.findByRole("article", { name: "Tarkwa" });
    expect(await within(tarkwa).findByRole("alert")).toBeInTheDocument();
    expect(within(tarkwa).getByText(DASHBOARD_TEXT.cardError)).toBeInTheDocument();
    expect(within(tarkwa).queryByText(DASHBOARD_TEXT.latestMean)).not.toBeInTheDocument();
    const prestea = card("Prestea");
    expect(await within(prestea).findByText("+0.0585")).toBeInTheDocument();
    expect(within(prestea).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows 0 and an empty state with zero active areas and calls nothing else", async () => {
    install({ areas: [], total: 0 });
    await renderSignedIn("/dashboard");
    expect(await screen.findByTestId("active-area-count")).toHaveTextContent("0");
    expect(screen.getByText(DASHBOARD_TEXT.noActiveAreas)).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText(DASHBOARD_TEXT.recentTitle)).not.toBeInTheDocument();
    expect(calls.observations).toEqual([]);
    expect(calls.timeseries).toEqual([]);
  });

  it("shows the list error with no cards or count, and retries the call", async () => {
    let fail = true;
    install({ areas: [area("a1", "Prestea", null)] });
    server.use(
      http.get(`${API}/areas`, () => {
        calls.areas += 1;
        return fail
          ? HttpResponse.json(envelope("SERVICE_UNAVAILABLE", "x"), { status: 503 })
          : HttpResponse.json(page([area("a1", "Prestea", null)], { limit: 12 }));
      }),
    );
    await renderSignedIn("/dashboard");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(DASHBOARD_TEXT.listErrorTitle);
    expect(screen.queryByTestId("active-area-count")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();

    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: REGION_TEXT.retry }));
    expect(await screen.findByRole("article", { name: "Prestea" })).toBeInTheDocument();
    expect(screen.getByTestId("active-area-count")).toHaveTextContent("1");
    expect(calls.areas).toBe(2);
  });

  it("never has more than 6 per-area requests in flight", async () => {
    const areas = Array.from({ length: 12 }, (_, i) => area(`a${i}`, `Area ${i}`, `2026-04-${String(10 + i).padStart(2, "0")}`));
    const observations = Object.fromEntries(areas.map((a) => [a.id, [obs(a.id, a.latest_observation_date ?? "")]]));
    install({ areas, observations, holdMs: 20 });
    await renderSignedIn("/dashboard");
    await waitFor(() => expect(calls.timeseries).toHaveLength(12), { timeout: 3000 });
    expect(calls.observations).toHaveLength(12);
    expect(calls.peak).toBeLessThanOrEqual(6);
    expect(calls.peak).toBeGreaterThan(1);
  });

  it("merges the recent observations of the 6 newest areas into at most 10 rows, newest first", async () => {
    const areas = Array.from({ length: 8 }, (_, i) => area(`a${i}`, `Area ${i}`, `2026-04-${String(10 + i).padStart(2, "0")}`));
    const observations = Object.fromEntries(
      areas.map((a, i) => [a.id, [0, 1, 2].map((k) => obs(a.id, `2026-0${3 + (k === 0 ? 1 : 0)}-${String(10 + i - k).padStart(2, "0")}`))]),
    );
    install({ areas, observations });
    await renderSignedIn("/dashboard");
    const region = await screen.findByRole("region", { name: DASHBOARD_TEXT.recentTitle });
    const table = await within(region).findByRole("table", { name: DASHBOARD_TEXT.recentTitle });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(10);
    const areaNames = rows.map((r) => within(r).getAllByRole("cell")[0]?.textContent);
    // Areas 0 and 1 are not among the 6 newest.
    expect(areaNames).not.toContain("Area 0");
    expect(areaNames).not.toContain("Area 1");
    expect(areaNames.slice(0, 6)).toEqual(["Area 7", "Area 6", "Area 5", "Area 4", "Area 3", "Area 2"]);
  });

  it("shows a change indicator only for an area compared in this session, with the Backend flag", async () => {
    sessionComparisons.record("a2", { flag: "flagged", source: "sentinel-2", date_a: "2025-04-01", date_b: "2026-04-01" });
    install({
      areas: [area("a1", "Prestea", "2026-04-30"), area("a2", "Tarkwa", "2026-04-20")],
      observations: { a1: [obs("a1", "2026-04-30")], a2: [obs("a2", "2026-04-20")] },
    });
    await renderSignedIn("/dashboard");
    const tarkwa = await screen.findByRole("article", { name: "Tarkwa" });
    expect(within(tarkwa).getByText(EVIDENCE_TEXT.flagged)).toBeInTheDocument();
    expect(within(card("Prestea")).queryByText(DASHBOARD_TEXT.sessionComparison, { exact: false })).not.toBeInTheDocument();
  });

  it("opens the area page when a card is selected", async () => {
    install({ areas: [area("a1", "Prestea", null)] });
    const { pathname } = await renderSignedIn("/dashboard");
    await userEvent.click(await screen.findByRole("link", { name: "Prestea" }));
    await waitFor(() => expect(pathname()).toBe("/areas/a1"));
  });
});
