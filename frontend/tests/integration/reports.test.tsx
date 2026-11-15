import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import { AREA_TEXT, COMPARISON_FLAG_LABEL, REGION_TEXT, REPORT_TEXT } from "@/lib/messages";
import type { Report, ReportRequest } from "@/types/api";

import { renderSignedIn } from "../auth/authHarness";
import { tokenRequests } from "../msw/cognito";
import { API, buildArea, buildComparison, buildReport, buildReportSummary, envelope, page } from "../msw/contract";
import { server } from "../msw/server";
import { resetMaps } from "../mocks/maplibre";

vi.mock("maplibre-gl", () => import("../mocks/maplibre"));
vi.mock("recharts", async (importOriginal) => (await import("../mocks/recharts")).rechartsWithFixedSize(importOriginal));

let bodies: ReportRequest[];
let listCalls: URLSearchParams[];
let requests: string[];

const CAVEATS = ["The platform does not determine the cause of any change.", "Preview images are for visual orientation only."];
const LIMITATIONS = ["NDVI values are polygon-level aggregates.", "Seasonal effects are not removed."];

function storedReport(overrides: Partial<Report> = {}): Report {
  return buildReport({
    id: "r-77",
    title: "Prestea Q1",
    area: { id: "a1", name: "Prestea", area_ha: 122.55, geometry: { type: "Polygon", coordinates: [[[-2.2, 5.3], [-2.1, 5.3], [-2.1, 5.4], [-2.2, 5.3]]] } },
    observations: [
      { date: "2026-01-10", ndvi_mean: 0.61, cloud_coverage_pct: 4, data_coverage_pct: 100, quality: { level: "good", cloud_coverage_pct: 4, data_coverage_pct: 100, warnings: [] } },
      { date: "2026-03-01", ndvi_mean: 0.66, cloud_coverage_pct: 30, data_coverage_pct: null, quality: { level: "poor", cloud_coverage_pct: 30, data_coverage_pct: null, warnings: [] } },
    ],
    comparisons: [buildComparison({ summary_text: "Stored comparison summary, exactly as saved." })],
    warnings: [{ code: "IRREGULAR_SAMPLING", message: "x" }],
    caveats: CAVEATS,
    limitations: LIMITATIONS,
    ...overrides,
  });
}

