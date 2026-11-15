// Feature: eco-sentinel-frontend, Property 25: Report form validation
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fromUtcMs, isCalendarDate } from "@/lib/dates";
import { validateReportForm, type ReportFormInput } from "@/lib/reportForm";

import { propertyConfig } from "./propertyConfig";

const DAY = 86_400_000;
const date = fc.integer({ min: Date.UTC(2014, 0, 1) / DAY, max: Date.UTC(2026, 0, 1) / DAY }).map((d) => fromUtcMs(d * DAY));
const maybeDate = fc.oneof({ weight: 8, arbitrary: date }, { weight: 1, arbitrary: fc.constantFrom("", "2025-02-30") });
const pair = fc.record({ first: maybeDate, second: maybeDate });

const input: fc.Arbitrary<ReportFormInput> = fc.record({
  area_id: fc.constant("a1"),
  source: fc.constantFrom("sentinel-2" as const, "landsat-8" as const),
  date_from: date,
  date_to: date,
  title: fc.oneof(fc.string({ maxLength: 20 }), fc.string({ minLength: 195, maxLength: 210 })),
  pairs: fc.array(pair, { maxLength: 12 }),
  include_weather: fc.boolean(),
});

const span = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY + 1;

describe("Property 25: Report form validation", () => {
  it("accepts iff the range, title, pair count and pairs are valid, and orders every pair", () => {
    fc.assert(
      fc.property(input, (i) => {
        const result = validateReportForm(i);
        const pairsOk = i.pairs.every((p) => isCalendarDate(p.first) && isCalendarDate(p.second) && p.first !== p.second);
        const expected = i.date_from <= i.date_to && span(i.date_from, i.date_to) <= 1826 && i.title.length <= 200 && i.pairs.length <= 10 && pairsOk;
        expect(result.ok).toBe(expected);
        if (result.ok) {
          const sent = result.body.comparisons ?? [];
          expect(sent).toHaveLength(i.pairs.length);
          sent.forEach((c, k) => {
            const p = i.pairs[k];
            expect(c.date_a < c.date_b).toBe(true);
            expect(new Set([c.date_a, c.date_b])).toEqual(new Set([p?.first, p?.second]));
          });
          if (i.pairs.length === 0) expect("comparisons" in result.body).toBe(false);
        } else {
          expect(Object.keys(result.errors).length).toBeGreaterThan(0);
        }
      }),
      propertyConfig,
    );
  });
});
