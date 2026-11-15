// Feature: eco-sentinel-frontend, Property 11: Date range validation
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fromUtcMs, inclusiveSpanDays, isCalendarDate } from "@/lib/dates";
import { validateDateRange, validateRefreshRange } from "@/lib/validators";

import { propertyConfig } from "./propertyConfig";

const DAY = 86_400_000;
const MIN = Date.UTC(2000, 0, 1);
const MAX = Date.UTC(2035, 11, 31);
const validDate = fc.integer({ min: MIN / DAY, max: MAX / DAY }).map((d) => fromUtcMs(d * DAY));
const invalidDate = fc.oneof(
  fc.constantFrom("2023-02-29", "2024-13-01", "2024-00-10", "2024-04-31", "24-01-01", "2024/01/01", "2024-1-1", "", " ", "today"),
  fc.string({ maxLength: 12 }).filter((s) => !isCalendarDate(s)),
);
const anyDate = fc.oneof({ weight: 4, arbitrary: validDate }, { weight: 1, arbitrary: invalidDate });

/** Reference model, written independently of the validator. */
function expected(from: string, to: string, max: number, today?: string): boolean {
  if (!isCalendarDate(from) || !isCalendarDate(to)) return false;
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY + 1;
  if (span < 1 || span > max) return false;
  if (today !== undefined && Date.parse(`${to}T00:00:00Z`) > Date.parse(`${today}T00:00:00Z`)) return false;
  return true;
}

describe("Property 11: Date range validation", () => {
  it("accepts iff both are calendar dates, from <= to, the inclusive span fits and to <= today", () => {
    fc.assert(
      fc.property(anyDate, anyDate, fc.integer({ min: 1, max: 4000 }), fc.option(validDate, { nil: undefined }), (from, to, max, today) => {
        const result = validateDateRange(from, to, { maxSpanDays: max, ...(today ? { today } : {}) });
        expect(result.ok).toBe(expected(from, to, max, today));
        if (result.ok) {
          expect(result).toEqual({ ok: true, from, to });
        } else {
          // A rejection always names at least one field with a non-empty message.
          const messages = Object.values(result.errors);
          expect(messages.length).toBeGreaterThan(0);
          for (const m of messages) expect(m.trim()).not.toBe("");
        }
      }),
      propertyConfig,
    );
  });

  it("the span limit is inclusive: exactly max days passes, max + 1 fails", () => {
    fc.assert(
      fc.property(validDate, fc.integer({ min: 1, max: 4000 }), (from, max) => {
        const last = fromUtcMs(Date.parse(`${from}T00:00:00Z`) + (max - 1) * DAY);
        const over = fromUtcMs(Date.parse(`${from}T00:00:00Z`) + max * DAY);
        expect(inclusiveSpanDays(from, last)).toBe(max);
        expect(validateDateRange(from, last, { maxSpanDays: max }).ok).toBe(true);
        expect(validateDateRange(from, over, { maxSpanDays: max }).ok).toBe(false);
      }),
      propertyConfig,
    );
  });

  it("refresh ranges reject a future end date and spans over 366 days", () => {
    fc.assert(
      fc.property(validDate, validDate, validDate, (from, to, today) => {
        expect(validateRefreshRange(from, to, today).ok).toBe(expected(from, to, 366, today));
      }),
      propertyConfig,
    );
  });

  it("an optional range accepts empty values and still checks what is entered", () => {
    fc.assert(
      fc.property(fc.option(anyDate, { nil: undefined }), fc.option(anyDate, { nil: undefined }), (from, to) => {
        const result = validateDateRange(from, to, { required: false });
        const f = from?.trim() ? from : undefined;
        const t = to?.trim() ? to : undefined;
        const ok =
          (f === undefined || isCalendarDate(f)) &&
          (t === undefined || isCalendarDate(t)) &&
          (f === undefined || t === undefined || f <= t);
        expect(result.ok).toBe(ok);
      }),
      propertyConfig,
    );
  });
});