function install({
  create = (_b: ReportRequest): Response | Promise<Response> => HttpResponse.json(storedReport(), { status: 201 }),
  list = (): Response => HttpResponse.json(page([buildReportSummary({ id: "r-77", title: "Prestea Q1" })], { limit: 20 })),
  report = (): Response => new HttpResponse(`${JSON.stringify(storedReport(), null, 2)}\n`, { headers: { "Content-Type": "application/json" } }),
} = {}): void {
  server.use(
    http.all(`${API}/*`, ({ request }) => {
      requests.push(`${request.method} ${new URL(request.url).pathname}`);
    }),
    http.get(`${API}/areas`, () => HttpResponse.json(page([buildArea({ id: "a1", name: "Prestea" }), buildArea({ id: "a2", name: "Tarkwa" })], { limit: 200 }))),
    http.get(`${API}/areas/:id`, () => HttpResponse.json(buildArea({ id: "a1", name: "Prestea" }))),
    http.get(`${API}/areas/:id/observations`, () => HttpResponse.json({ ...page([], { limit: 20 }), meta: { resolution_class: {} } })),
    http.get(`${API}/reports`, ({ request }) => {
      listCalls.push(new URL(request.url).searchParams);
      return list();
    }),
    http.get(`${API}/reports/:id`, ({ request }) => {
      expect(new URL(request.url).searchParams.get("format")).toBe("json");
      return report();
    }),
    http.post(`${API}/reports`, async ({ request }) => {
      const body = (await request.json()) as ReportRequest;
      bodies.push(body);
      return create(body);
    }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  tokenRequests.length = 0;
  bodies = [];
  listCalls = [];
  requests = [];
  resetMaps();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function openCreate() {
  const view = await renderSignedIn("/reports");
  await userEvent.click(await screen.findByRole("button", { name: REPORT_TEXT.create }));
  const dialog = await screen.findByRole("dialog", { name: REPORT_TEXT.createTitle });
  return { ...view, dialog };
}

describe("create report (Requirements 15.1 to 15.5, 15.15)", () => {
  it("sends the form, pairs earlier first, and opens the new report on 201", async () => {
    install();
    const { dialog, pathname } = await openCreate();
    const area = within(dialog).getByLabelText(REPORT_TEXT.area);
    await waitFor(() => expect(within(area).getAllByRole("option")).toHaveLength(3));
    await userEvent.selectOptions(area, "a1");
    expect(within(dialog).getByRole("checkbox", { name: REPORT_TEXT.weather })).not.toBeChecked();
    await userEvent.clear(within(dialog).getByLabelText(REPORT_TEXT.dateFrom));
    await userEvent.type(within(dialog).getByLabelText(REPORT_TEXT.dateFrom), "2026-01-01");
    await userEvent.clear(within(dialog).getByLabelText(REPORT_TEXT.dateTo));
    await userEvent.type(within(dialog).getByLabelText(REPORT_TEXT.dateTo), "2026-04-30");
    await userEvent.type(within(dialog).getByLabelText(REPORT_TEXT.title), "  Prestea Q1  ");
    await userEvent.click(within(dialog).getByRole("button", { name: REPORT_TEXT.addPair }));
    await userEvent.type(within(dialog).getByLabelText(`${REPORT_TEXT.pairFirst} 1`), "2026-03-01");
    await userEvent.type(within(dialog).getByLabelText(`${REPORT_TEXT.pairSecond} 1`), "2026-01-10");
    await userEvent.click(within(dialog).getByRole("button", { name: REPORT_TEXT.submit }));
    await waitFor(() => expect(pathname()).toBe("/reports/r-77"));
    expect(bodies).toEqual([
      {
        area_id: "a1",
        source: "sentinel-2",
        date_from: "2026-01-01",
        date_to: "2026-04-30",
        title: "Prestea Q1",
        comparisons: [{ date_a: "2026-01-10", date_b: "2026-03-01" }],
        include_weather: false,
      },
    ]);
  });

  it.each([
    ["a range over 1826 days", { from: "2015-01-01", to: "2026-01-01" }, "The range can be at most 1,826 days."],
    ["a start after the end", { from: "2026-05-01", to: "2026-04-01" }, "The start date must be on or before the end date."],
  ])("refuses %s with a field error, sends nothing and keeps the values", async (_l, range, message) => {
    install();
    const { dialog } = await openCreate();
    await waitFor(() => expect(within(within(dialog).getByLabelText(REPORT_TEXT.area)).getAllByRole("option")).toHaveLength(3));
    await userEvent.selectOptions(within(dialog).getByLabelText(REPORT_TEXT.area), "a1");
    await userEvent.clear(within(dialog).getByLabelText(REPORT_TEXT.dateFrom));
    await userEvent.type(within(dialog).getByLabelText(REPORT_TEXT.dateFrom), range.from);
    await userEvent.clear(within(dialog).getByLabelText(REPORT_TEXT.dateTo));
    await userEvent.type(within(dialog).getByLabelText(REPORT_TEXT.dateTo), range.to);
    await userEvent.click(within(dialog).getByRole("button", { name: REPORT_TEXT.submit }));
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
    expect(within(dialog).getByLabelText(REPORT_TEXT.dateFrom)).toHaveValue(range.from);
  });

  it("refuses a pair with equal dates and a long title, and allows at most 10 pairs", async () => {
    install();
    const { dialog } = await openCreate();
    await waitFor(() => expect(within(within(dialog).getByLabelText(REPORT_TEXT.area)).getAllByRole("option")).toHaveLength(3));
    await userEvent.selectOptions(within(dialog).getByLabelText(REPORT_TEXT.area), "a1");
    await userEvent.click(within(dialog).getByLabelText(REPORT_TEXT.title));
    await userEvent.paste("x".repeat(201));
    for (let i = 0; i < 10; i += 1) await userEvent.click(within(dialog).getByRole("button", { name: REPORT_TEXT.addPair }));
    expect(within(dialog).getByRole("button", { name: REPORT_TEXT.addPair })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(`${REPORT_TEXT.pairFirst} 1`), "2026-03-01");
    await userEvent.type(within(dialog).getByLabelText(`${REPORT_TEXT.pairSecond} 1`), "2026-03-01");
    await userEvent.click(within(dialog).getByRole("button", { name: REPORT_TEXT.submit }));
    expect(await within(dialog).findByText(REPORT_TEXT.titleTooLong)).toBeInTheDocument();
    expect(within(dialog).getByText("Select two different dates.")).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it("explains NO_OBSERVATIONS with a refresh link and keeps the values", async () => {
    install({ create: () => HttpResponse.json(envelope("NO_OBSERVATIONS", "x"), { status: 422 }) });
    const { dialog } = await openCreate();
    await waitFor(() => expect(within(within(dialog).getByLabelText(REPORT_TEXT.area)).getAllByRole("option")).toHaveLength(3));
    await userEvent.selectOptions(within(dialog).getByLabelText(REPORT_TEXT.area), "a2");
    await userEvent.click(within(dialog).getByRole("button", { name: REPORT_TEXT.submit }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(REPORT_TEXT.noObservations);
    expect(within(alert).getByRole("link", { name: REPORT_TEXT.refreshLink })).toHaveAttribute("href", "/areas/a2");
    expect(within(dialog).getByLabelText(REPORT_TEXT.area)).toHaveValue("a2");
  });

  it("offers a retry for a server error and does not navigate", async () => {
    let fail = true;
    install({ create: () => (fail ? HttpResponse.json(envelope("INTERNAL_ERROR", "x"), { status: 500 }) : HttpResponse.json(storedReport(), { status: 201 })) });
    const { dialog, pathname } = await openCreate();
    await waitFor(() => expect(within(within(dialog).getByLabelText(REPORT_TEXT.area)).getAllByRole("option")).toHaveLength(3));
    await userEvent.selectOptions(within(dialog).getByLabelText(REPORT_TEXT.area), "a1");
    await userEvent.click(within(dialog).getByRole("button", { name: REPORT_TEXT.submit }));
    const alert = await within(dialog).findByRole("alert");
    expect(pathname()).toBe("/reports");
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: REGION_TEXT.retry }));
    await waitFor(() => expect(pathname()).toBe("/reports/r-77"));
    expect(bodies).toHaveLength(2);
  });

  it("disables submit while pending", async () => {
    install({
      create: async () => {
        await delay(150);
        return HttpResponse.json(storedReport(), { status: 201 });
      },
    });
    const { dialog } = await openCreate();
    await waitFor(() => expect(within(within(dialog).getByLabelText(REPORT_TEXT.area)).getAllByRole("option")).toHaveLength(3));
    await userEvent.selectOptions(within(dialog).getByLabelText(REPORT_TEXT.area), "a1");
    await userEvent.click(within(dialog).getByRole("button", { name: REPORT_TEXT.submit }));
    expect(within(dialog).getByRole("button", { name: REPORT_TEXT.submit })).toBeDisabled();
    expect(within(dialog).getByText(REPORT_TEXT.submitting)).toBeInTheDocument();
  });

  it("opens from the area page with the area fixed", async () => {
    install();
    const { pathname } = await renderSignedIn("/areas/a1");
    await userEvent.click(await screen.findByRole("link", { name: AREA_TEXT.createReport }));
    const dialog = await screen.findByRole("dialog", { name: REPORT_TEXT.createTitle });
    expect(pathname()).toBe("/reports");
    expect(within(dialog).queryByLabelText(REPORT_TEXT.area)).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("Area: Prestea");
    await userEvent.click(within(dialog).getByRole("button", { name: REPORT_TEXT.submit }));
    await waitFor(() => expect(bodies[0]?.area_id).toBe("a1"));
  });
});

describe("report list (Requirement 15.6)", () => {
  it("shows the table with 20 rows per page and the area filter", async () => {
    install();
    const { container } = await renderSignedIn("/reports");
    const table = await screen.findByRole("table", { name: REPORT_TEXT.listCaption });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Title", "Area", "Period", "Source", "Created", "Created by"]);
    expect(within(table).getByRole("link", { name: "Prestea Q1" })).toHaveAttribute("href", "/reports/r-77");
    expect(listCalls[0]?.get("limit")).toBe("20");
    expect(screen.queryByLabelText(REPORT_TEXT.filterCreator)).not.toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByLabelText(REPORT_TEXT.filterArea)).getAllByRole("option")).toHaveLength(3));
    await userEvent.selectOptions(screen.getByLabelText(REPORT_TEXT.filterArea), "a2");
    await waitFor(() => expect(listCalls.at(-1)?.get("area_id")).toBe("a2"));
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(await axe(container)).toHaveNoViolations();
  });

  it("offers the creator filter to admins", async () => {
    install();
    await renderSignedIn("/reports", { roles: ["admin"] });
    await userEvent.type(await screen.findByLabelText(REPORT_TEXT.filterCreator), "sub-other");
    await userEvent.click(screen.getByRole("button", { name: REPORT_TEXT.applyFilters }));
    await waitFor(() => expect(listCalls.at(-1)?.get("created_by")).toBe("sub-other"));
  });

  it("shows an empty state instead of the table", async () => {
    install({ list: () => HttpResponse.json(page([], { limit: 20 })) });
    await renderSignedIn("/reports");
    expect(await screen.findByText(REPORT_TEXT.empty)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an error with retry when the list fails", async () => {
    let fail = true;
    install({ list: () => (fail ? HttpResponse.json(envelope("SERVICE_UNAVAILABLE", "x"), { status: 503 }) : HttpResponse.json(page([buildReportSummary()], { limit: 20 }))) });
    await renderSignedIn("/reports");
    const alert = await screen.findByRole("alert");
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: REGION_TEXT.retry }));
    expect(await screen.findByRole("table", { name: REPORT_TEXT.listCaption })).toBeInTheDocument();
  });
});

