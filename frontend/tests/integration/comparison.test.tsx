import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import { sessionComparisons } from "@/features/comparison/sessionComparisons";
import { COMPARISON_FLAG_LABEL, COMPARISON_TEXT, ERROR_TEXT, EVIDENCE_TEXT, REGION_TEXT, WARNING_TEXT } from "@/lib/messages";
import type { ComparisonRequest, Observation } from "@/types/api";

import { renderSignedIn } from "../auth/authHarness";
import { tokenRequests } from "../msw/cognito";
import { API, buildArea, buildComparison, buildObservation, buildPublicSettings, envelope, page } from "../msw/contract";
import { server } from "../msw/server";

const SUMMARY = "Difference flagged for investigation: mean NDVI changed by +0.1739 between 6 Mar 2026 and 30 Apr 2026.";

let bodies: ComparisonRequest[];

function observationsFor(source: string | null): Observation[] {
  if (source === "landsat-8") return [buildObservation({ id: "l1", date: "2026-02-10", source: "landsat-8" })];
  return [
    buildObservation({ id: "s3", date: "2026-04-30" }),
    buildObservation({ id: "s2", date: "2026-03-06" }),
    buildObservation({ id: "s1", date: "2025-12-01" }),
  ];
}

function install(respond: (body: ComparisonRequest) => Response | Promise<Response> = () => HttpResponse.json(buildComparison({ summary_text: SUMMARY }))): void {
  server.use(
    http.get(`${API}/areas/:id`, () => HttpResponse.json(buildArea({ id: "a1", name: "Prestea" }))),
    http.get(`${API}/settings`, () => HttpResponse.json(buildPublicSettings())),
    http.get(`${API}/areas/:id/observations`, ({ request }) => {
      const q = new URL(request.url).searchParams;
      const items = q.get("limit") === "1" ? observationsFor(null).slice(0, 1) : observationsFor(q.get("source"));
      return HttpResponse.json({ ...page(items, { limit: Number(q.get("limit")) }), meta: { resolution_class: {} } });
    }),
    http.post(`${API}/areas/:id/comparisons`, async ({ request }) => {
      const body = (await request.json()) as ComparisonRequest;
      bodies.push(body);
      return respond(body);
    }),
  );
}

async function choose(first: string, second: string): Promise<void> {
  const firstSelect = await screen.findByLabelText(COMPARISON_TEXT.firstDate);
  await waitFor(() => expect(within(firstSelect).getAllByRole("option").length).toBeGreaterThan(1));
  await userEvent.selectOptions(firstSelect, first);
  await userEvent.selectOptions(screen.getByLabelText(COMPARISON_TEXT.secondDate), second);
}

const submit = () => userEvent.click(screen.getByRole("button", { name: COMPARISON_TEXT.submit }));

beforeEach(() => {
  sessionStorage.clear();
  tokenRequests.length = 0;
  bodies = [];
  sessionComparisons.clear();
});

