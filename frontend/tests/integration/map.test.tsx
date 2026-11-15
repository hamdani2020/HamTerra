import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BASEMAP_TIMEOUT_MS, PREVIEW_LAYER, PREVIEW_SOURCE } from "@/features/map/useMap";
import { GHANA_BOUNDS } from "@/lib/geo";
import { EVIDENCE_TEXT, MAP_TEXT, REGION_TEXT } from "@/lib/messages";
import type { AreaFeature, AreaFeatureCollection, Observation } from "@/types/api";

import { renderSignedIn } from "../auth/authHarness";
import { tokenRequests } from "../msw/cognito";
import { API, buildArea, buildObservation, envelope, page } from "../msw/contract";
import { server } from "../msw/server";
import { maps, mapControl, resetMaps, workerUrl, type FakeMap } from "../mocks/maplibre";

vi.mock("maplibre-gl", () => import("../mocks/maplibre"));

const feature = (id: string, name: string, latest: string | null, offset = 0): AreaFeature => ({
  type: "Feature",
  id,
  geometry: {
    type: "Polygon",
    coordinates: [[[-2.2 + offset, 5.3], [-2.1 + offset, 5.3], [-2.1 + offset, 5.4], [-2.2 + offset, 5.4], [-2.2 + offset, 5.3]]],
  },
  properties: { id, name, area_ha: 120.5, latest_observation_date: latest },
});
const collection = (...features: AreaFeature[]): AreaFeatureCollection => ({ type: "FeatureCollection", features });

const withPreview = (id: string, date: string): Observation =>
  buildObservation({
    id,
    date,
    preview: { url: `/api/v1/observations/${id}/preview`, width_px: 117, height_px: null, note: "Backend preview note." },
  });

let created: string[];
let revoked: string[];

function install(fcol: AreaFeatureCollection, observations: Record<string, Observation[] | "fail"> = {}): void {
  server.use(
    http.get(`${API}/areas/map`, ({ request }) => {
      expect(new URL(request.url).searchParams.get("status")).toBe("active");
      return HttpResponse.json(fcol);
    }),
    http.get(`${API}/areas/:id`, ({ params }) => HttpResponse.json(buildArea({ id: String(params.id), description: null }))),
    http.get(`${API}/areas/:id/observations`, ({ params, request }) => {
      expect(new URL(request.url).searchParams.get("limit")).toBe("10");
      const value = observations[String(params.id)] ?? [];
      if (value === "fail") return HttpResponse.json(envelope("SERVICE_UNAVAILABLE", "x"), { status: 503 });
      return HttpResponse.json({ ...page(value, { limit: 10 }), meta: { resolution_class: {} } });
    }),
  );
}

const map = (): FakeMap => {
  const instance = maps.at(-1);
  if (!instance) throw new Error("no map created");
  return instance;
};

async function openMap(fcol: AreaFeatureCollection, observations: Record<string, Observation[] | "fail"> = {}) {
  install(fcol, observations);
  const view = await renderSignedIn("/map");
  await screen.findByRole("heading", { level: 1, name: "Map" });
  await waitFor(() => expect(map().sources.has("areas")).toBe(true));
  return view;
}

function select(id: string | null): void {
  act(() => map().click(id ? [{ properties: { id } }] : []));
}

