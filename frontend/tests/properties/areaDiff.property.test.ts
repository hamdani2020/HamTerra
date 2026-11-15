// Feature: eco-sentinel-frontend, Property 24: Area form diff
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { diffAreaForm, type AreaValues } from "@/lib/areaForm";
import type { GeoJsonGeometry } from "@/types/api";

import { propertyConfig } from "./propertyConfig";

const geometries: GeoJsonGeometry[] = [
  { type: "Polygon", coordinates: [[[-2.2, 5.3], [-2.1, 5.3], [-2.1, 5.4], [-2.2, 5.3]]] },
  { type: "Polygon", coordinates: [[[-2.3, 5.3], [-2.1, 5.3], [-2.1, 5.4], [-2.3, 5.3]]] },
  { type: "MultiPolygon", coordinates: [[[[-1, 6], [-0.9, 6], [-0.9, 6.1], [-1, 6]]]] },
];
const name = fc.constantFrom("Prestea", "Tarkwa", "Obuasi");
const description = fc.constantFrom<string | null>(null, "Pilot area.", "Second phase.");
const values: fc.Arbitrary<AreaValues> = fc.record({ name, description, geometry: fc.constantFrom(...geometries) });

/** A deep copy with keys in a different order: the same geometry. */
const reordered = (g: GeoJsonGeometry | null) => (g ? (JSON.parse(JSON.stringify({ coordinates: g.coordinates, type: g.type })) as GeoJsonGeometry) : g);

describe("Property 24: Area form diff", () => {
  it("returns exactly the changed fields, and nothing iff nothing changed", () => {
    fc.assert(
      fc.property(values, values, (original, edited) => {
        const current = { ...edited, geometry: reordered(edited.geometry) };
        const diff = diffAreaForm(original, current);
        const changed = {
          name: original.name !== edited.name,
          description: original.description !== edited.description,
          geometry: JSON.stringify(original.geometry) !== JSON.stringify(edited.geometry),
        };
        expect("name" in diff).toBe(changed.name);
        expect("description" in diff).toBe(changed.description);
        expect("geometry" in diff).toBe(changed.geometry);
        expect(Object.keys(diff).length === 0).toBe(!changed.name && !changed.description && !changed.geometry);
      }),
      propertyConfig,
    );
  });

  it("treats an emptied description and surrounding name spaces as no change", () => {
    const original: AreaValues = { name: "Prestea", description: null, geometry: geometries[0] ?? null };
    expect(diffAreaForm(original, { ...original, name: " Prestea ", description: "  " })).toEqual({});
    expect(diffAreaForm({ ...original, description: "x" }, { ...original, description: "" })).toEqual({ description: null });
  });
});
