import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { relativeLuminance } from "@/lib/contrast";
import { NDVI_STOPS, ndviRamp } from "@/lib/ndviRamp";
import { propertyConfig } from "./propertyConfig";

const range = fc
  .tuple(fc.double({ min: -5, max: 5, noNaN: true }), fc.double({ min: 0.001, max: 5, noNaN: true }))
  .map(([min, width]) => ({ min, max: min + width }));

describe("NDVI ramp", () => {
  // Feature: eco-sentinel-frontend, Property 32: For any value and any range with min < max, ndviRamp returns a valid 7-character hex colour, returns the first stop for values at or below min and the last stop for values at or above max, and the relative luminance of the returned colour is non-decreasing as the value increases.
  it("Property 32: NDVI ramp", () => {
    fc.assert(
      fc.property(
        range,
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        ({ min, max }, v1, v2) => {
          const [low, high] = v1 <= v2 ? [v1, v2] : [v2, v1];
          const a = ndviRamp(low, min, max);
          const b = ndviRamp(high, min, max);
          expect(a).toMatch(/^#[0-9A-F]{6}$/);
          expect(b).toMatch(/^#[0-9A-F]{6}$/);
          if (low <= min) expect(a).toBe(NDVI_STOPS[0]);
          if (high >= max) expect(b).toBe(NDVI_STOPS[NDVI_STOPS.length - 1]);
          expect(relativeLuminance(b)).toBeGreaterThanOrEqual(relativeLuminance(a));
        },
      ),
      propertyConfig,
    );
  });

  it("is monotonic across a fine sweep of the default range", () => {
    let previous = -1;
    for (let i = 0; i <= 2000; i += 1) {
      const luminance = relativeLuminance(ndviRamp(-1 + i / 1000));
      expect(luminance).toBeGreaterThanOrEqual(previous);
      previous = luminance;
    }
  });

  it("hits the stops at the ends and rejects an empty range", () => {
    expect(ndviRamp(-1)).toBe("#440154");
    expect(ndviRamp(1)).toBe("#FDE725");
    expect(ndviRamp(Number.NaN)).toBe("#440154");
    expect(() => ndviRamp(0, 1, 1)).toThrow();
  });
});