beforeEach(() => {
  sessionStorage.clear();
  tokenRequests.length = 0;
  resetMaps();
  created = [];
  revoked = [];
  let n = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    n += 1;
    created.push(`blob:map-${n}`);
    return `blob:map-${n}`;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    revoked.push(url);
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("map layers (Requirements 8.1, 8.2, 8.4, 8.15)", () => {
  it("points MapLibre at its worker, loaded as a Vite worker entry", async () => {
    await openMap(collection());
    // `?worker_file` in development, a hashed asset in builds; never the page-module form.
    expect(workerUrl).toMatch(/maplibre-gl-worker.*(worker_file|\.js$)/);
  });

  it("puts the feature collection in one source with fill and outline layers, and fits to it", async () => {
    const fcol = collection(feature("a1", "Prestea", "2026-04-30"), feature("a2", "Tarkwa", null, 1));
    await openMap(fcol);
    const m = map();
    expect(m.sources.get("areas")).toMatchObject({ type: "geojson", data: fcol, promoteId: "id" });
    expect(m.layers.map((l) => l.id)).toEqual(["background", "basemap", "areas-fill", "areas-halo", "areas-outline"]);
    expect(m.camera.find((c) => c.method === "fitBounds")?.args[0]).toEqual([-2.2, 5.3, -1.1, 5.4]);
    // Keyless raster basemap with attribution, kept expanded.
    const style = m.options.style as { sources: { basemap: { tiles: string[]; attribution: string } } };
    expect(style.sources.basemap.tiles).toEqual(["https://tile.openstreetmap.org/{z}/{x}/{y}.png"]);
    expect(style.sources.basemap.attribution).toBe(MAP_TEXT.attribution);
    expect(m.controls).toHaveLength(1);
    expect(screen.getByRole("link", { name: MAP_TEXT.areaListLink })).toHaveAttribute("href", "/areas");
    expect(screen.getByText(EVIDENCE_TEXT.aggregateNote)).toBeInTheDocument();
  });

  it("fits to Ghana when there are no features", async () => {
    await openMap(collection());
    await waitFor(() => expect(map().camera.find((c) => c.method === "fitBounds")?.args[0]).toEqual(GHANA_BOUNDS));
    expect(screen.getByText(MAP_TEXT.noAreas)).toBeInTheDocument();
  });

  it("offers keyboard-operable zoom and reset controls", async () => {
    await openMap(collection(feature("a1", "Prestea", null)));
    const user = userEvent.setup();
    const zoomIn = screen.getByRole("button", { name: MAP_TEXT.zoomIn });
    zoomIn.focus();
    await user.keyboard("{Enter}");
    screen.getByRole("button", { name: MAP_TEXT.zoomOut }).focus();
    await user.keyboard(" ");
    await user.click(screen.getByRole("button", { name: MAP_TEXT.reset }));
    const calls = map().camera.map((c) => c.method);
    expect(calls).toContain("zoomIn");
    expect(calls).toContain("zoomOut");
    expect(map().camera.at(-1)).toMatchObject({ method: "fitBounds", args: [GHANA_BOUNDS, expect.anything()] });
  });
});

describe("selection and details panel (Requirements 8.5 to 8.9, 8.14)", () => {
  it("highlights one polygon at a time and shows the panel from the feature properties", async () => {
    await openMap(collection(feature("a1", "Prestea", "2026-04-30"), feature("a2", "Tarkwa", null, 1)), {
      a1: [buildObservation({ id: "o1", date: "2026-04-30", source: "landsat-8" }), buildObservation({ id: "o2", date: "2026-03-01" })],
    });
    select("a1");
    expect(map().selectedIds()).toEqual(["a1"]);
    const panel = screen.getByRole("region", { name: "Prestea" });
    expect(within(panel).getByText("120.5 ha")).toBeInTheDocument();
    expect(within(panel).getByText("30 Apr 2026")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: MAP_TEXT.openDetails })).toHaveAttribute("href", "/areas/a1");
    expect(within(panel).getByRole("link", { name: MAP_TEXT.openTimeSeries })).toHaveAttribute("href", "/areas/a1/timeseries");
    expect(within(panel).getByRole("link", { name: MAP_TEXT.openComparison })).toHaveAttribute("href", "/areas/a1/compare");

    const items = await within(panel).findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("30 Apr 2026 · Landsat 8");
    expect(items[0]).toHaveTextContent("0.6958");
    expect(within(items[0] as HTMLElement).getByText("Good")).toBeInTheDocument();

    select("a2");
    expect(map().selectedIds()).toEqual(["a2"]);
    const second = screen.getByRole("region", { name: "Tarkwa" });
    expect(within(second).getAllByText(MAP_TEXT.noObservations).length).toBeGreaterThanOrEqual(1);
    expect(await within(second).findByText(MAP_TEXT.noObservations, { selector: "p" })).toBeInTheDocument();

    select(null);
    expect(map().selectedIds()).toEqual([]);
    expect(screen.queryByRole("region", { name: "Tarkwa" })).not.toBeInTheDocument();
  });

  it("keeps the selection and properties when the panel calls fail, and retries", async () => {
    let fail = true;
    install(collection(feature("a1", "Prestea", "2026-04-30")));
    server.use(
      http.get(`${API}/areas/:id/observations`, () =>
        fail
          ? HttpResponse.json(envelope("SERVICE_UNAVAILABLE", "x"), { status: 503 })
          : HttpResponse.json({ ...page([buildObservation({ id: "o1" })], { limit: 10 }), meta: { resolution_class: {} } }),
      ),
    );
    await renderSignedIn("/map");
    await waitFor(() => expect(map().sources.has("areas")).toBe(true));
    const layersBefore = map().layers.map((l) => l.id);
    select("a1");
    const panel = screen.getByRole("region", { name: "Prestea" });
    const alert = await within(panel).findByRole("alert");
    expect(alert).toHaveTextContent(MAP_TEXT.observationsError);
    expect(within(panel).getByText("120.5 ha")).toBeInTheDocument();
    expect(map().selectedIds()).toEqual(["a1"]);
    expect(map().layers.map((l) => l.id)).toEqual(layersBefore);

    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: REGION_TEXT.retry }));
    expect(await within(panel).findByText("0.6958")).toBeInTheDocument();
    expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes the panel with its close button", async () => {
    await openMap(collection(feature("a1", "Prestea", null)));
    select("a1");
    await userEvent.click(screen.getByRole("button", { name: MAP_TEXT.closePanel }));
    expect(screen.queryByRole("region", { name: "Prestea" })).not.toBeInTheDocument();
    expect(map().selectedIds()).toEqual([]);
  });
});

