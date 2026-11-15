// Feature: eco-sentinel-frontend, Property 19: Backend value display fidelity
import { cleanup, render, screen } from "@testing-library/react";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ComparisonResultView } from "@/features/comparison/ComparisonResultView";
import { formatDays, formatSigned } from "@/lib/format";
import { COMPARISON_FLAG_LABEL } from "@/lib/messages";
import type { ComparisonResult } from "@/types/api";

import { buildComparison, buildObservation } from "../msw/contract";
import { propertyConfig } from "./propertyConfig";

const finite = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

const result: fc.Arbitrary<ComparisonResult> = fc
  .record({
    ndvi_diff: finite(-2, 2),
    ndvi_diff_pct: fc.option(finite(-500, 500), { nil: null }),
    interval_days: fc.integer({ min: 1, max: 5000 }),
    flag: fc.constantFrom("flagged" as const, "not_flagged" as const),
    summary_text: fc.string({ minLength: 1, maxLength: 120 }).filter((s) => s.trim() !== "" && s === s.trim() && !/\s{2}/.test(s)),
  })
  .map((v) => buildComparison({ ...v, a: buildObservation({ id: "a" }), b: buildObservation({ id: "b", date: "2026-05-01" }) }));

describe("Property 19: Backend value display fidelity", () => {
  it("shows the Backend values formatted for display only, and the summary unchanged", () => {
    fc.assert(
      fc.property(result, (r) => {
        render(<ComparisonResultView result={r} />);
        try {
          const diff = screen.getByTestId("ndvi-diff").textContent ?? "";
          expect(diff).toMatch(/^[+-]\d+\.\d{4}$/);
          expect(diff).toBe(formatSigned(r.ndvi_diff, 4));
          const pct = screen.getByTestId("ndvi-diff-pct").textContent ?? "";
          if (r.ndvi_diff_pct === null) expect(pct).toBe("Not defined");
          else expect(pct).toMatch(/^[+-]\d+\.\d{2}%$/);
          expect(screen.getByTestId("interval")).toHaveTextContent(formatDays(r.interval_days));
          expect(screen.getByText(COMPARISON_FLAG_LABEL[r.flag])).toBeInTheDocument();
          expect(screen.getByText(r.summary_text, { normalizer: (s) => s })).toBeInTheDocument();
        } finally {
          cleanup();
        }
      }),
      propertyConfig,
    );
  });

  it("formatSigned(x, 4) carries the sign and round-trips within 0.00005", () => {
    fc.assert(
      fc.property(finite(-1e6, 1e6), (x) => {
        const text = formatSigned(x, 4);
        expect(text.startsWith(x >= 0 ? "+" : "-")).toBe(true);
        expect(Math.abs(Number(text) - x)).toBeLessThanOrEqual(0.00005 + Math.abs(x) * Number.EPSILON * 4);
      }),
      propertyConfig,
    );
  });
});
