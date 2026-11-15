// Feature: eco-sentinel-frontend, Property 20: Threshold override validation and minimal request
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  buildComparisonRequest,
  buildThresholds,
  THRESHOLD_KEYS,
  THRESHOLD_RANGE,
  validateThresholdOverrides,
  type ThresholdDefaults,
  type ThresholdInputs,
} from "@/lib/comparison";

import { propertyConfig } from "./propertyConfig";

const input = fc.oneof(
  fc.constant(""),
  fc.double({ min: -5, max: 150, noNaN: true, noDefaultInfinity: true }).map((v) => String(Math.round(v * 100) / 100)),
  fc.integer({ min: -10, max: 200 }).map(String),
  fc.constantFrom("abc", "1e2", " 0.5 ", "NaN", "Infinity", "--1", "0.", ".5", "2.00", "2.01"),
);
const inputs: fc.Arbitrary<ThresholdInputs> = fc.record({ ndvi_diff: input, max_cloud: input, min_data_coverage: input });

/** Reference model of "a number within its range", independent of the implementation. */
function accepts(key: (typeof THRESHOLD_KEYS)[number], text: string): boolean {
  const t = text.trim();
  if (t === "") return true;
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(t)) return false;
  const v = Number(t);
  return v >= THRESHOLD_RANGE[key].min && v <= THRESHOLD_RANGE[key].max;
}

const defaults: fc.Arbitrary<ThresholdDefaults> = fc.record(
  {
    ndvi_diff: fc.constantFrom(0.1, 0.15, 0.2),
    max_cloud: fc.constantFrom(20, 30, 50),
    min_data_coverage: fc.constantFrom(70, 80, 90),
  },
  { requiredKeys: [] },
);

describe("Property 20: Threshold override validation and minimal request", () => {
  it("accepts a field iff it is empty or a number within its range", () => {
    fc.assert(
      fc.property(inputs, (values) => {
        const result = validateThresholdOverrides(values);
        const expected = THRESHOLD_KEYS.every((k) => accepts(k, values[k]));
        expect(result.ok).toBe(expected);
        if (!result.ok) {
          for (const k of THRESHOLD_KEYS) expect(result.errors[k] !== undefined).toBe(!accepts(k, values[k]));
        }
      }),
      propertyConfig,
    );
  });

  it("sends exactly the fields that differ from the defaults, and nothing when none differs", () => {
    fc.assert(
      fc.property(defaults, fc.record({ ndvi_diff: fc.option(fc.constantFrom(0.1, 0.15, 0.3), { nil: undefined }), max_cloud: fc.option(fc.constantFrom(20, 30, 60), { nil: undefined }), min_data_coverage: fc.option(fc.constantFrom(70, 80, 95), { nil: undefined }) }), (d, edited) => {
        const values = Object.fromEntries(Object.entries(edited).filter(([, v]) => v !== undefined));
        const thresholds = buildThresholds(d, values);
        const changed = THRESHOLD_KEYS.filter((k) => values[k] !== undefined && values[k] !== d[k]);
        if (changed.length === 0) expect(thresholds).toBeUndefined();
        else expect(Object.keys(thresholds ?? {}).sort()).toEqual([...changed].sort());

        // The full request omits `thresholds` entirely when nothing changed.
        const text = (k: (typeof THRESHOLD_KEYS)[number]) => (values[k] === undefined ? (d[k] === undefined ? "" : String(d[k])) : String(values[k]));
        const request = buildComparisonRequest(
          {
            source: "sentinel-2",
            first: "2025-01-01",
            second: "2026-01-01",
            include_weather: false,
            thresholds: { ndvi_diff: text("ndvi_diff"), max_cloud: text("max_cloud"), min_data_coverage: text("min_data_coverage") },
          },
          d,
        );
        expect(request.ok).toBe(true);
        if (request.ok) expect("thresholds" in request.body).toBe(changed.length > 0);
      }),
      propertyConfig,
    );
  });
});
