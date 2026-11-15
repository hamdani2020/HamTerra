// Feature: eco-sentinel-frontend, Property 18: Chart accessible summary
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fromUtcMs } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { SOURCE_LABEL } from "@/lib/messages";
import { chartSummaryText } from "@/lib/timeseries";

import { propertyConfig } from "./propertyConfig";

const DAY = 86_400_000;
const date = fc.integer({ min: Date.UTC(2015, 0, 1) / DAY, max: Date.UTC(2026, 0, 1) / DAY }).map((d) => fromUtcMs(d * DAY));

describe("Property 18: Chart accessible summary", () => {
  it("states the count, the first and last dates in order, and the source", () => {
    fc.assert(
      fc.property(fc.array(date, { minLength: 1, maxLength: 40 }), fc.constantFrom("sentinel-2" as const, "landsat-8" as const), (dates, source) => {
        const text = chartSummaryText(dates.map((d) => ({ date: d })), source);
        const sorted = [...dates].sort();
        const first = formatDate(sorted[0]);
        const last = formatDate(sorted.at(-1));
        expect(text).toContain(`${dates.length} NDVI point`);
        expect(text).toContain(SOURCE_LABEL[source]);
        expect(text).toContain(`from ${first} to ${last}`);
        expect(text.indexOf(first)).toBeLessThanOrEqual(text.lastIndexOf(last));
      }),
      propertyConfig,
    );
  });
});
