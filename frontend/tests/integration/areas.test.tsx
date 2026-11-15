import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import { AREA_TEXT, MAP_TEXT, OBSERVATION_TEXT, REGION_TEXT } from "@/lib/messages";
import type { Area, Observation } from "@/types/api";

import { renderSignedIn } from "../auth/authHarness";
import { tokenRequests } from "../msw/cognito";
import { API, buildArea, buildObservation, envelope, page } from "../msw/contract";
import { server } from "../msw/server";
import { maps, resetMaps } from "../mocks/maplibre";

vi.mock("maplibre-gl", () => import("../mocks/maplibre"));

let listRequests: URLSearchParams[];
let historyRequests: URLSearchParams[];

const areas = (n: number, offset = 0): Area[] =>
  Array.from({ length: n }, (_, i) =>
    buildArea({ id: `a${offset + i}`, name: `Area ${offset + i}`, area_ha: 100 + i, latest_observation_date: i % 2 ? null : "2026-04-30" }),
  );

function installList(respond: (q: URLSearchParams) => Response = (q) => {
  const offset = Number(q.get("offset") ?? 0);
  return HttpResponse.json(page(areas(Math.min(20, 45 - offset), offset), { total: 45, limit: 20, offset }));
}): void {
  server.use(
    http.get(`${API}/areas`, ({ request }) => {
      const q = new URL(request.url).searchParams;
      listRequests.push(q);
      return respond(q);
    }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  tokenRequests.length = 0;
  listRequests = [];
  historyRequests = [];
  resetMaps();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("area list (Requirements 12.1 to 12.7)", () => {
  it("shows a table of 20 areas with links and pagination", async () => {
    installList();
    const { container } = await renderSignedIn("/areas");
    const table = await screen.findByRole("table", { name: AREA_TEXT.tableCaption });
    expect(within(table).getAllByRole("row")).toHaveLength(21);
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "Area", "Status", "Latest observation", "Details"]);
    expect(within(table).getByRole("link", { name: "Area 0" })).toHaveAttribute("href", "/areas/a0");
    expect(within(table).getAllByText(AREA_TEXT.noObservations).length).toBeGreaterThan(0);
    expect(screen.getByRole("navigation", { name: REGION_TEXT.pagination })).toHaveTextContent("Showing 1–20 of 45");
    expect(listRequests[0]?.get("status")).toBe("active");
    expect(listRequests[0]?.get("limit")).toBe("20");
    expect(listRequests[0]?.get("offset")).toBe("0");
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(await axe(container)).toHaveNoViolations();
  });

  it("pages with limit=20 and the offset", async () => {
    installList();
    const { services } = await renderSignedIn("/areas");
    await screen.findByRole("table", { name: AREA_TEXT.tableCaption });
    await userEvent.click(screen.getByRole("button", { name: REGION_TEXT.next }));
    await screen.findAllByRole("link", { name: "Area 20" });
    expect(listRequests.at(-1)?.get("offset")).toBe("20");
    expect(services.router.state.location.search).toContain("page=2");
  });

  it("sends the search once, 300 ms after typing stops", async () => {
    installList();
    await renderSignedIn("/areas");
    await screen.findByRole("table", { name: AREA_TEXT.tableCaption });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const before = listRequests.length;
    await user.type(screen.getByLabelText(AREA_TEXT.search), "Prestea");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(listRequests.length).toBe(before);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await waitFor(() => expect(listRequests.length).toBe(before + 1));
    expect(listRequests.at(-1)?.get("q")).toBe("Prestea");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(listRequests.length).toBe(before + 1);
  });

  it("limits the search to 100 characters", async () => {
    installList();
    await renderSignedIn("/areas");
    expect(await screen.findByLabelText(AREA_TEXT.search)).toHaveAttribute("maxLength", "100");
  });

  it("applies the status filter", async () => {
    installList();
    await renderSignedIn("/areas");
    await screen.findByRole("table", { name: AREA_TEXT.tableCaption });
    await userEvent.selectOptions(screen.getByLabelText(AREA_TEXT.status), "archived");
    await waitFor(() => expect(listRequests.at(-1)?.get("status")).toBe("archived"));
  });

  it("refuses an invalid bounding box without a request, then sends a valid one", async () => {
    installList();
    await renderSignedIn("/areas");
    await screen.findByRole("table", { name: AREA_TEXT.tableCaption });
    const before = listRequests.length;
    await userEvent.type(screen.getByLabelText(AREA_TEXT.minLon), "-1");
    await userEvent.type(screen.getByLabelText(AREA_TEXT.minLat), "abc");
    await userEvent.type(screen.getByLabelText(AREA_TEXT.maxLon), "-2");
    await userEvent.type(screen.getByLabelText(AREA_TEXT.maxLat), "95");
    await userEvent.click(screen.getByRole("button", { name: AREA_TEXT.applyBbox }));
    expect(screen.getByText(AREA_TEXT.notNumber)).toBeInTheDocument();
    expect(screen.getByText(AREA_TEXT.minLonOrder)).toBeInTheDocument();
    expect(screen.getByText(AREA_TEXT.latRange)).toBeInTheDocument();
    expect(listRequests.length).toBe(before);

    await userEvent.clear(screen.getByLabelText(AREA_TEXT.minLon));
    await userEvent.type(screen.getByLabelText(AREA_TEXT.minLon), "-2.5");
    await userEvent.clear(screen.getByLabelText(AREA_TEXT.minLat));
    await userEvent.type(screen.getByLabelText(AREA_TEXT.minLat), "5");
    await userEvent.clear(screen.getByLabelText(AREA_TEXT.maxLat));
    await userEvent.type(screen.getByLabelText(AREA_TEXT.maxLat), "6");
    await userEvent.click(screen.getByRole("button", { name: AREA_TEXT.applyBbox }));
    await waitFor(() => expect(listRequests.at(-1)?.get("bbox")).toBe("-2.5,5,-2,6"));
  });

  it("offers the map extent when opened from the map", async () => {
    installList();
    const { services } = await renderSignedIn("/dashboard");
    await act(async () => {
      await services.router.navigate("/areas", { state: { extent: [-3.1, 4.9, -1.5, 6.2] } });
    });
    await userEvent.click(await screen.findByRole("button", { name: AREA_TEXT.useMapExtent }));
    expect(screen.getByLabelText(AREA_TEXT.minLon)).toHaveValue("-3.1");
    expect(screen.getByLabelText(AREA_TEXT.maxLat)).toHaveValue("6.2");
  });

  it("shows an empty state that resets the filters", async () => {
    installList((q) => HttpResponse.json(page(q.get("q") ? [] : areas(2), { total: q.get("q") ? 0 : 2, limit: 20 })));
    const { services } = await renderSignedIn("/areas?q=nothing&status=all");
    expect(await screen.findByText(AREA_TEXT.empty)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: AREA_TEXT.resetFilters }));
    await screen.findAllByRole("link", { name: "Area 0" });
    expect(services.router.state.location.search).toBe("");
    expect(listRequests.at(-1)?.get("status")).toBe("active");
    expect(screen.getByLabelText(AREA_TEXT.search)).toHaveValue("");
  });

  it("shows the Backend message for a 422 and keeps the filters", async () => {
    installList(() => HttpResponse.json(envelope("VALIDATION_ERROR", "bbox values must be finite"), { status: 422 }));
    await renderSignedIn("/areas?q=Pre");
    expect(await screen.findByRole("alert")).toHaveTextContent("bbox values must be finite");
    expect(screen.getByLabelText(AREA_TEXT.search)).toHaveValue("Pre");
  });
});

