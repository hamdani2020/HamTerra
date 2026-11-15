// Feature: eco-sentinel-frontend, Property 15: Feature collection bounds
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { featureCollectionBounds, GHANA_BOUNDS } from "@/lib/geo";
import type { AreaFeature, AreaFeatureCollection } from "@/types/api";

import { propertyConfig } from "./propertyConfig";

const position = fc.tuple(
  fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
  fc.double({ min: -85, max: 85, noNaN: true, noDefaultInfinity: true }),
);
const ring = fc.array(position, { minLength: 3, maxLength: 8 }).map((points) => [...points, points[0] as [number, number]]);
const polygon = fc.array(ring, { minLength: 1, maxLength: 3 });
const geometry = fc.oneof(
  polygon.map((coordinates) => ({ type: "Polygon" as const, coordinates })),
  fc.array(polygon, { minLength: 1, maxLength: 3 }).map((coordinates) => ({ type: "MultiPolygon" as const, coordinates })),
);
const collection = fc.array(geometry, { minLength: 1, maxLength: 6 }).map(
  (geometries): AreaFeatureCollection => ({
    type: "FeatureCollection",
    features: geometries.map(
      (g, i): AreaFeature => ({
        type: "Feature",
        id: `a${i}`,
        geometry: g,
        properties: { id: `a${i}`, name: `Area ${i}`, area_ha: 1, latest_observation_date: null },
      }),
    ),
  }),
);

function allPositions(fcol: AreaFeatureCollection): [number, number][] {
  return fcol.features.flatMap((f) => (f.geometry.coordinates as unknown[]).flat(f.geometry.type === "Polygon" ? 1 : 2) as [number, number][]);
}

describe("Property 15: Feature collection bounds", () => {
  it("is the smallest box containing every coordinate", () => {
    fc.assert(
      fc.property(collection, (input) => {
        const [west, south, east, north] = featureCollectionBounds(input);
        const points = allPositions(input);
        for (const [lng, lat] of points) {
          expect(lng).toBeGreaterThanOrEqual(west);
          expect(lng).toBeLessThanOrEqual(east);
          expect(lat).toBeGreaterThanOrEqual(south);
          expect(lat).toBeLessThanOrEqual(north);
        }
        // Smallest: every edge touches a coordinate.
        expect(points.some(([lng]) => lng === west)).toBe(true);
        expect(points.some(([lng]) => lng === east)).toBe(true);
        expect(points.some(([, lat]) => lat === south)).toBe(true);
        expect(points.some(([, lat]) => lat === north)).toBe(true);
      }),
      propertyConfig,
    );
  });

  it("is the Ghana bounds for an empty collection", () => {
    expect(featureCollectionBounds({ type: "FeatureCollection", features: [] })).toEqual(GHANA_BOUNDS);
  });
});
