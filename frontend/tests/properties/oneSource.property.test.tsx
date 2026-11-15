// Feature: eco-sentinel-frontend, Property 17: One source per data request
import { cleanup, render, screen } from "@testing-library/react";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { buildQuery } from "@/core/api/client";
import { NdviChart } from "@/features/timeseries/NdviChart";
import { fromUtcMs } from "@/lib/dates";
import { TIME_SERIES_TEXT } from "@/lib/messages";
import { singleSourceSeries, validateTimeSeriesFilters, type ChartPoint, type TimeSeriesFilters } from "@/lib/timeseries";

import { propertyConfig } from "./propertyConfig";

// vi.mock is hoisted above imports, so the helper is loaded inside the factory.
vi.mock("recharts", async (importOriginal) => (await import("../mocks/recharts")).rechartsWithFixedSize(importOriginal));

const DAY = 86_400_000;
const date = fc.integer({ min: Date.UTC(2015, 0, 1) / DAY, max: Date.UTC(2026, 0, 1) / DAY }).map((d) => fromUtcMs(d * DAY));
const source = fc.constantFrom("sentinel-2" as const, "landsat-8" as const);

const filters: fc.Arbitrary<TimeSeriesFilters> = fc.record({
  source: fc.option(source, { nil: null }),
  date_from: fc.oneof(fc.constant(""), date),
  date_to: fc.oneof(fc.constant(""), date),
  max_cloud_coverage: fc.oneof(fc.constant(""), fc.integer({ min: -5, max: 120 }).map(String), fc.constant("abc")),
  include_weather: fc.boolean(),
});

const point = (src: ChartPoint["source"], d: string): ChartPoint => ({
  date: d,
  source: src,
  ndvi_mean: 0.5,
  cloud_coverage_pct: 1,
  data_coverage_pct: 100,
  quality: { level: "good", cloud_coverage_pct: 1, data_coverage_pct: 100, warnings: [] },
  gap_days_from_previous: null,
  weather: null,
});

describe("Property 17: One source per data request", () => {
  it("every accepted filter state gives a query with exactly one valid source", () => {
    fc.assert(
      fc.property(filters, (f) => {
        const result = validateTimeSeriesFilters(f);
        if (f.source === null) expect(result.ok).toBe(false);
        if (!result.ok) return;
        const query = buildQuery("/areas/a1/ndvi/timeseries", { ...result.params });
        expect(query.getAll("source")).toEqual([f.source]);
      }),
      propertyConfig,
    );
  });

  it("a chart input with both sensors is refused and draws no series", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(source, date), { minLength: 2, maxLength: 8 }), (raw) => {
        const points = raw.map(([s, d]) => point(s, d));
        const mixed = new Set(points.map((p) => p.source)).size > 1;
        const series = singleSourceSeries(points);
        expect(series === null).toBe(mixed);
        const { container } = render(<NdviChart points={points} />);
        try {
          if (mixed) {
            expect(screen.getByRole("alert")).toHaveTextContent(TIME_SERIES_TEXT.mixedSources);
            expect(container.querySelector(".recharts-line")).toBeNull();
          } else {
            expect(screen.queryByText(TIME_SERIES_TEXT.mixedSources)).toBeNull();
            expect(container.querySelectorAll(".recharts-line")).toHaveLength(1);
          }
        } finally {
          cleanup();
        }
      }),
      { ...propertyConfig },
    );
  });
});
