// Feature: eco-sentinel-frontend, Property 6: Role-based navigation
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ADMIN_ITEMS, navItems, RESEARCHER_ITEMS } from "@/lib/navigation";

import { propertyConfig } from "./propertyConfig";

const role = fc.oneof(
  fc.constantFrom("admin", "researcher", "Admin", "RESEARCHER", "viewer", "", " admin"),
  fc.string({ maxLength: 12 }),
);

const labels = (items: readonly { label: string }[]) => items.map((item) => item.label);

describe("Property 6: Role-based navigation", () => {
  it("researcher items iff a known role, admin items iff admin, empty otherwise", () => {
    fc.assert(
      fc.property(fc.array(role, { maxLength: 6 }), (roles) => {
        const result = labels(navItems(roles));
        const admin = roles.includes("admin");
        const known = admin || roles.includes("researcher");
        for (const item of labels(RESEARCHER_ITEMS)) expect(result.includes(item)).toBe(known);
        for (const item of labels(ADMIN_ITEMS)) expect(result.includes(item)).toBe(admin);
        if (!known) expect(result).toEqual([]);
        expect(result).toHaveLength(known ? (admin ? 10 : 4) : 0);
      }),
      propertyConfig,
    );
  });

  it("names the four researcher items and the six admin items", () => {
    expect(labels(RESEARCHER_ITEMS)).toEqual(["Dashboard", "Map", "Areas", "Reports"]);
    expect(labels(ADMIN_ITEMS)).toEqual([
      "Admin Overview",
      "Users",
      "Areas Management",
      "Retrievals",
      "Settings",
      "Activity",
    ]);
  });
});
