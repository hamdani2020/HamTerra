import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import { PointTooltip } from "@/features/timeseries/NdviChart";
import { EVIDENCE_TEXT, REGION_TEXT, TIME_SERIES_TEXT, WARNING_TEXT } from "@/lib/messages";
import type { Observation, TimeSeriesPoint, TimeSeriesResponse } from "@/types/api";

import { renderSignedIn } from "../auth/authHarness";
import { tokenRequests } from "../msw/cognito";
import { API, buildArea, buildObservation, buildTimeSeries, envelope, page } from "../msw/contract";
import { server } from "../msw/server";

vi.mock("recharts", async (importOriginal) => (await import("../mocks/recharts")).rechartsWithFixedSize(importOriginal));

const LIMITATIONS = [
  "NDVI values are polygon-level aggregates and say nothing about where inside the polygon a value comes from.",
  "Seasonal effects are not removed.",
  "Weather is not controlled for.",
];

function point(date: string, mean: number, extra: Partial<TimeSeriesPoint> = {}): TimeSeriesPoint {
  return {
    date,
    ndvi_mean: mean,
    cloud_coverage_pct: 5,
    data_coverage_pct: 100,
    quality: { level: "good", cloud_coverage_pct: 5, data_coverage_pct: 100, warnings: [] },
    gap_days_from_previous: null,
    weather: null,
    ...extra,
  };
}

function series(overrides: Partial<TimeSeriesResponse> = {}): TimeSeriesResponse {
  return buildTimeSeries({
    area_id: "a1",
    source: "sentinel-2",
    points: [
      point("2026-02-01", 0.61),
      point("2026-03-03", 0.65, { gap_days_from_previous: 30, data_coverage_pct: null, quality: { level: "poor", cloud_coverage_pct: 60, data_coverage_pct: null, warnings: [] } }),
      point("2026-04-30", 0.6958, { gap_days_from_previous: 58 }),
    ],
    summary: { count: 3, first_date: "2026-02-01", last_date: "2026-04-30", min: 0.61, max: 0.6958, mean_of_means: 0.652, trend_per_30d: 0.0291 },
    meta: { excluded_by_cloud: 0, resolution_class: "10 m nominal sensor resolution" },
    warnings: [{ code: "IRREGULAR_SAMPLING", message: "Backend wording" }],
    limitations: LIMITATIONS,
    ...overrides,
  });
}

let requests: URLSearchParams[];

