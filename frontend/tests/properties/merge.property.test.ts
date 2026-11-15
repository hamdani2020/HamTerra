// Feature: eco-sentinel-frontend, Property 13: Recent observations merge
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fromUtcMs } from "@/lib/dates";
import { mergeRecentObservations, type AreaObservations } from "@/lib/merge";

import { buildObservation } from "../msw/contract";
import { propertyConfig } from "./propertyConfig";

const DAY = 86_400_000;
const date = fc.integer({ min: Date.UTC(2020, 0, 1) / DAY, max: Date.UTC(2020, 2, 1) / DAY }).map((d) => fromUtcMs(d * DAY));

let next = 0;
const lists = fc.array(
  fc.record({
    name: fc.stringMatching(/^[A-Z][a-z]{0,6}$/),
    dates: fc.array(fc.tuple(date, fc.constantFrom("sentinel-2", "landsat-8" as const)), { maxLength: 5 }),
  }),
  { maxLength: 8 },
).map((areas): AreaObservations[] =>
  areas.map((area, i) => ({
    areaId: `area-${i}`,
    areaName: area.name,
    observations: area.dates.map(([d, source]) => {
      next += 1;
      return buildObservation({ id: `obs-${next}`, area_id: `area-${i}`, date: d, source });
    }),
  })),
);

describe("Property 13: Recent observations merge", () => {
  it("at most 10 rows, all from the input, date descending, containing the newest", () => {
    fc.assert(
      fc.property(lists, (input) => {
        const rows = mergeRecentObservations(input);
        const all = input.flatMap((list) => list.observations.map((o) => ({ list, o })));
        expect(rows.length).toBe(Math.min(10, all.length));

        for (const row of rows) {
          const source = input.find((list) => list.areaId === row.areaId);
          expect(source?.observations).toContain(row.observation);
          expect(row.areaName).toBe(source?.areaName);
        }
        for (let i = 1; i < rows.length; i += 1) {
          expect((rows[i - 1]?.observation.date ?? "") >= (rows[i]?.observation.date ?? "")).toBe(true);
        }
        // Every observation strictly newer than the oldest shown date must be shown.
        const oldestShown = rows.at(-1)?.observation.date;
        if (oldestShown !== undefined && rows.length === 10) {
          for (const { o } of all) {
            if (o.date > oldestShown) expect(rows.map((r) => r.observation)).toContain(o);
          }
        }
        if (all.length <= 10) expect(rows.map((r) => r.observation.id).sort()).toEqual(all.map(({ o }) => o.id).sort());
      }),
      propertyConfig,
    );
  });
});
