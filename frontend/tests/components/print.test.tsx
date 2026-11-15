import { act, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { NdviChart, PRINT_CHART_WIDTH } from "@/features/timeseries/NdviChart";
import type { ChartPoint } from "@/lib/timeseries";

vi.mock("recharts", async (importOriginal) => (await import("../mocks/recharts")).rechartsWithFixedSize(importOriginal));

const point = (date: string, mean: number): ChartPoint => ({
  date,
  source: "sentinel-2",
  ndvi_mean: mean,
  cloud_coverage_pct: 1,
  data_coverage_pct: 100,
  quality: { level: "good", cloud_coverage_pct: 1, data_coverage_pct: 100, warnings: [] },
  gap_days_from_previous: null,
  weather: null,
});

describe("printing (Requirement 15.11)", () => {
  it("redraws the chart at the print width for printing and back afterwards", () => {
    const { container } = render(<NdviChart points={[point("2026-01-01", 0.5), point("2026-02-01", 0.6)]} />);
    const width = () => container.querySelector("svg.recharts-surface")?.getAttribute("width");
    expect(width()).toBe("800"); // the screen size from the test container
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(width()).toBe(String(PRINT_CHART_WIDTH));
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(width()).toBe("800");
  });

  it("keeps the print rules that lay the report out on paper", () => {
    const css = readFileSync("src/styles/print.css", "utf8");
    // The two-column shell becomes one block, so the content uses the page width.
    expect(css).toMatch(/\[data-print="shell"\]\s*\{[^}]*display:\s*block/);
    // Long sections flow across pages; only small units are kept whole.
    expect(css).not.toMatch(/^\s*section,\s*$/m);
    expect(css).toMatch(/\[data-print="map"\] \.maplibregl-canvas\s*\{[^}]*object-fit:\s*contain/);
    expect(css).toMatch(/\[data-print="show"\][^}]*display:\s*block/);
  });
});
