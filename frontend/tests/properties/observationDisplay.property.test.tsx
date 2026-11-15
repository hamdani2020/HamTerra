// Feature: eco-sentinel-frontend, Property 30: Observation display
import { cleanup, render, screen, within } from "@testing-library/react";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ObservationDetail } from "@/features/observations/ObservationDetail";
import { formatCoverage, formatNdvi } from "@/lib/format";
import { MAP_TEXT, OBSERVATION_TEXT, QUALITY_LABEL, WARNING_TEXT } from "@/lib/messages";
import type { Observation } from "@/types/api";

import { propertyConfig } from "./propertyConfig";

const ndvi = fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true });
const pct = fc.option(fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }), { nil: null });

const observation: fc.Arbitrary<Observation> = fc.record({
  id: fc.uuid(),
  area_id: fc.constant("a1"),
  date: fc.constantFrom("2024-01-05", "2025-06-30", "2026-04-30"),
  source: fc.constantFrom("sentinel-2" as const, "landsat-8" as const),
  ndvi: fc.record({
    mean: ndvi,
    min: fc.option(ndvi, { nil: null }),
    max: fc.option(ndvi, { nil: null }),
    std: fc.option(fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }), { nil: null }),
    median: fc.option(ndvi, { nil: null }),
  }),
  quality: fc.record({
    level: fc.constantFrom("good" as const, "limited" as const, "poor" as const),
    cloud_coverage_pct: pct,
    data_coverage_pct: pct,
    warnings: fc.constant([]),
  }),
  preview: fc.record({
    url: fc.option(fc.constant("/api/v1/observations/x/preview"), { nil: null }),
    width_px: fc.option(fc.constant(117), { nil: null }),
    height_px: fc.option(fc.constant(117), { nil: null }),
    note: fc.constant("For orientation only."),
  }),
  geometry_status: fc.constantFrom("current" as const, "stale_geometry" as const),
});

/** The value shown next to a label in the detail's definition list. */
function valueOf(container: HTMLElement, label: string): string | null {
  const term = within(container).queryAllByText(label, { selector: "dt" })[0];
  return term?.nextElementSibling?.textContent ?? null;
}

describe("Property 30: Observation display", () => {
  it("shows every required value, the non-null statistics only, and the preview control iff a URL exists", () => {
    fc.assert(
      fc.property(observation, (o) => {
        const { container } = render(<ObservationDetail observation={o} />);
        try {
          expect(valueOf(container, OBSERVATION_TEXT.mean)).toBe(formatNdvi(o.ndvi.mean));
          const stats = [
            [OBSERVATION_TEXT.min, o.ndvi.min],
            [OBSERVATION_TEXT.max, o.ndvi.max],
            [OBSERVATION_TEXT.std, o.ndvi.std],
            [OBSERVATION_TEXT.median, o.ndvi.median],
          ] as const;
          for (const [label, value] of stats) {
            expect(valueOf(container, label)).toBe(value === null ? null : formatNdvi(value));
          }
          // Two separate labelled values; null data coverage is "Not reported" plus the warning.
          expect(valueOf(container, OBSERVATION_TEXT.cloud)).toBe(formatCoverage(o.quality.cloud_coverage_pct));
          expect(valueOf(container, OBSERVATION_TEXT.dataCoverage)).toBe(formatCoverage(o.quality.data_coverage_pct));
          if (o.quality.data_coverage_pct === null) {
            expect(valueOf(container, OBSERVATION_TEXT.dataCoverage)).toBe("Not reported");
            expect(screen.getByText(WARNING_TEXT.DATA_COVERAGE_UNKNOWN)).toBeInTheDocument();
          } else {
            expect(screen.queryByText(WARNING_TEXT.DATA_COVERAGE_UNKNOWN)).not.toBeInTheDocument();
          }
          expect(screen.getAllByText(QUALITY_LABEL[o.quality.level]).length).toBeGreaterThan(0);
          const control = screen.queryByRole("button", { name: MAP_TEXT.showPreview });
          if (o.preview.url === null) {
            expect(control).toBeNull();
            expect(screen.getByText(MAP_TEXT.noPreview)).toBeInTheDocument();
          } else {
            expect(control).not.toBeNull();
            expect(screen.queryByText(MAP_TEXT.noPreview)).toBeNull();
          }
          expect(screen.queryByText(OBSERVATION_TEXT.staleBadge) !== null).toBe(o.geometry_status === "stale_geometry");
        } finally {
          cleanup();
        }
      }),
      propertyConfig,
    );
  });
});
