// Feature: eco-sentinel-frontend, Property 22: Refresh source selection
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { buildRefreshRequest } from "@/lib/refresh";
import type { Source } from "@/types/api";

import { propertyConfig } from "./propertyConfig";

const selection = fc.array(fc.constantFrom<Source>("sentinel-2", "landsat-8"), { maxLength: 4 });

describe("Property 22: Refresh source selection", () => {
  it("omits sources iff both are selected, else sends exactly the selected ones", () => {
    fc.assert(
      fc.property(selection, (selected) => {
        const result = buildRefreshRequest({ date_from: "2026-01-01", date_to: "2026-03-01", sources: selected }, "2026-06-01");
        const unique = [...new Set(selected)];
        if (unique.length === 0) {
          expect(result.ok).toBe(false);
          return;
        }
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        if (unique.length === 2) expect("sources" in result.body).toBe(false);
        else expect(result.body.sources).toEqual(unique);
      }),
      propertyConfig,
    );
  });
});