describe("report view (Requirements 15.7 to 15.14)", () => {
  it("renders everything from one request, with caveats and limitations unchanged and visible", async () => {
    install();
    const { container } = await renderSignedIn("/reports/r-77");
    expect(await screen.findByRole("heading", { level: 1, name: "Prestea Q1" })).toBeInTheDocument();
    expect(screen.getByText(/This report is a snapshot created on 1 May 2026, 10:00 UTC and does not change when data is refreshed\./)).toBeInTheDocument();
    // The aggregate limitation also appears as the page's own note, so look within the section.
    const section = screen.getByRole("region", { name: REPORT_TEXT.caveatsSection });
    for (const text of [...CAVEATS, ...LIMITATIONS]) expect(within(section).getByText(text)).toBeVisible();
    expect(screen.getByText("Stored comparison summary, exactly as saved.")).toBeInTheDocument();
    expect(screen.getByText(COMPARISON_FLAG_LABEL.flagged)).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "Mean NDVI, Sentinel-2" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: REPORT_TEXT.observations })).toBeInTheDocument();
    expect(screen.getByText("122.6 ha")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pdf/i })).not.toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    // Only the session, the Principal and the report itself: no other data request.
    expect(requests.filter((r) => !r.endsWith("/me"))).toEqual(["GET /api/v1/reports/r-77"]);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("downloads the response text unmodified as report-<id>.json", async () => {
    const raw = `${JSON.stringify(storedReport(), null, 2)}\n`;
    install({ report: () => new HttpResponse(raw, { headers: { "Content-Type": "application/json" } }) });
    let blob: Blob | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      blob = b as Blob;
      return "blob:r";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    await renderSignedIn("/reports/r-77");
    await userEvent.click(await screen.findByRole("button", { name: REPORT_TEXT.download }));
    expect(names).toEqual(["report-r-77.json"]);
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blob as unknown as Blob);
    });
    expect(text).toBe(raw);
  });

  it("opens the print dialog", async () => {
    install();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    await renderSignedIn("/reports/r-77");
    await userEvent.click(await screen.findByRole("button", { name: REPORT_TEXT.print }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("shows the same not-found state for a missing or another user's report", async () => {
    install({ report: () => HttpResponse.json(envelope("NOT_FOUND", "Report r-1 belongs to someone else"), { status: 404 }) });
    await renderSignedIn("/reports/r-1");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(REPORT_TEXT.notFound);
    expect(alert).not.toHaveTextContent("someone else");
    expect(within(alert).getByRole("link", { name: REPORT_TEXT.toList })).toHaveAttribute("href", "/reports");
  });
});

describe("print stylesheet (Requirement 15.11)", () => {
  it("keeps the caveats section printable and hides navigation", async () => {
    // Read from disk: Vitest does not process CSS, so a ?raw import is empty.
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/styles/print.css", "utf8");
    expect(css).toMatch(/\[data-print="show"\][^}]*display:\s*block/);
    expect(css).toMatch(/nav,[\s\S]*aside,[\s\S]*display:\s*none/);
  });
});
