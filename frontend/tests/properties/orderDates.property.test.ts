// Feature: eco-sentinel-frontend, Property 12: Comparison date ordering
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fromUtcMs, orderDates } from "@/lib/dates";

import { propertyConfig } from "./propertyConfig";

const DAY = 86_400_000;
const validDate = fc.integer({ min: Date.UTC(2013, 0, 1) / DAY, max: Date.UTC(2035, 0, 1) / DAY }).map((d) => fromUtcMs(d * DAY));

describe("Property 12: Comparison date ordering", () => {
  it("distinct dates give the earlier as date_a, for either argument order", () => {
    fc.assert(
      fc.property(validDate, validDate, (x, y) => {
        fc.pre(x !== y);
        const one = orderDates(x, y);
        const two = orderDates(y, x);
        expect(one).toEqual(two);
        expect(one.ok).toBe(true);
        if (!one.ok) return;
        expect(one.date_a < one.date_b).toBe(true);
        expect(new Set([one.date_a, one.date_b])).toEqual(new Set([x, y]));
      }),
      propertyConfig,
    );
  });

  it("equal or missing dates give an error and no dates", () => {
    fc.assert(
      fc.property(
        validDate,
        fc.constantFrom<"equal" | "first" | "second" | "both">("equal", "first", "second", "both"),
        fc.constantFrom(undefined, null, ""),
        (date, kind, empty) => {
          const [a, b] =
            kind === "equal" ? [date, date] : kind === "first" ? [empty, date] : kind === "second" ? [date, empty] : [empty, empty];
          const result = orderDates(a, b);
          expect(result.ok).toBe(false);
          expect(result).not.toHaveProperty("date_a");
          if (result.ok) return;
          if (kind === "equal") expect(result.errors.date_b).toBeTruthy();
          if (kind === "first" || kind === "both") expect(result.errors.date_a).toBeTruthy();
          if (kind === "second" || kind === "both") expect(result.errors.date_b).toBeTruthy();
        },
      ),
      propertyConfig,
    );
  });
});