function installDetail({
  area = buildArea({ id: "a1", name: "Prestea", description: "Pilot area.", geometry: { type: "Polygon", coordinates: [[[-2.2, 5.3], [-2.1, 5.3], [-2.1, 5.4], [-2.2, 5.3]]] } }),
  history = [buildObservation({ id: "o1", date: "2026-04-30" }), buildObservation({ id: "o2", date: "2026-03-01", source: "landsat-8" })] as Observation[],
}: { area?: Area | null; history?: Observation[] } = {}): void {
  server.use(
    http.get(`${API}/areas/:id`, () => (area ? HttpResponse.json(area) : HttpResponse.json(envelope("NOT_FOUND", "x"), { status: 404 }))),
    http.get(`${API}/areas/:id/observations`, ({ request }) => {
      const q = new URL(request.url).searchParams;
      historyRequests.push(q);
      return HttpResponse.json({ ...page(history, { limit: 20 }), meta: { resolution_class: {} } });
    }),
    http.get(`${API}/observations/:id`, ({ params }) => {
      const found = history.find((o) => o.id === params.id);
      return found ? HttpResponse.json(found) : HttpResponse.json(envelope("NOT_FOUND", "x"), { status: 404 });
    }),
  );
}

describe("area details (Requirements 12.8 to 12.14)", () => {
  it("shows the fields, the links and the polygon on a mini map", async () => {
    installDetail();
    await renderSignedIn("/areas/a1");
    expect(await screen.findByRole("heading", { level: 1, name: "Prestea" })).toBeInTheDocument();
    expect(screen.getByText("Pilot area.")).toBeInTheDocument();
    expect(screen.getAllByText(AREA_TEXT.statusActive).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: AREA_TEXT.timeSeries })).toHaveAttribute("href", "/areas/a1/timeseries");
    expect(screen.getByRole("link", { name: AREA_TEXT.compare })).toHaveAttribute("href", "/areas/a1/compare");
    expect(screen.getByRole("link", { name: AREA_TEXT.createReport })).toHaveAttribute("href", "/reports");
    await waitFor(() => expect(maps.at(-1)?.sources.has("areas")).toBe(true));
    expect(maps.at(-1)?.options.interactive).toBe(false);
    expect(historyRequests).toHaveLength(0);
  });

  it("shows the Archived badge and keeps the history and report links", async () => {
    installDetail({ area: buildArea({ id: "a1", name: "Old site", status: "archived" }) });
    await renderSignedIn("/areas/a1");
    await screen.findByRole("heading", { level: 1, name: "Old site" });
    expect(screen.getAllByText(AREA_TEXT.statusArchived).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: AREA_TEXT.createReport })).toBeInTheDocument();
    expect(screen.getByText(AREA_TEXT.history)).toBeInTheDocument();
  });

  it("loads the history only when opened, validates filters, and opens an observation", async () => {
    installDetail();
    await renderSignedIn("/areas/a1");
    await screen.findByRole("heading", { level: 1, name: "Prestea" });
    await userEvent.click(screen.getByText(AREA_TEXT.history));
    await screen.findByRole("table", { name: OBSERVATION_TEXT.tableCaption });
    expect(historyRequests).toHaveLength(1);
    expect(historyRequests[0]?.get("limit")).toBe("20");

    await userEvent.type(screen.getByLabelText(AREA_TEXT.maxCloud), "150");
    await userEvent.click(screen.getByRole("button", { name: AREA_TEXT.applyFilters }));
    expect(screen.getByText(AREA_TEXT.percentInvalid)).toBeInTheDocument();
    expect(historyRequests).toHaveLength(1);

    await userEvent.clear(screen.getByLabelText(AREA_TEXT.maxCloud));
    await userEvent.type(screen.getByLabelText(AREA_TEXT.maxCloud), "40");
    await userEvent.selectOptions(screen.getByLabelText("Source"), "landsat-8");
    await userEvent.click(screen.getByRole("button", { name: AREA_TEXT.applyFilters }));
    await waitFor(() => expect(historyRequests).toHaveLength(2));
    expect(historyRequests[1]?.get("max_cloud_coverage")).toBe("40");
    expect(historyRequests[1]?.get("source")).toBe("landsat-8");

    // The filtered request renders a new table.
    const filtered = await screen.findByRole("table", { name: OBSERVATION_TEXT.tableCaption });
    await userEvent.click(within(filtered).getByRole("button", { name: /30 Apr 2026/ }));
    const detail = await screen.findByRole("article", { name: "30 Apr 2026 · Sentinel-2" });
    expect(within(detail).getByText(OBSERVATION_TEXT.mean)).toBeInTheDocument();
    expect(within(detail).getByText(MAP_TEXT.noPreview)).toBeInTheDocument();
  });

  it("shows a not-found state for an unknown area", async () => {
    installDetail({ area: null });
    await renderSignedIn("/areas/missing");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(AREA_TEXT.notFound);
    expect(within(alert).getByRole("link", { name: AREA_TEXT.toList })).toHaveAttribute("href", "/areas");
  });

  it("shows a not-found state for an observation that no longer exists", async () => {
    installDetail();
    server.use(http.get(`${API}/observations/:id`, () => HttpResponse.json(envelope("NOT_FOUND", "x"), { status: 404 })));
    await renderSignedIn("/areas/a1");
    await screen.findByRole("heading", { level: 1, name: "Prestea" });
    await userEvent.click(screen.getByText(AREA_TEXT.history));
    const table = await screen.findByRole("table", { name: OBSERVATION_TEXT.tableCaption });
    await userEvent.click(within(table).getByRole("button", { name: /30 Apr 2026/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(AREA_TEXT.observationNotFound);
    await userEvent.click(within(alert).getByRole("button", { name: AREA_TEXT.backToHistory }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
