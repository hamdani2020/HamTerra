import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { CONFIG_VARS, DEFAULT_BASEMAP_TILE_URL, loadConfig } from "@/core/config";
import { propertyConfig } from "./propertyConfig";

const VALID_URLS = [
  "http://localhost:8000/api/v1",
  "https://example.auth.eu-west-1.amazoncognito.com",
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  "  https://padded.example.test/path  ",
];
const INVALID_URLS = [
  "not a url",
  "/relative/path",
  "localhost:5173",
  "ftp://example.test/file",
  "javascript:alert(1)",
  "mailto:someone@example.test",
  "http://",
  "https:",
];
const BLANKS = [undefined, "", "   ", "\t\n"];
const TEXT_VALUES = ["exampleclientid", "eu-west-1", "  spaced value "];

type Choice = { kind: "blank"; value: string | undefined } | { kind: "valid" | "invalid"; value: string };

function choiceFor(isUrl: boolean): fc.Arbitrary<Choice> {
  const blank = fc.constantFrom(...BLANKS).map((value): Choice => ({ kind: "blank", value }));
  if (!isUrl) {
    return fc.oneof(
      blank,
      fc.constantFrom(...TEXT_VALUES).map((value): Choice => ({ kind: "valid", value })),
    );
  }
  return fc.oneof(
    blank,
    fc.constantFrom(...VALID_URLS).map((value): Choice => ({ kind: "valid", value })),
    fc.constantFrom(...INVALID_URLS).map((value): Choice => ({ kind: "invalid", value })),
  );
}

const envArbitrary = fc.tuple(...CONFIG_VARS.map((spec) => choiceFor(spec.url)));

describe("loadConfig", () => {
  // Feature: eco-sentinel-frontend, Property 1: For any map of environment values, loadConfig returns ok if and only if every required variable is present, non-empty after trimming, and every URL variable parses as an absolute URL. Otherwise it returns the exact set of missing names and the exact set of invalid names, with no variable value in the result.
  it("Property 1: public configuration validation", () => {
    fc.assert(
      fc.property(envArbitrary, fc.dictionary(fc.string(), fc.string(), { maxKeys: 3 }), (choices, noise) => {
        const env: Record<string, unknown> = { ...noise };
        const expectedMissing: string[] = [];
        const expectedInvalid: string[] = [];
        CONFIG_VARS.forEach((spec, index) => {
          const choice = choices[index];
          if (choice === undefined) return;
          env[spec.name] = choice.value;
          if (choice.kind === "blank" && spec.required) expectedMissing.push(spec.name);
          if (choice.kind === "invalid") expectedInvalid.push(spec.name);
        });

        const result = loadConfig(env);
        const shouldBeOk = expectedMissing.length === 0 && expectedInvalid.length === 0;
        expect(result.ok).toBe(shouldBeOk);

        if (result.ok) {
          CONFIG_VARS.forEach((spec, index) => {
            const choice = choices[index];
            const expected =
              choice?.kind === "valid" ? choice.value.trim() : DEFAULT_BASEMAP_TILE_URL;
            expect(result.config[spec.key]).toBe(expected);
          });
          // Only the known variables are read; unrelated keys are ignored.
          expect(Object.keys(result.config).sort()).toEqual(
            CONFIG_VARS.map((s) => s.key).sort(),
          );
        } else {
          expect(result.missing).toEqual(expectedMissing);
          expect(result.invalid).toEqual(expectedInvalid);
          const serialised = JSON.stringify(result);
          for (const choice of choices) {
            const value = choice.value?.trim();
            if (value) expect(serialised).not.toContain(value);
          }
        }
      }),
      propertyConfig,
    );
  });
});