describe("failures (Requirements 8.3, 8.12, 8.13)", () => {
  it("shows an error with retry in place of the data layer when GET /areas/map fails", async () => {
    let fail = true;
    server.use(
      http.get(`${API}/areas/map`, () =>
        fail ? HttpResponse.json(envelope("INTERNAL_ERROR", "x"), { status: 500 }) : HttpResponse.json(collection(feature("a1", "Prestea", null))),
      ),
    );
    await renderSignedIn("/map");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(MAP_TEXT.areasError);
    expect(map().sources.has("areas")).toBe(false);
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: REGION_TEXT.retry }));
    await waitFor(() => expect(map().sources.has("areas")).toBe(true));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains a missing WebGL context and links to the area list", async () => {
    mapControl.webglUnavailable = true;
    install(collection());
    await renderSignedIn("/map");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(MAP_TEXT.unsupported);
    expect(within(alert).getByRole("link", { name: MAP_TEXT.areaListLink })).toHaveAttribute("href", "/areas");
    expect(screen.queryByRole("button", { name: MAP_TEXT.zoomIn })).not.toBeInTheDocument();
  });

  it("falls back to a plain background with a notice when no tile loads within 10 s", async () => {
    await openMap(collection(feature("a1", "Prestea", null)));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => map().emit("dataloading", { dataType: "source", sourceId: "basemap" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BASEMAP_TIMEOUT_MS - 1000);
    });
    expect(screen.queryByText(MAP_TEXT.basemapFailed)).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByText(MAP_TEXT.basemapFailed)).toBeInTheDocument();
    expect(map().getLayer("basemap")?.layout).toMatchObject({ visibility: "none" });
    expect(map().sources.has("areas")).toBe(true);
  });

  it("keeps the basemap when a tile loads in time", async () => {
    await openMap(collection(feature("a1", "Prestea", null)));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => {
      map().emit("dataloading", { dataType: "source", sourceId: "basemap" });
      map().emit("data", { dataType: "source", sourceId: "basemap", tile: {} });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BASEMAP_TIMEOUT_MS + 1000);
    });
    expect(screen.queryByText(MAP_TEXT.basemapFailed)).not.toBeInTheDocument();
  });
});

