import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import { ApiError } from "@/core/api/errors";
import { STORAGE_KEYS } from "@/core/auth/storage";
import { coversAll, createDemoApi, DEMO_SNAPSHOT, slicePage } from "@/features/demo/demoApi";
import { AREA_TEXT, DEMO_TEXT, REPORT_TEXT, SHELL_TEXT, SOURCE_LABEL, TIME_SERIES_TEXT } from "@/lib/messages";
import { PAGE_TITLE } from "@/lib/pageTitles";
import { ROUTES, routeTo } from "@/lib/routes";

import { renderApp } from "../auth/authHarness";
import { maps, resetMaps } from "../mocks/maplibre";
import { server } from "../msw/server";

vi.mock("maplibre-gl", () => import("../mocks/maplibre"));
vi.mock("recharts", async (importOriginal) => (await import("../mocks/recharts")).rechartsWithFixedSize(importOriginal));

const AREA = DEMO_SNAPSHOT.area;
let requests: string[];
const record = ({ request }: { request: Request }) => requests.push(`${request.method} ${request.url}`);

beforeEach(() => {
  sessionStorage.clear();
  resetMaps();
  requests = [];
  server.events.on("request:start", record);
});
afterEach(() => {
  server.events.removeListener("request:start", record);
});

async function renderDemo(path: string) {
  sessionStorage.setItem(STORAGE_KEYS.demo, "1");
  return renderApp(path);
}

describe("demo data source (no Backend)", () => {
  it("answers only what the snapshot holds", async () => {
    const api = createDemoApi();
    const series = await api.getTimeSeries(AREA.id, { source: "sentinel-2" });
    expect(series).toBe(DEMO_SNAPSHOT.timeseries["sentinel-2"]);
    await expect(api.getTimeSeries(AREA.id, { source: "sentinel-2", max_cloud_coverage: 20 })).rejects.toMatchObject({ code: "DEMO_NOT_AVAILABLE" });
    await expect(api.getTimeSeries(AREA.id, { source: "sentinel-2", date_from: "2026-03-01" })).rejects.toBeInstanceOf(ApiError);
    await expect(api.getTimeSeries("other-area", { source: "sentinel-2" })).rejects.toMatchObject({ status: 404 });

    const [saved] = DEMO_SNAPSHOT.comparisons;
    if (!saved) throw new Error("the demo snapshot has no comparison");
    const request = { source: saved.source, date_a: saved.a.date, date_b: saved.b.date, include_weather: false };
    expect(await api.createComparison(AREA.id, request)).toBe(saved);
    await expect(api.createComparison(AREA.id, { ...request, thresholds: { ndvi_diff: 0.5 } })).rejects.toMatchObject({ message: DEMO_TEXT.comparisonNotSaved });
    await expect(api.createComparison(AREA.id, { ...request, include_weather: true })).rejects.toMatchObject({ code: "DEMO_NOT_AVAILABLE" });

    await expect(api.refreshObservations(AREA.id, { date_from: "2026-01-01", date_to: "2026-01-31" })).rejects.toMatchObject({ code: "DEMO_READ_ONLY" });
    await expect(api.createReport({ area_id: AREA.id, source: "sentinel-2", date_from: "2026-01-01", date_to: "2026-01-31", include_weather: false })).rejects.toMatchObject({ code: "DEMO_READ_ONLY" });
    await expect(api.listAdminUsers()).rejects.toMatchObject({ status: 403 });
    expect(requests).toEqual([]);
  });

  it("pages saved lists like the Backend and keeps their totals", async () => {
    const api = createDemoApi();
    const page = await api.listObservations(AREA.id, { source: "sentinel-2", limit: 5, offset: 5 });
    const all = DEMO_SNAPSHOT.observation_pages["sentinel-2"];
    expect(page.items).toEqual(all.items.slice(5, 10));
    expect(page.total).toBe(all.total);
    expect(page.meta).toEqual(all.meta);
    expect(slicePage([1, 2, 3], undefined, undefined)).toEqual({ items: [1, 2, 3], limit: 50, offset: 0 });
    expect(coversAll(["2026-01-05", "2026-04-30"], "2025-04-30", "2026-04-30")).toBe(true);
    expect(coversAll(["2026-01-05", "2026-04-30"], "2026-01-06", undefined)).toBe(false);
  });
});

