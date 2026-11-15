import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import { ApiProvider } from "@/core/api/ApiProvider";
import { createApiClient } from "@/core/api/client";
import { createEndpoints } from "@/core/api/endpoints";
import { createHttpGuard } from "@/core/api/httpGuard";
import { useMap } from "@/features/map/useMap";
import { bindPreview, usePreviewOverlay } from "@/features/map/usePreviewOverlay";
import { ObservationDetail } from "@/features/observations/ObservationDetail";
import { ObservationsTable, observationRow } from "@/features/observations/ObservationsTable";
import { EVIDENCE_TEXT, MAP_TEXT, OBSERVATION_TEXT, WARNING_TEXT } from "@/lib/messages";
import type { Observation } from "@/types/api";

import { fakeAuth } from "../api/apiHarness";
import { buildPublicConfig } from "../factories";
import { API, buildObservation, envelope } from "../msw/contract";
import { server } from "../msw/server";
import { maps, resetMaps } from "../mocks/maplibre";

vi.mock("maplibre-gl", () => import("../mocks/maplibre"));

const withPreview = (overrides: Partial<Observation> = {}) =>
  buildObservation({
    id: "o1",
    preview: { url: "/api/v1/observations/o1/preview", width_px: 117, height_px: 117, note: "Backend note." },
    ...overrides,
  });

function Harness({ observation }: { observation: Observation }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const map = useMap(ref, { basemapTileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png" });
  const controller = map.status === "ready" ? map.controller : null;
  const overlay = usePreviewOverlay(controller);
  return (
    <>
      <div ref={ref} />
      <ObservationDetail observation={observation} preview={bindPreview(overlay, observation, [-2.2, 5.3, -2.1, 5.4], controller !== null)} />
    </>
  );
}

function renderWithApi(ui: ReactNode) {
  const api = createEndpoints(createApiClient(createHttpGuard(buildPublicConfig()), fakeAuth()));
  return render(<ApiProvider api={api}>{ui}</ApiProvider>);
}

beforeEach(() => {
  resetMaps();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:obs-1");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("ObservationDetail (Requirement 9)", () => {
  it("shows the stale geometry badge and explanation", async () => {
    const { container } = render(<ObservationDetail observation={buildObservation({ geometry_status: "stale_geometry" })} />);
    expect(screen.getByText(OBSERVATION_TEXT.staleBadge)).toBeInTheDocument();
    expect(screen.getByText(OBSERVATION_TEXT.staleText)).toBeInTheDocument();
    expect(screen.getByText(EVIDENCE_TEXT.aggregateNote)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows Not reported and the coverage text once for null data coverage, next to the cloud value", () => {
    render(
      <ObservationDetail
        observation={buildObservation({
          quality: {
            level: "limited",
            cloud_coverage_pct: 12.5,
            data_coverage_pct: null,
            warnings: [
              { code: "DATA_COVERAGE_UNKNOWN", message: "Backend text" },
              { code: "SOME_NEW_CODE", message: "Backend message for a new code" },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText("12.5%")).toBeInTheDocument();
    expect(screen.getByText("Not reported")).toBeInTheDocument();
    expect(screen.getAllByText(WARNING_TEXT.DATA_COVERAGE_UNKNOWN)).toHaveLength(1);
    expect(screen.getByText("Backend message for a new code")).toBeInTheDocument();
  });

  it("shows No preview available and no control for a null preview URL", () => {
    render(<ObservationDetail observation={buildObservation({ preview: { url: null, width_px: null, height_px: null, note: "n" } })} />);
    expect(screen.getByText(MAP_TEXT.noPreview)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: MAP_TEXT.showPreview })).not.toBeInTheDocument();
  });

  it.each([
    [404, "NOT_FOUND", "The requested item was not found."],
    [502, "UPSTREAM_ERROR", "The data provider failed. Previously stored data is unchanged."],
  ])("shows the %s message beside the control, adds nothing to the map, and keeps the control", async (status, code, text) => {
    let calls = 0;
    server.use(
      http.get(`${API}/observations/:id/preview`, () => {
        calls += 1;
        return HttpResponse.json(envelope(code, "x"), { status });
      }),
    );
    renderWithApi(<Harness observation={withPreview()} />);
    await act(async () => {});
    const button = screen.getByRole("button", { name: MAP_TEXT.showPreview });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    const preview = screen.getByRole("region", { name: OBSERVATION_TEXT.preview });
    expect(await within(preview).findByRole("alert")).toHaveTextContent(text);
    expect(maps.at(-1)?.sources.has("preview")).toBe(false);
    expect(screen.getByRole("button", { name: MAP_TEXT.showPreview })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: MAP_TEXT.showPreview }));
    expect(calls).toBe(2);
  });

  it("disables the control and shows a loading indicator while the preview loads", async () => {
    let release!: () => void;
    server.use(
      http.get(`${API}/observations/:id/preview`, async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return new HttpResponse(new Uint8Array([1]), { headers: { "Content-Type": "image/png" } });
      }),
    );
    renderWithApi(<Harness observation={withPreview()} />);
    await act(async () => {});
    await userEvent.click(screen.getByRole("button", { name: MAP_TEXT.showPreview }));
    expect(screen.getByRole("button", { name: MAP_TEXT.showPreview })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(MAP_TEXT.loadingPreview);
    await act(async () => release());
    expect(await screen.findByRole("button", { name: MAP_TEXT.removePreview })).toBeInTheDocument();
    expect(screen.getByText("Backend note.")).toBeInTheDocument();
  });
});

describe("ObservationsTable", () => {
  it("shows one row per observation with separate cloud and data coverage, and selects a row", async () => {
    const onSelect = vi.fn();
    const rows = [
      buildObservation({ id: "o1", date: "2026-04-30", source: "landsat-8" }),
      buildObservation({ id: "o2", date: "2026-03-01", quality: { level: "poor", cloud_coverage_pct: 80, data_coverage_pct: null, warnings: [] } }),
    ].map(observationRow);
    const { container } = render(<ObservationsTable rows={rows} onSelect={onSelect} />);
    const table = screen.getByRole("table", { name: OBSERVATION_TEXT.tableCaption });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Date",
      "Source",
      "Mean NDVI",
      "Cloud coverage",
      "Data coverage",
      "Quality",
    ]);
    const second = within(table).getAllByRole("row")[2] as HTMLElement;
    expect(within(second).getByText("80.0%")).toBeInTheDocument();
    expect(within(second).getByText("Not reported")).toBeInTheDocument();
    expect(within(second).getByText("Poor")).toBeInTheDocument();
    await userEvent.click(within(table).getByRole("button", { name: /30 Apr 2026, Landsat 8/ }));
    expect(onSelect).toHaveBeenCalledWith("o1");
    expect(await axe(container)).toHaveNoViolations();
  });
});
