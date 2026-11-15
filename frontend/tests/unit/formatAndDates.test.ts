import { describe, expect, it } from "vitest";

import { addDays, inclusiveSpanDays, isCalendarDate, todayUtc } from "@/lib/dates";
import {
  formatCoverage,
  formatDate,
  formatDateTime,
  formatDays,
  formatHectares,
  formatNdvi,
  formatPercentDifference,
  formatSigned,
} from "@/lib/format";

describe("calendar dates", () => {
  it("knows leap years and month lengths", () => {
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2023-02-29")).toBe(false);
    expect(isCalendarDate("1900-02-29")).toBe(false);
    expect(isCalendarDate("2000-02-29")).toBe(true);
    expect(isCalendarDate("2024-04-31")).toBe(false);
    expect(isCalendarDate("2024-4-01")).toBe(false);
    expect(isCalendarDate(20240101)).toBe(false);
  });

  it("does UTC arithmetic across month, year and DST boundaries", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
    expect(addDays("2024-03-31", -366)).toBe("2023-03-31");
    expect(inclusiveSpanDays("2024-03-30", "2024-03-31")).toBe(2);
    expect(inclusiveSpanDays("2024-01-01", "2024-01-01")).toBe(1);
    expect(todayUtc(new Date("2024-06-30T23:59:59Z"))).toBe("2024-06-30");
  });
});

describe("formatting", () => {
  it("always signs differences and keeps the requested decimals", () => {
    expect(formatSigned(0.12345, 4)).toBe("+0.1235");
    expect(formatSigned(-0.1, 4)).toBe("-0.1000");
    expect(formatSigned(0, 4)).toBe("+0.0000");
    expect(formatPercentDifference(12.345)).toBe("+12.35%");
    expect(formatPercentDifference(null)).toBe("Not defined");
  });

  it("labels missing values instead of inventing them", () => {
    expect(formatNdvi(0.61234)).toBe("0.6123");
    expect(formatNdvi(null)).toBe("Not available");
    expect(formatCoverage(12.34)).toBe("12.3%");
    expect(formatCoverage(null)).toBe("Not reported");
    expect(formatCoverage(0)).toBe("0.0%");
  });

  it("formats dates in UTC and quantities with units", () => {
    expect(formatDate("2024-03-12")).toBe("12 Mar 2024");
    expect(formatDate(null)).toBe("Not available");
    expect(formatDateTime("2024-03-12T14:03:00Z")).toBe("12 Mar 2024, 14:03 UTC");
    expect(formatDateTime("not a date")).toBe("not a date");
    expect(formatHectares(1234.56)).toBe("1,234.6 ha");
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(365)).toBe("365 days");
  });
});