describe("demo mode in the app", () => {
  it("starts from the landing page and reloads into the dashboard", async () => {
    const { navigate } = await renderApp(ROUTES.landing);
    await userEvent.click(screen.getAllByRole("button", { name: DEMO_TEXT.start })[0] as HTMLElement);
    expect(sessionStorage.getItem(STORAGE_KEYS.demo)).toBe("1");
    expect(navigate).toHaveBeenCalledWith(ROUTES.dashboard);
  });

  it("shows the researcher dashboard with the banner and sends no request", async () => {
    const { container } = await renderDemo(ROUTES.dashboard);
    expect(await screen.findByRole("heading", { level: 1, name: PAGE_TITLE.dashboard })).toBeInTheDocument();
    const banner = await screen.findByRole("region", { name: DEMO_TEXT.bannerTitle });
    expect(within(banner).getByText(new RegExp(DEMO_TEXT.readOnly.slice(0, 30)))).toBeInTheDocument();
    expect(screen.getByTestId("principal-username")).toHaveTextContent(DEMO_TEXT.username);
    expect(screen.queryByRole("link", { name: SHELL_TEXT.adminGroup })).toBeNull();
    expect((await screen.findAllByText(AREA.name)).length).toBeGreaterThan(0);
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    // Every dashboard request is one the snapshot answers.
    expect(screen.queryByText(/not part of the demo/)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    expect(requests).toEqual([]);
  });

  it("draws the saved area on the map", async () => {
    await renderDemo(ROUTES.map);
    await screen.findByRole("heading", { level: 1, name: PAGE_TITLE.map });
    // Strict mode builds the map twice; the last instance is the live one.
    await waitFor(() => expect(maps.at(-1)?.sources.get("areas")).toMatchObject({ data: DEMO_SNAPSHOT.area_map }));
    expect(requests).toEqual([]);
  });

  it("offers no refresh and no report creation on the area page", async () => {
    await renderDemo(routeTo.area(AREA.id));
    expect(await screen.findByRole("heading", { level: 1, name: AREA.name })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: AREA_TEXT.timeSeries })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: AREA_TEXT.createReport })).toBeNull();
    expect(screen.queryByRole("button", { name: /refresh/i })).toBeNull();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.queryByText(/not part of the demo/)).toBeNull();
  });

  it("charts the saved time series", async () => {
    await renderDemo(`${routeTo.areaTimeSeries(AREA.id)}?source=sentinel-2`);
    expect(await screen.findByRole("heading", { name: `${TIME_SERIES_TEXT.chartTitle}, ${SOURCE_LABEL["sentinel-2"]}` })).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it("lists the saved report without a create control", async () => {
    await renderDemo(ROUTES.reports);
    const summary = DEMO_SNAPSHOT.reports[0]?.summary;
    if (!summary) throw new Error("the demo snapshot has no report");
    expect((await screen.findAllByRole("link", { name: summary.title })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: REPORT_TEXT.create })).toBeNull();
  });

  it("leaves the demo from the header", async () => {
    const { navigate } = await renderDemo(ROUTES.dashboard);
    await screen.findByRole("heading", { level: 1, name: PAGE_TITLE.dashboard });
    // The banner and the header both offer the way out.
    const exits = screen.getAllByRole("button", { name: DEMO_TEXT.exit });
    expect(exits).toHaveLength(2);
    await userEvent.click(exits[1] as HTMLElement);
    expect(sessionStorage.getItem(STORAGE_KEYS.demo)).toBeNull();
    expect(navigate).toHaveBeenCalledWith(ROUTES.landing);
  });
});
