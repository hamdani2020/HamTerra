/**
 * Bounding boxes for map fitting and the preview overlay. Pure. Bounds are used only to
 * place the map view and the preview image; nothing is derived about where inside a
 * polygon a change happened (product steering).
 */
import type { AreaFeatureCollection, GeoJsonGeometry } from "@/types/api";

/** `[west, south, east, north]` in degrees. */
export type BBox = [number, number, number, number];

/** Approximate bounding box of Ghana (frontend design, Map). */
export const GHANA_BOUNDS: BBox = [-3.3, 4.7, 1.3, 11.2];

function isPosition(value: unknown): value is [number, number, ...number[]] {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number";
}

/** Every `[lng, lat]` position in nested Polygon or MultiPolygon coordinates. */
function* positions(coordinates: unknown): Generator<[number, number]> {
  if (isPosition(coordinates)) {
    if (Number.isFinite(coordinates[0]) && Number.isFinite(coordinates[1])) yield [coordinates[0], coordinates[1]];
    return;
  }
  if (Array.isArray(coordinates)) {
    for (const item of coordinates) yield* positions(item);
  }
}

/** The smallest box around every position, or null when there are none. */
export function geometryBounds(geometries: Iterable<GeoJsonGeometry | null | undefined>): BBox | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const geometry of geometries) {
    if (!geometry) continue;
    for (const [lng, lat] of positions(geometry.coordinates)) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return west === Infinity ? null : [west, south, east, north];
}

/** Bounds of all features; Ghana when the collection has no positions (Requirement 8.1). */
export function featureCollectionBounds(collection: AreaFeatureCollection): BBox {
  return geometryBounds(collection.features.map((feature) => feature.geometry)) ?? GHANA_BOUNDS;
}

/** Image corners for a MapLibre image source: top-left, top-right, bottom-right, bottom-left. */
export function bboxCorners([west, south, east, north]: BBox): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];
}
