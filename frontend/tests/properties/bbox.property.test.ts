// Feature: eco-sentinel-frontend, Property 21: Bounding box validation
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatBbox, parseBbox, validateBbox, type BboxInputs } from "@/lib/bbox";

import { propertyConfig } from "./propertyConfig";

const number = fc.oneof(
  fc.double({ min: -200, max: 200, noNaN: true, noDefaultInfinity: true }),
  fc.integer({ min: -200, max: 200 }),
  fc.constantFrom(-180, 180, -90, 90, 0, -0),
);
const field = fc.oneof({ weight: 6, arbitrary: number.map(String) }, { weight: 1, arbitrary: fc.constantFrom("", " ", "abc", "1,5", "NaN", "Infinity", "1e400", "--1", "0x10") });
const inputs: fc.Arbitrary<BboxInputs> = fc.record({ minLon: field, minLat: field, maxLon: field, maxLat: field });

/** Reference model written from the property statement. */
function expected(i: BboxInputs): boolean {
  const v = [i.minLon, i.minLat, i.maxLon, i.maxLat].map((t) => (/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(t.trim()) ? Number(t.trim()) : Number.NaN));
  if (!v.every(Number.isFinite)) return false;
  const [minLon, minLat, maxLon, maxLat] = v as [number, number, number, number];
  const lonOk = (x: number) => x >= -180 && x <= 180;
  const latOk = (x: number) => x >= -90 && x <= 90;
  return lonOk(minLon) && lonOk(maxLon) && latOk(minLat) && latOk(maxLat) && minLon < maxLon && minLat < maxLat;
}

describe("Property 21: Bounding box validation", () => {
  it("accepts iff four finite numbers in range with each minimum below its maximum, and round-trips", () => {
    fc.assert(
      fc.property(inputs, (i) => {
        const result = validateBbox(i);
        expect(result.ok).toBe(expected(i));
        if (result.ok) {
          expect(parseBbox(formatBbox(result.box))).toEqual(result.box);
        } else {
          expect(Object.keys(result.errors).length).toBeGreaterThan(0);
        }
      }),
      propertyConfig,
    );
  });

  it("parses only well-formed query values", () => {
    expect(parseBbox("-2.3,5.1,-1.9,5.6")).toEqual([-2.3, 5.1, -1.9, 5.6]);
    expect(parseBbox("-2.3,5.1,-1.9")).toBeNull();
    expect(parseBbox("1,1,1,1")).toBeNull();
    expect(parseBbox("")).toBeNull();
  });
});
