// Feature: eco-sentinel-frontend, Property 23: GeoJSON client check
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { checkGeoJsonFile, MAX_GEOJSON_FILE_BYTES, validateGeoJsonInput } from "@/lib/geojson";

import { propertyConfig } from "./propertyConfig";

const lng = fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true });
const lat = fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true });
const position = fc.tuple(lng, lat);
// Rings need not be closed or simple, and may lie anywhere on Earth: the Backend checks those.
const ring = fc.array(position, { minLength: 1, maxLength: 6 });
const polygon = fc.array(ring, { minLength: 1, maxLength: 3 });
const validGeometry = fc.oneof(
  polygon.map((coordinates) => ({ type: "Polygon", coordinates })),
  fc.array(polygon, { minLength: 1, maxLength: 3 }).map((coordinates) => ({ type: "MultiPolygon", coordinates })),
);
const wrap = (g: object) =>
  fc.constantFrom<object>(g, { type: "Feature", properties: {}, geometry: g }, { type: "FeatureCollection", features: [{ type: "Feature", properties: null, geometry: g }] });
const valid = validGeometry.chain(wrap).map((v) => JSON.stringify(v));

const badPosition = fc.oneof(
  fc.tuple(fc.double({ min: 180.0001, max: 1000, noNaN: true }), lat),
  fc.tuple(lng, fc.double({ min: -1000, max: -90.0001, noNaN: true })),
  fc.constant(["1", 2] as unknown[]),
  fc.constant([1] as unknown[]),
);
const invalid = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.constant("{"),
  fc.constant('{"type": "Polygon", "coordinates": [[[1, 2]]],}'),
  position.map((p) => JSON.stringify({ type: "Point", coordinates: p })),
  fc.array(position, { minLength: 2, maxLength: 4 }).map((c) => JSON.stringify({ type: "LineString", coordinates: c })),
  validGeometry.map((g) => JSON.stringify({ type: "FeatureCollection", features: [] }) + (g ? "" : "")),
  validGeometry.map((g) => JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", geometry: g }, { type: "Feature", geometry: g }] })),
  badPosition.map((p) => JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], p, [1, 1]]] })),
  fc.constant(JSON.stringify({ type: "Polygon", coordinates: [] })),
  fc.constant(JSON.stringify({ type: "Feature", geometry: null })),
);

describe("Property 23: GeoJSON client check", () => {
  it("accepts every valid Polygon or MultiPolygon in any of the three wrappers", () => {
    fc.assert(
      fc.property(valid, (text) => {
        const result = validateGeoJsonInput(text);
        expect(result.ok).toBe(true);
        if (result.ok) expect(["Polygon", "MultiPolygon"]).toContain(result.geometry.type);
      }),
      propertyConfig,
    );
  });

  it("rejects every other input with the failed check named, and never throws", () => {
    fc.assert(
      fc.property(invalid, (text) => {
        const result = validateGeoJsonInput(text);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(["json", "structure", "type", "coordinates"]).toContain(result.check);
      }),
      propertyConfig,
    );
  });

  it("never throws for arbitrary text", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json()), (text) => {
        expect(() => validateGeoJsonInput(text)).not.toThrow();
      }),
      propertyConfig,
    );
  });

  it("reports the parse error position when available", () => {
    const result = validateGeoJsonInput('{"type": "Polygon",, }');
    expect(result).toMatchObject({ ok: false, check: "json" });
    if (!result.ok) expect(typeof result.position).toBe("number");
  });

  it("checks file size and extension before reading", () => {
    expect(checkGeoJsonFile({ name: "a.geojson", size: MAX_GEOJSON_FILE_BYTES })).toEqual({ ok: true });
    expect(checkGeoJsonFile({ name: "A.JSON", size: 10 })).toEqual({ ok: true });
    expect(checkGeoJsonFile({ name: "a.geojson", size: MAX_GEOJSON_FILE_BYTES + 1 })).toEqual({ ok: false, reason: "size" });
    expect(checkGeoJsonFile({ name: "a.kml", size: 10 })).toEqual({ ok: false, reason: "type" });
  });
});
