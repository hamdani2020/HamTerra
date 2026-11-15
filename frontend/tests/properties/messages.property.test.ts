import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ERROR_TEXT, errorText, WARNING_TEXT, warningText } from "@/lib/messages";
import { propertyConfig } from "./propertyConfig";

const knownWarnings = Object.keys(WARNING_TEXT);
const knownErrors = Object.keys(ERROR_TEXT);
const code = fc.oneof(
  fc.constantFrom(...knownWarnings, ...knownErrors),
  fc.stringMatching(/^[A-Z][A-Z_]{0,30}$/),
  fc.constantFrom("toString", "constructor", "__proto__", "hasOwnProperty", ""),
);
const message = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constantFrom("", "   ", "\n"),
  fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim() !== ""),
);

describe("code to text mapping", () => {
  // Feature: eco-sentinel-frontend, Property 9: For any warning or error code string, warningText and errorText return the authored text when the code is known, the Backend message unchanged when the code is unknown and the message is non-empty, and a generic notice that contains the code when the code is unknown and the message is absent or empty.
  it("Property 9: code to text mapping", () => {
    fc.assert(
      fc.property(code, message, (c, m) => {
        const hasMessage = typeof m === "string" && m.trim() !== "";

        const w = warningText({ code: c, message: m });
        if (Object.hasOwn(WARNING_TEXT, c)) {
          expect(w).toBe(WARNING_TEXT[c as keyof typeof WARNING_TEXT]);
        } else if (hasMessage) {
          expect(w).toBe(m);
        } else {
          expect(w).toBe(`Unrecognised notice (${c})`);
        }

        const e = errorText({ code: c, message: m });
        if (c === "AREA_OUT_OF_RANGE" && hasMessage) {
          // The Backend message states the configured limit (Requirement 14.8).
          expect(e).toBe(m);
        } else if (Object.hasOwn(ERROR_TEXT, c)) {
          expect(e).toBe(ERROR_TEXT[c as keyof typeof ERROR_TEXT]);
        } else if (hasMessage) {
          expect(e).toBe(m);
        } else {
          expect(e).toBe(`Unrecognised error (${c})`);
        }
      }),
      propertyConfig,
    );
  });

  it("covers every warning and error code in the requirements glossary", () => {
    expect(knownWarnings).toEqual(
      expect.arrayContaining([
        "INSUFFICIENT_OBSERVATIONS",
        "IRREGULAR_SAMPLING",
        "WEATHER_UNAVAILABLE",
        "WEATHER_DISABLED",
        "LOW_QUALITY_OBSERVATION",
        "SEASONALITY_NOT_CONTROLLED",
        "DATA_COVERAGE_UNKNOWN",
        "ITEMS_DISCARDED",
        "INVALID_CLOUD_COVERAGE",
        "WEATHER_INVALID_DATA",
        "PERCENT_DIFFERENCE_UNDEFINED",
      ]),
    );
    expect(knownErrors).toEqual(
      expect.arrayContaining([
        "UNAUTHENTICATED", "FORBIDDEN", "VALIDATION_ERROR", "NOT_FOUND", "CONFLICT",
        "GEOMETRY_OUTSIDE_GHANA", "AREA_OUT_OF_RANGE", "CROSS_SENSOR_COMPARISON",
        "NO_OBSERVATIONS", "REFRESH_IN_PROGRESS", "LAST_ADMIN", "SELF_ROLE_CHANGE",
        "COGNITO_ADMIN_NOT_ENABLED", "UPSTREAM_ERROR", "UPSTREAM_TIMEOUT", "NOT_IMPLEMENTED",
        "PAYLOAD_TOO_LARGE", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR",
      ]),
    );
  });

  it("uses the texts the requirements quote", () => {
    expect(warningText({ code: "IRREGULAR_SAMPLING" })).toBe(
      "Observations are unevenly spaced; gaps exceed the threshold.",
    );
    expect(errorText({ code: "GEOMETRY_OUTSIDE_GHANA", message: "Backend wording" })).toBe(
      "The polygon is not entirely within Ghana.",
    );
    expect(errorText({ code: "AREA_OUT_OF_RANGE", message: "The area must be 1 to 3000 ha." })).toBe(
      "The area must be 1 to 3000 ha.",
    );
  });
});