describe("preview overlay (Requirements 9.6 to 9.14)", () => {
  it("adds the image at the polygon bounds with notes and opacity, and removes it completely", async () => {
    let previewCalls = 0;
    server.use(
      http.get(`${API}/observations/:id/preview`, ({ request }) => {
        previewCalls += 1;
        expect(request.headers.get("authorization")).toMatch(/^Bearer /);
        return new HttpResponse(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } });
      }),
    );
    await openMap(collection(feature("a1", "Prestea", "2026-04-30")), {
      a1: [withPreview("o1", "2026-04-30"), buildObservation({ id: "o2", date: "2026-03-01" })],
    });
    select("a1");
    const panel = screen.getByRole("region", { name: "Prestea" });
    const items = await within(panel).findAllByRole("listitem");
    expect(within(items[1] as HTMLElement).getByText(MAP_TEXT.noPreview)).toBeInTheDocument();

    await userEvent.click(within(items[0] as HTMLElement).getByRole("button", { name: MAP_TEXT.showPreview }));
    await waitFor(() => expect(map().sources.has(PREVIEW_SOURCE)).toBe(true));
    expect(previewCalls).toBe(1);
    expect(map().sources.get(PREVIEW_SOURCE)).toMatchObject({
      type: "image",
      url: "blob:map-1",
      coordinates: [[-2.2, 5.4], [-2.1, 5.4], [-2.1, 5.3], [-2.2, 5.3]],
    });
    expect(map().getLayer(PREVIEW_LAYER)?.paint).toMatchObject({ "raster-opacity": 0.7 });
    expect(within(panel).getByText("Backend preview note.")).toBeInTheDocument();
    expect(within(panel).getByText(/117 by unknown px/)).toBeInTheDocument();
    expect(within(panel).getByText(EVIDENCE_TEXT.previewPosition)).toBeInTheDocument();
    const legend = screen.getByTestId("legend-overlay");
    expect(legend).toHaveTextContent(EVIDENCE_TEXT.previewOrientation);
    expect(legend).toHaveTextContent("70%");

    const slider = within(panel).getByRole("slider", { name: /Preview opacity/ });
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "100");
    expect(slider).toHaveAttribute("step", "1");
    fireEvent.change(slider, { target: { value: "40" } });
    expect(map().getLayer(PREVIEW_LAYER)?.paint).toMatchObject({ "raster-opacity": 0.4 });

    await userEvent.click(within(panel).getByRole("button", { name: MAP_TEXT.removePreview }));
    expect(map().sources.has(PREVIEW_SOURCE)).toBe(false);
    expect(map().getLayer(PREVIEW_LAYER)).toBeUndefined();
    expect(revoked).toEqual(["blob:map-1"]);
    expect(screen.queryByTestId("legend-overlay")).not.toBeInTheDocument();
  });

  it("releases the image when the page is left", async () => {
    server.use(http.get(`${API}/observations/:id/preview`, () => new HttpResponse(new Uint8Array([1]), { headers: { "Content-Type": "image/png" } })));
    const { services } = await openMap(collection(feature("a1", "Prestea", "2026-04-30")), { a1: [withPreview("o1", "2026-04-30")] });
    select("a1");
    await userEvent.click(await screen.findByRole("button", { name: MAP_TEXT.showPreview }));
    await waitFor(() => expect(created).toEqual(["blob:map-1"]));
    await act(async () => {
      await services.router.navigate("/areas");
    });
    await screen.findByRole("heading", { level: 1, name: "Areas" });
    expect(revoked).toContain("blob:map-1");
  });

  it("shows the error beside the control and leaves the map unchanged when the preview fails", async () => {
    server.use(http.get(`${API}/observations/:id/preview`, () => HttpResponse.json(envelope("NOT_FOUND", "x"), { status: 404 })));
    await openMap(collection(feature("a1", "Prestea", "2026-04-30")), { a1: [withPreview("o1", "2026-04-30")] });
    select("a1");
    const button = await screen.findByRole("button", { name: MAP_TEXT.showPreview });
    await userEvent.click(button);
    const panel = screen.getByRole("region", { name: "Prestea" });
    expect(await within(panel).findByRole("alert")).toHaveTextContent("The requested item was not found.");
    expect(map().sources.has(PREVIEW_SOURCE)).toBe(false);
    expect(screen.getByRole("button", { name: MAP_TEXT.showPreview })).toBeEnabled();
    expect(created).toEqual([]);
  });
});
