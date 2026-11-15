/**
 * Bounding-box input for the area list (Requirements 12.4, 12.5). Pure. The query value is
 * `minLon,minLat,maxLon,maxLat`, the format the Backend parses.
 */
import type { BBox } from "@/lib/geo";
import { AREA_TEXT } from "@/lib/messages";

export interface BboxInputs {
  minLon: string;
  minLat: string;
  maxLon: string;
  maxLat: string;
}

export const EMPTY_BBOX: BboxInputs = { minLon: "", minLat: "", maxLon: "", maxLat: "" };

export type BboxErrors = Partial<Record<keyof BboxInputs, string>>;

export type BboxResult = { ok: true; box: BBox } | { ok: false; errors: BboxErrors };

const NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;

function parseNumber(text: string): number | null {
  const t = text.trim();
  if (!NUMBER.test(t)) return null;
  const value = Number(t);
  return Number.isFinite(value) ? value : null;
}

/**
 * Four finite numbers, longitudes in -180..180, latitudes in -90..90, each minimum strictly
 * less than its maximum. Errors name the offending field.
 */
export function validateBbox(inputs: BboxInputs): BboxResult {
  const errors: BboxErrors = {};
  const read = (key: keyof BboxInputs, limit: number, rangeText: string): number | null => {
    const value = parseNumber(inputs[key]);
    if (value === null) {
      errors[key] = AREA_TEXT.notNumber;
      return null;
    }
    if (value < -limit || value > limit) {
      errors[key] = rangeText;
      return null;
    }
    return value;
  };
  const minLon = read("minLon", 180, AREA_TEXT.lonRange);
  const minLat = read("minLat", 90, AREA_TEXT.latRange);
  const maxLon = read("maxLon", 180, AREA_TEXT.lonRange);
  const maxLat = read("maxLat", 90, AREA_TEXT.latRange);
  if (minLon !== null && maxLon !== null && !(minLon < maxLon)) errors.minLon = AREA_TEXT.minLonOrder;
  if (minLat !== null && maxLat !== null && !(minLat < maxLat)) errors.minLat = AREA_TEXT.minLatOrder;
  if (Object.keys(errors).length > 0 || minLon === null || minLat === null || maxLon === null || maxLat === null) {
    return { ok: false, errors };
  }
  return { ok: true, box: [minLon, minLat, maxLon, maxLat] };
}

/** The query value. `String(n)` round-trips every finite double exactly. */
export function formatBbox(box: BBox): string {
  return box.map((n) => String(n)).join(",");
}

/** A query value back into a box, or null when it is not a valid box. */
export function parseBbox(text: string | null | undefined): BBox | null {
  if (!text) return null;
  const parts = text.split(",");
  if (parts.length !== 4) return null;
  const [minLon = "", minLat = "", maxLon = "", maxLat = ""] = parts;
  const result = validateBbox({ minLon, minLat, maxLon, maxLat });
  return result.ok ? result.box : null;
}

export function bboxInputs(box: BBox | null): BboxInputs {
  if (!box) return EMPTY_BBOX;
  const [minLon, minLat, maxLon, maxLat] = box.map((n) => String(n)) as [string, string, string, string];
  return { minLon, minLat, maxLon, maxLat };
}
