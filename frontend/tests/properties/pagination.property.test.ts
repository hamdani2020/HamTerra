import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { buildQuery } from "@/core/api/client";
import { clampLimit, clampOffset, maxLimitFor } from "@/lib/pagination";
import { propertyConfig } from "./propertyConfig";

const listPaths = fc.constantFrom(
  "/areas",
  "/areas/a1/observations",
  "/reports",
  "/admin/users",
  "/admin/retrievals",
  "/admin/activity",
);
const anyNumber = fc.oneof(
  fc.double({ noNaN: false }),
  fc.integer({ min: -1000, max: 1000 }),
  fc.constantFrom(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN, 0, 1, 100, 101, 200, 201),
);

describe("pagination clamping", () => {
  // Feature: eco-sentinel-frontend, Property 10: For any number given as limit and any list endpoint, clampLimit returns an integer between 1 and the endpoint maximum (100 for /admin/users, /admin/retrievals, /admin/activity, otherwise 200), returns the input unchanged when it is already an integer in that range, and clampOffset returns an integer of 0 or more.
  it("Property 10: pagination clamping", () => {
    fc.assert(
      fc.property(listPaths, anyNumber, anyNumber, (path, limit, offset) => {
        const max = path.startsWith("/admin/") ? 100 : 200;
        expect(maxLimitFor(path)).toBe(max);
        const clamped = clampLimit(path, limit);
        expect(Number.isInteger(clamped)).toBe(true);
        expect(clamped).toBeGreaterThanOrEqual(1);
        expect(clamped).toBeLessThanOrEqual(max);
        if (Number.isInteger(limit) && limit >= 1 && limit <= max) expect(clamped).toBe(limit);
        const off = clampOffset(offset);
        expect(Number.isInteger(off)).toBe(true);
        expect(off).toBeGreaterThanOrEqual(0);
        // `===`, not Object.is: an offset of -0 is returned as 0, which is the same offset.
        if (Number.isInteger(offset) && offset >= 0) expect(off === offset).toBe(true);
        // The request carries the clamped values.
        const query = buildQuery(path, { limit, offset });
        expect(query.get("limit")).toBe(String(clamped));
        expect(query.get("offset")).toBe(String(off));
      }),
      propertyConfig,
    );
  });
});
