/**
 * The client-side GeoJSON check (Requirements 14.2 to 14.6). Pure and total. It checks only
 * JSON syntax, the structure, the geometry type and coordinate ranges. Ring closure,
 * self-intersection, area size and containment in Ghana are left to the Backend.
 */
import type { GeoJsonGeometry } from "@/types/api";

export type GeoJsonCheck = "json" | "structure" | "type" | "coordinates";

export type GeoJsonResult = { ok: true; geometry: GeoJsonGeometry } | { ok: false; check: GeoJsonCheck; position?: number };

export const MAX_GEOJSON_FILE_BYTES = 1024 * 1024;
export const GEOJSON_EXTENSIONS = [".geojson", ".json"] as const;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The character position from a `JSON.parse` SyntaxError, when the engine reports one. */
function syntaxPosition(error: unknown, text: string): number | undefined {
  const message = error instanceof Error ? error.message : "";
  const at = /position (\d+)/i.exec(message);
  if (at?.[1]) return Number(at[1]);
  const lineColumn = /line (\d+) column (\d+)/i.exec(message);
  if (lineColumn?.[1] && lineColumn[2]) {
    const lines = text.split("\n");
    const line = Number(lineColumn[1]);
    return lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + Number(lineColumn[2]) - 1;
  }
  if (/unexpected end/i.test(message)) return text.length;
  return undefined;
}

/** A Polygon, MultiPolygon, Feature holding one, or a one-feature FeatureCollection. */
function extractGeometry(value: unknown): Record<string, unknown> | null {
  if (!isObject(value)) return null;
  if (value.type === "FeatureCollection") {
    const features = value.features;
    if (!Array.isArray(features) || features.length !== 1) return null;
    return extractGeometry(features[0]);
  }
  if (value.type === "Feature") return isObject(value.geometry) ? value.geometry : null;
  return typeof value.type === "string" && "coordinates" in value ? value : null;
}

function isPosition(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) return false;
  if (!value.every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  const [lng, lat] = value as number[];
  return lng !== undefined && lat !== undefined && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

/** Polygon: rings of positions. MultiPolygon: polygons of rings. Each array non-empty. */
function validCoordinates(type: "Polygon" | "MultiPolygon", coordinates: unknown): boolean {
  const ring = (r: unknown) => Array.isArray(r) && r.length > 0 && r.every(isPosition);
  const polygon = (p: unknown) => Array.isArray(p) && p.length > 0 && p.every(ring);
  return type === "Polygon" ? polygon(coordinates) : Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(polygon);
}

export function validateGeoJsonInput(text: string): GeoJsonResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const position = syntaxPosition(error, text);
    return position === undefined ? { ok: false, check: "json" } : { ok: false, check: "json", position };
  }
  const geometry = extractGeometry(parsed);
  if (!geometry) return { ok: false, check: "structure" };
  const type = geometry.type;
  if (type !== "Polygon" && type !== "MultiPolygon") return { ok: false, check: "type" };
  if (!validCoordinates(type, geometry.coordinates)) return { ok: false, check: "coordinates" };
  return { ok: true, geometry: { type, coordinates: geometry.coordinates } };
}

export type FileCheck = { ok: true } | { ok: false; reason: "size" | "type" };

/** Checked before the file is read, so a rejected file leaves the text unchanged (14.5). */
export function checkGeoJsonFile(file: { name: string; size: number }): FileCheck {
  const name = file.name.toLowerCase();
  if (!GEOJSON_EXTENSIONS.some((ext) => name.endsWith(ext))) return { ok: false, reason: "type" };
  if (file.size > MAX_GEOJSON_FILE_BYTES) return { ok: false, reason: "size" };
  return { ok: true };
}
