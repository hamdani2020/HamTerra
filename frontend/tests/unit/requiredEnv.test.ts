import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { assertRequiredEnv, missingRequiredEnv, REQUIRED_VITE_VARS } from "../../config/requiredEnv";
import { propertyConfig } from "../properties/propertyConfig";

const complete = Object.fromEntries(REQUIRED_VITE_VARS.map((n) => [n, `value-of-${n}`]));

describe("assertRequiredEnv (Requirement 22.6)", () => {
  it("accepts a complete environment", () => {
    expect(() => assertRequiredEnv(complete)).not.toThrow();
  });

  it("names every missing or blank variable and no value", () => {
    fc.assert(
      fc.property(
        fc.subarray([...REQUIRED_VITE_VARS], { minLength: 1 }),
        fc.constantFrom(undefined, "", "   ", "\t"),
        (removed, blank) => {
          const env: Record<string, string | undefined> = { ...complete };
          for (const name of removed) env[name] = blank;
          expect(missingRequiredEnv(env)).toEqual(
            REQUIRED_VITE_VARS.filter((n) => removed.includes(n)),
          );
          let message = "";
          try {
            assertRequiredEnv(env);
          } catch (error) {
            message = (error as Error).message;
          }
          for (const name of removed) expect(message).toContain(name);
          for (const value of Object.values(complete)) expect(message).not.toContain(value);
        },
      ),
      propertyConfig,
    );
  });

  it("does not require the optional basemap URL", () => {
    expect(REQUIRED_VITE_VARS).not.toContain("VITE_BASEMAP_TILE_URL");
  });
});
