import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { contrastRatio } from "@/lib/contrast";
import { REQUIRED_RATIO, TOKEN_PAIRS, TOKENS } from "@/styles/tokens";
import { propertyConfig } from "./propertyConfig";

const hexColour = fc
  .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
  .map(([r, g, b]) => `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`);

describe("contrast of design tokens", () => {
  // Feature: eco-sentinel-frontend, Property 31: For any declared foreground and background token pair, the WCAG contrast ratio is at least 4.5 for body text pairs and at least 3 for large text and component boundary pairs, and the ratio function is symmetric in its arguments and lies between 1 and 21.
  it("Property 31: contrast of design tokens", () => {
    fc.assert(
      fc.property(fc.constantFrom(...TOKEN_PAIRS), hexColour, hexColour, (pair, a, b) => {
        const ratio = contrastRatio(TOKENS[pair.fg], TOKENS[pair.bg]);
        expect(ratio, `${pair.use}: ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(
          REQUIRED_RATIO[pair.kind],
        );
        const ab = contrastRatio(a, b);
        expect(ab).toBeCloseTo(contrastRatio(b, a), 12);
        expect(ab).toBeGreaterThanOrEqual(1);
        expect(ab).toBeLessThanOrEqual(21);
      }),
      propertyConfig,
    );
  });

  it("matches known WCAG reference values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    expect(contrastRatio("#FFFFFF", "#047857")).toBeCloseTo(5.48, 1);
  });

  it("checks every declared pair, not only sampled ones", () => {
    for (const pair of TOKEN_PAIRS) {
      expect(contrastRatio(TOKENS[pair.fg], TOKENS[pair.bg])).toBeGreaterThanOrEqual(
        REQUIRED_RATIO[pair.kind],
      );
    }
  });
});
