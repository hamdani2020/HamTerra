// Feature: eco-sentinel-frontend, Property 27: Setting value validation
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { SETTING_DESCRIPTIONS, validateSetting } from "@/lib/settings";
import type { SettingItem } from "@/types/api";

import { propertyConfig } from "./propertyConfig";

const bound = fc.option(fc.integer({ min: -50, max: 150 }), { nil: null });
const item: fc.Arbitrary<Pick<SettingItem, "type" | "min" | "max">> = fc
  .record({ type: fc.constantFrom("integer" as const, "decimal" as const), a: bound, b: bound })
  .map(({ type, a, b }) => (a !== null && b !== null && a > b ? { type, min: b, max: a } : { type, min: a, max: b }));
const raw = fc.oneof(
  fc.integer({ min: -100, max: 200 }).map(String),
  fc.double({ min: -100, max: 200, noNaN: true, noDefaultInfinity: true }).map((v) => String(Math.round(v * 100) / 100)),
  fc.constantFrom("", " ", "abc", "1e3", "NaN", "Infinity", "12.", ".5", "--1", "0x10"),
);

/** Reference model from the property statement. */
function accepts(i: Pick<SettingItem, "type" | "min" | "max">, text: string): boolean {
  const t = text.trim();
  if (t === "" || !/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return false;
  const v = Number(t);
  if (i.type === "integer" && !Number.isInteger(v)) return false;
  return (i.min === null || v >= i.min) && (i.max === null || v <= i.max);
}

describe("Property 27: Setting value validation", () => {
  it("accepts a numeric input iff non-empty, a number, an integer for integers, and within bounds", () => {
    fc.assert(
      fc.property(item, raw, (i, text) => {
        const result = validateSetting(i, text);
        expect(result.ok).toBe(accepts(i, text));
        if (result.ok) expect(result.value).toBe(Number(text.trim()));
        else expect(result.error.length).toBeGreaterThan(0);
      }),
      propertyConfig,
    );
  });

  it("accepts booleans for boolean items only as booleans", () => {
    fc.assert(
      fc.property(fc.oneof(fc.boolean(), fc.constantFrom("true", "false", "", "yes", "1")), (value) => {
        const result = validateSetting({ type: "boolean", min: null, max: null }, value);
        expect(result.ok).toBe(typeof value === "boolean" || value === "true" || value === "false");
      }),
      propertyConfig,
    );
  });

  it("describes the six known keys in at most 160 characters", () => {
    expect(Object.keys(SETTING_DESCRIPTIONS).sort()).toEqual(
      ["cloud_limit_pct", "data_coverage_min_pct", "default_page_size", "gap_threshold_days", "ndvi_diff_threshold", "weather_enabled"].sort(),
    );
    for (const text of Object.values(SETTING_DESCRIPTIONS)) expect(text.length).toBeLessThanOrEqual(160);
  });
});