describe("comparison (Requirement 11)", () => {
  it("lists only stored dates of the chosen sensor and sends the earlier date as date_a", async () => {
    install();
    await renderSignedIn("/areas/a1/compare");
    const firstSelect = await screen.findByLabelText(COMPARISON_TEXT.firstDate);
    await waitFor(() => expect(within(firstSelect).getAllByRole("option")).toHaveLength(4));
    expect(within(firstSelect).getAllByRole("option").map((o) => o.textContent)).toEqual([
      COMPARISON_TEXT.chooseDate,
      "30 Apr 2026",
      "6 Mar 2026",
      "1 Dec 2025",
    ]);
    expect(screen.getByRole("checkbox", { name: COMPARISON_TEXT.weather })).not.toBeChecked();

    await choose("2026-04-30", "2026-03-06");
    await submit();
    await screen.findByRole("heading", { name: COMPARISON_TEXT.resultTitle });
    expect(bodies).toEqual([{ source: "sentinel-2", date_a: "2026-03-06", date_b: "2026-04-30", include_weather: false }]);
    // The Backend flag is recorded for the dashboard indicator.
    expect(sessionComparisons.get("a1")).toEqual({ flag: "flagged", source: "sentinel-2", date_a: "2026-03-06", date_b: "2026-04-30" });
  });

  it("lists the other sensor's dates after switching sensor", async () => {
    install();
    await renderSignedIn("/areas/a1/compare");
    await choose("2026-04-30", "2026-03-06");
    await userEvent.click(screen.getByRole("radio", { name: "Landsat 8" }));
    const firstSelect = screen.getByLabelText(COMPARISON_TEXT.firstDate);
    await waitFor(() => expect(within(firstSelect).getAllByRole("option").map((o) => o.textContent)).toEqual([COMPARISON_TEXT.chooseDate, "10 Feb 2026"]));
    expect(firstSelect).toHaveValue("");
  });

  it.each([
    ["equal dates", "2026-04-30", "2026-04-30", "second", "Select two different dates."],
    ["a missing date", "2026-04-30", "", "second", "Select a date."],
  ])("refuses %s with a field error, sends nothing and keeps the selections", async (_l, first, second, _field, message) => {
    install();
    await renderSignedIn("/areas/a1/compare");
    const firstSelect = await screen.findByLabelText(COMPARISON_TEXT.firstDate);
    await waitFor(() => expect(within(firstSelect).getAllByRole("option").length).toBeGreaterThan(1));
    await userEvent.selectOptions(firstSelect, first);
    if (second) await userEvent.selectOptions(screen.getByLabelText(COMPARISON_TEXT.secondDate), second);
    await submit();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText(COMPARISON_TEXT.secondDate)).toHaveAttribute("aria-invalid", "true");
    expect(bodies).toHaveLength(0);
    expect(firstSelect).toHaveValue(first);
  });

  it("shows the cross-sensor message and keeps the selections", async () => {
    install(() => HttpResponse.json(envelope("CROSS_SENSOR_COMPARISON", "x"), { status: 422 }));
    await renderSignedIn("/areas/a1/compare");
    await choose("2026-04-30", "2026-03-06");
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(ERROR_TEXT.CROSS_SENSOR_COMPARISON);
    expect(screen.getByLabelText(COMPARISON_TEXT.firstDate)).toHaveValue("2026-04-30");
    expect(screen.queryByRole("button", { name: REGION_TEXT.retry })).not.toBeInTheDocument();
  });

  it("names the date without a stored observation for a 404", async () => {
    install(() => HttpResponse.json(envelope("NOT_FOUND", "No sentinel-2 observation is stored for 2026-03-06."), { status: 404 }));
    await renderSignedIn("/areas/a1/compare");
    await choose("2026-04-30", "2026-03-06");
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("No sentinel-2 observation is stored for 2026-03-06.");
    expect(screen.getByLabelText(COMPARISON_TEXT.secondDate)).toHaveValue("2026-03-06");
  });

  it("offers a retry for a server error that repeats the same request", async () => {
    let fail = true;
    install(() => (fail ? HttpResponse.json(envelope("SERVICE_UNAVAILABLE", "x"), { status: 503 }) : HttpResponse.json(buildComparison())));
    await renderSignedIn("/areas/a1/compare");
    await choose("2026-04-30", "2026-03-06");
    await submit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(COMPARISON_TEXT.errorContext);
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: REGION_TEXT.retry }));
    await screen.findByRole("heading", { name: COMPARISON_TEXT.resultTitle });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
  });

  it("disables the submit control while the request is pending", async () => {
    install(async () => {
      await delay(200);
      return HttpResponse.json(buildComparison());
    });
    await renderSignedIn("/areas/a1/compare");
    await choose("2026-04-30", "2026-03-06");
    await submit();
    expect(screen.getByRole("button", { name: COMPARISON_TEXT.submitting })).toBeDisabled();
    await screen.findByRole("heading", { name: COMPARISON_TEXT.resultTitle });
    expect(bodies).toHaveLength(1);
  });

  it("shows the result as received: cards, signed values, flag, summary unchanged, warnings, weather and limitations", async () => {
    install(() =>
      HttpResponse.json(
        buildComparison({
          a: buildObservation({ date: "2026-03-06", ndvi: { mean: 0.5219, min: null, max: null, std: null, median: null } }),
          b: buildObservation({ date: "2026-04-30", ndvi: { mean: 0.6958, min: null, max: null, std: null, median: 0.71 } }),
          ndvi_diff: 0.1739,
          ndvi_diff_pct: null,
          summary_text: SUMMARY,
          quality: { level: "limited", cloud_coverage_pct: 5, data_coverage_pct: null, warnings: [{ code: "LOW_QUALITY_OBSERVATION", message: "x" }] },
          warnings: [
            { code: "PERCENT_DIFFERENCE_UNDEFINED", message: "x" },
            { code: "LOW_QUALITY_OBSERVATION", message: "x" },
            { code: "BRAND_NEW_CODE", message: "" },
          ],
          weather: {
            a: { provider: "ExampleWeather", period: { from: "2026-03-05", to: "2026-03-06" }, values: { precipitation: { value: 3, unit: "mm" } }, note: "Context only; correlation does not imply causation." },
            b: null,
            between: { provider: "ExampleWeather", period: { from: "2026-03-06", to: "2026-04-30" }, values: { precipitation: { value: 210, unit: "mm" } }, note: "Context only; correlation does not imply causation." },
          },
          limitations: ["Seasonal effects are not removed.", "NDVI values are polygon-level aggregates."],
        }),
      ),
    );
    const { container } = await renderSignedIn("/areas/a1/compare");
    await choose("2026-03-06", "2026-04-30");
    await userEvent.click(screen.getByRole("checkbox", { name: COMPARISON_TEXT.weather }));
    await submit();
    await screen.findByRole("heading", { name: COMPARISON_TEXT.resultTitle });
    expect(bodies[0]?.include_weather).toBe(true);

    const a = screen.getByRole("article", { name: COMPARISON_TEXT.dateA });
    const b = screen.getByRole("article", { name: COMPARISON_TEXT.dateB });
    expect(a).toHaveTextContent("6 Mar 2026");
    expect(within(a).queryByText("Median NDVI")).not.toBeInTheDocument();
    expect(within(b).getByText("0.7100")).toBeInTheDocument();
    expect(screen.getByTestId("ndvi-diff")).toHaveTextContent("+0.1739");
    expect(screen.getByTestId("ndvi-diff-pct")).toHaveTextContent("Not defined");
    expect(screen.getByTestId("interval")).toHaveTextContent("55 days");
    expect(screen.getByText(COMPARISON_FLAG_LABEL.flagged)).toBeInTheDocument();
    expect(screen.getByText("Difference of +0.1739 is at or above the investigation threshold of 0.1000.")).toBeInTheDocument();
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    expect(screen.getByText(EVIDENCE_TEXT.spatialUnavailable)).toBeInTheDocument();
    expect(screen.getByText(WARNING_TEXT.PERCENT_DIFFERENCE_UNDEFINED)).toBeInTheDocument();
    expect(screen.getAllByText(WARNING_TEXT.LOW_QUALITY_OBSERVATION)).toHaveLength(1);
    expect(screen.getByText("Unrecognised notice (BRAND_NEW_CODE)")).toBeInTheDocument();
    expect(screen.getByText("210 mm")).toBeInTheDocument();
    expect(screen.getAllByText("Context only; correlation does not imply causation.")).toHaveLength(2);
    expect(screen.getByText("Seasonal effects are not removed.")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("threshold overrides (Requirements 11.15, 11.16)", () => {
  it("prefills from GET /settings and sends only the changed override", async () => {
    install();
    await renderSignedIn("/areas/a1/compare");
    await userEvent.click(await screen.findByText(COMPARISON_TEXT.advanced));
    expect(screen.getByText(COMPARISON_TEXT.advancedNote)).toBeInTheDocument();
    const settings = buildPublicSettings();
    const ndvi = screen.getByLabelText(COMPARISON_TEXT.ndviDiff);
    await waitFor(() => expect(ndvi).toHaveValue(String(settings.ndvi_diff_threshold)));
    expect(screen.getByLabelText(COMPARISON_TEXT.maxCloud)).toHaveValue(String(settings.cloud_limit_pct));
    await userEvent.clear(ndvi);
    await userEvent.type(ndvi, "0.25");
    await choose("2026-04-30", "2026-03-06");
    await submit();
    await screen.findByRole("heading", { name: COMPARISON_TEXT.resultTitle });
    expect(bodies[0]?.thresholds).toEqual({ ndvi_diff: 0.25 });
  });

  it("refuses an out-of-range override before sending", async () => {
    install();
    await renderSignedIn("/areas/a1/compare");
    await userEvent.click(await screen.findByText(COMPARISON_TEXT.advanced));
    const cloud = screen.getByLabelText(COMPARISON_TEXT.maxCloud);
    await userEvent.clear(cloud);
    await userEvent.type(cloud, "120");
    await choose("2026-04-30", "2026-03-06");
    await submit();
    expect(await screen.findByText(COMPARISON_TEXT.rangePercent)).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it("shows Backend 422 field messages next to the matching fields", async () => {
    install(() =>
      HttpResponse.json(envelope("VALIDATION_ERROR", "x", { fields: [{ field: "thresholds.min_data_coverage", reason: "Backend says no." }] }), { status: 422 }),
    );
    await renderSignedIn("/areas/a1/compare");
    await choose("2026-04-30", "2026-03-06");
    await submit();
    expect(await screen.findByText("Backend says no.")).toBeInTheDocument();
    expect(screen.getByLabelText(COMPARISON_TEXT.minDataCoverage)).toHaveAttribute("aria-invalid", "true");
  });
});