function install({
  latest = [buildObservation({ source: "landsat-8" })] as Observation[],
  respond = (_q: URLSearchParams): Response => HttpResponse.json(series({ source: (_q.get("source") as "sentinel-2") ?? "sentinel-2" })),
  area = () => HttpResponse.json(buildArea({ id: "a1", name: "Prestea" })),
}: {
  latest?: Observation[];
  respond?: (q: URLSearchParams) => Response;
  area?: () => Response;
} = {}): void {
  server.use(
    http.get(`${API}/areas/:id`, area),
    http.get(`${API}/areas/:id/observations`, () => HttpResponse.json({ ...page(latest, { limit: 1 }), meta: { resolution_class: {} } })),
    http.get(`${API}/areas/:id/ndvi/timeseries`, ({ request }) => {
      const q = new URL(request.url).searchParams;
      requests.push(q);
      return respond(q);
    }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  tokenRequests.length = 0;
  requests = [];
});

const chart = () => screen.getByRole("figure");

describe("time series (Requirement 10)", () => {
  it("preselects the latest observation's sensor and shows one chart, table, summary and limitations", async () => {
    install({ respond: () => HttpResponse.json(series({ source: "landsat-8" })) });
    await renderSignedIn("/areas/a1/timeseries");
    expect(await screen.findByRole("figure", { name: "Mean NDVI, Landsat 8" })).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.getAll("source")).toEqual(["landsat-8"]);
    expect(screen.getByRole("radio", { name: "Landsat 8" })).toBeChecked();

    // One marker per point; the poor point is the hollow diamond.
    expect(within(chart()).getAllByTestId("marker")).toHaveLength(2);
    expect(within(chart()).getAllByTestId("marker-poor")).toHaveLength(1);
    expect(screen.getAllByRole("figure")).toHaveLength(1);
    expect(chart()).toHaveAccessibleDescription("Chart of 3 NDVI points for Landsat 8 from 1 Feb 2026 to 30 Apr 2026.");
    expect(within(screen.getByTestId("ndvi-legend")).getByText(TIME_SERIES_TEXT.legendPoor)).toBeInTheDocument();

    const table = screen.getByRole("table", { name: TIME_SERIES_TEXT.pointsTable });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("Not reported")).toBeInTheDocument();
    expect(within(table).getByText(TIME_SERIES_TEXT.notApplicable)).toBeInTheDocument();

    const summary = screen.getByTestId("ts-summary");
    expect(summary).toHaveTextContent(`${EVIDENCE_TEXT.trendLabel}+0.0291`);
    expect(summary).toHaveTextContent("Mean of the mean NDVI values0.6520");

    expect(screen.getByText(WARNING_TEXT.IRREGULAR_SAMPLING)).toBeInTheDocument();
    for (const text of LIMITATIONS) expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText(/Sensor resolution: 10 m nominal sensor resolution/)).toBeInTheDocument();
    expect(screen.getAllByText(EVIDENCE_TEXT.aggregateNote).length).toBeGreaterThan(0);
  });

  it("asks for a source and sends nothing when the latest sensor is unknown, then requests the chosen one", async () => {
    install({ latest: [] });
    const { pathname, services } = await renderSignedIn("/areas/a1/timeseries");
    expect(await screen.findByText(TIME_SERIES_TEXT.chooseSource)).toBeInTheDocument();
    expect(requests).toHaveLength(0);

    await userEvent.click(screen.getByRole("radio", { name: "Sentinel-2" }));
    await userEvent.type(screen.getByLabelText(TIME_SERIES_TEXT.dateFrom), "2025-01-01");
    await userEvent.type(screen.getByLabelText(TIME_SERIES_TEXT.dateTo), "2026-04-30");
    await userEvent.type(screen.getByLabelText(TIME_SERIES_TEXT.maxCloud), "40");
    await userEvent.click(screen.getByRole("button", { name: TIME_SERIES_TEXT.apply }));
    await screen.findByRole("figure", { name: "Mean NDVI, Sentinel-2" });
    expect(requests).toHaveLength(1);
    const q = requests[0];
    expect(q?.getAll("source")).toEqual(["sentinel-2"]);
    expect(q?.get("date_from")).toBe("2025-01-01");
    expect(q?.get("date_to")).toBe("2026-04-30");
    expect(q?.get("max_cloud_coverage")).toBe("40");
    expect(q?.has("include_weather")).toBe(false);
    // Filters are in the URL, so back and forward restore them.
    expect(pathname()).toBe("/areas/a1/timeseries");
    expect(services.router.state.location.search).toContain("source=sentinel-2");
  });

  it.each([
    ["the start is after the end", "2026-05-01", "2026-04-01", "date_from", "The start date must be on or before the end date."],
    ["the range is longer than 3660 days", "2010-01-01", "2026-01-01", "date_to", "The range can be at most 3,660 days."],
  ])("refuses an invalid range when %s, keeps the chart and the values, and sends nothing", async (_l, from, to, _f, message) => {
    install();
    await renderSignedIn("/areas/a1/timeseries?source=sentinel-2");
    await screen.findByRole("figure");
    await userEvent.type(screen.getByLabelText(TIME_SERIES_TEXT.dateFrom), from);
    await userEvent.type(screen.getByLabelText(TIME_SERIES_TEXT.dateTo), to);
    await userEvent.click(screen.getByRole("button", { name: TIME_SERIES_TEXT.apply }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    expect(screen.getByRole("figure")).toBeInTheDocument();
    expect(screen.getByLabelText(TIME_SERIES_TEXT.dateFrom)).toHaveValue(from);
    expect(screen.getByLabelText(TIME_SERIES_TEXT.dateTo)).toHaveValue(to);
  });

  it("rejects a cloud limit outside 0 to 100", async () => {
    install();
    await renderSignedIn("/areas/a1/timeseries?source=sentinel-2");
    await screen.findByRole("figure");
    await userEvent.type(screen.getByLabelText(TIME_SERIES_TEXT.maxCloud), "101");
    await userEvent.click(screen.getByRole("button", { name: TIME_SERIES_TEXT.apply }));
    expect(await screen.findByText(TIME_SERIES_TEXT.maxCloudInvalid)).toBeInTheDocument();
    expect(requests).toHaveLength(1);
  });

  it("shows one point with the insufficient-observations text and no trend", async () => {
    install({
      respond: () =>
        HttpResponse.json(
          series({
            points: [point("2026-04-30", 0.7)],
            summary: { count: 1, first_date: "2026-04-30", last_date: "2026-04-30", min: 0.7, max: 0.7, mean_of_means: 0.7, trend_per_30d: null },
            warnings: [],
          }),
        ),
    });
    await renderSignedIn("/areas/a1/timeseries?source=sentinel-2");
    const figure = await screen.findByRole("figure");
    expect(within(figure).getAllByTestId("marker")).toHaveLength(1);
    expect(screen.getByText(WARNING_TEXT.INSUFFICIENT_OBSERVATIONS)).toBeInTheDocument();
    expect(screen.getByTestId("ts-summary")).toHaveTextContent(`${EVIDENCE_TEXT.trendLabel}Not available`);
  });

  it.each([
    [["researcher"], ["observations:refresh"], true],
    [["researcher"], [], false],
  ])("shows an empty state and no chart for zero points (refresh offered: %#)", async (roles, permissions, offered) => {
    install({
      respond: () =>
        HttpResponse.json(
          series({
            points: [],
            summary: { count: 0, first_date: null, last_date: null, min: null, max: null, mean_of_means: null, trend_per_30d: null },
            warnings: [],
          }),
        ),
    });
    await renderSignedIn("/areas/a1/timeseries?source=sentinel-2", { roles, permissions });
    expect(await screen.findByText(TIME_SERIES_TEXT.empty)).toBeInTheDocument();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: TIME_SERIES_TEXT.refresh }) !== null).toBe(offered);
    for (const text of LIMITATIONS) expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("shows NDVI and a notice, not an error, for weather warnings, and weather values in the table", async () => {
    install({
      respond: (q) => {
        expect(q.get("include_weather")).toBe("true");
        return HttpResponse.json(
          series({
            points: [
              point("2026-03-03", 0.65, {
                weather: {
                  provider: "ExampleWeather",
                  period: { from: "2026-03-02", to: "2026-03-03" },
                  values: { precipitation: { value: 12.4, unit: "mm" } },
                  note: "Weather is context only; correlation does not imply causation.",
                },
              }),
              point("2026-04-30", 0.69),
            ],
            warnings: [
              { code: "WEATHER_UNAVAILABLE", message: "x" },
              { code: "SOME_NEW_CODE", message: "Backend message shown unchanged." },
            ],
            meta: { excluded_by_cloud: 4, resolution_class: "10 m nominal sensor resolution" },
          }),
        );
      },
    });
    await renderSignedIn("/areas/a1/timeseries?source=sentinel-2&include_weather=true");
    const figure = await screen.findByRole("figure");
    expect(figure).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(WARNING_TEXT.WEATHER_UNAVAILABLE)).toBeInTheDocument();
    expect(screen.getByText("Backend message shown unchanged.")).toBeInTheDocument();
    expect(screen.getByText(/4 observations excluded by the cloud filter/)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: TIME_SERIES_TEXT.pointsTable });
    expect(within(table).getByText("12.4 mm")).toBeInTheDocument();
    expect(within(table).getByText("ExampleWeather")).toBeInTheDocument();
    expect(within(table).getByText("Weather is context only; correlation does not imply causation.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: TIME_SERIES_TEXT.weather })).toBeChecked();
  });

  it("shows a not-found state with a link to the area list for a 404", async () => {
    install({ area: () => HttpResponse.json(envelope("NOT_FOUND", "x"), { status: 404 }), respond: () => HttpResponse.json(envelope("NOT_FOUND", "x"), { status: 404 }) });
    await renderSignedIn("/areas/missing/timeseries?source=sentinel-2");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(TIME_SERIES_TEXT.notFound);
    expect(within(alert).getByRole("link", { name: TIME_SERIES_TEXT.toAreas })).toHaveAttribute("href", "/areas");
  });

  it("shows an error with retry and no chart for a server error, keeping the filters", async () => {
    let fail = true;
    install({ respond: () => (fail ? HttpResponse.json(envelope("INTERNAL_ERROR", "x"), { status: 500 }) : HttpResponse.json(series())) });
    await renderSignedIn("/areas/a1/timeseries?source=sentinel-2&date_from=2025-01-01");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(TIME_SERIES_TEXT.errorContext);
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(screen.getByLabelText(TIME_SERIES_TEXT.dateFrom)).toHaveValue("2025-01-01");
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: REGION_TEXT.retry }));
    expect(await screen.findByRole("figure")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

describe("accessibility (Requirement 21.4)", () => {
  it("the time-series page has no axe violations", async () => {
    install();
    const { container } = await renderSignedIn("/areas/a1/timeseries?source=sentinel-2&include_weather=true");
    await screen.findByRole("figure");
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("PointTooltip (Requirement 10.7)", () => {
  it("shows every field, with Not reported and Not applicable for missing values", () => {
    render(
      <PointTooltip
        point={{
          ...point("2026-02-01", 0.61, { data_coverage_pct: null, quality: { level: "limited", cloud_coverage_pct: 5, data_coverage_pct: null, warnings: [] } }),
          source: "sentinel-2",
        }}
      />,
    );
    const tip = screen.getByTestId("ndvi-tooltip");
    expect(tip).toHaveTextContent("1 Feb 2026 · Sentinel-2");
    expect(tip).toHaveTextContent("Mean NDVI0.6100");
    expect(tip).toHaveTextContent("Cloud coverage5.0%");
    expect(tip).toHaveTextContent("Data coverageNot reported");
    expect(tip).toHaveTextContent("QualityLimited");
    expect(tip).toHaveTextContent(`${TIME_SERIES_TEXT.gap}${TIME_SERIES_TEXT.notApplicable}`);
  });
});
