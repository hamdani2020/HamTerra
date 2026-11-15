import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { containsForbiddenTerm, FORBIDDEN_TERMS } from "@/lib/evidence";
import { authoredTextCatalogue } from "@/lib/messages";
import { propertyConfig } from "./propertyConfig";

/** Random letter case, so "Illegal" and "dEfOrEsTaTiOn" are generated too. */
function anyCase(term: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: term.length, maxLength: term.length })
    .map((upper) => [...term].map((ch, i) => (upper[i] ? ch.toUpperCase() : ch)).join(""));
}

// Text without the letters needed to spell any term, so it can never contain one.
const safeText = fc.stringMatching(/^[bfhjkpqwxyz0-9 .,;:!?-]{0,40}$/);

describe("forbidden terms", () => {
  // Feature: eco-sentinel-frontend, Property 28: For any string, containsForbiddenTerm returns a match if and only if the string contains one of the forbidden terms in any letter case. For any string in the message module and in the Frontend-authored text catalogue, containsForbiddenTerm returns no match.
  it("Property 28: forbidden terms are detected and absent from authored text", () => {
    const withTerm = fc
      .tuple(safeText, fc.constantFrom(...FORBIDDEN_TERMS).chain(anyCase), safeText)
      .map(([a, term, b]) => ({ text: `${a}${term}${b}`, expected: true }));
    const without = safeText.map((text) => ({ text, expected: false }));
    const anything = fc.string({ maxLength: 60 }).map((text) => ({
      text,
      expected: FORBIDDEN_TERMS.some((t) => text.toLowerCase().includes(t)),
    }));
    const catalogue = authoredTextCatalogue();

    fc.assert(
      fc.property(fc.oneof(withTerm, without, anything), fc.constantFrom(...catalogue), (sample, authored) => {
        expect(containsForbiddenTerm(sample.text) !== null).toBe(sample.expected);
        expect(containsForbiddenTerm(authored)).toBeNull();
      }),
      propertyConfig,
    );
  });

  it("reports the longer phrase before its prefix", () => {
    expect(containsForbiddenTerm(`No ${FORBIDDEN_TERMS[0].toUpperCase()} here`)).toBe(FORBIDDEN_TERMS[0]);
  });

  it("finds no forbidden term anywhere in the authored source outside evidence.ts", () => {
    const root = join(__dirname, "..", "..");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : /\.(tsx?|css|html)$/.test(name) ? [path] : [];
      });
    const offenders = [...walk(join(root, "src")), join(root, "index.html")]
      .map((path) => relative(root, path).split(sep).join("/"))
      .filter((path) => path !== "src/lib/evidence.ts")
      .filter((path) => containsForbiddenTerm(readFileSync(join(root, path), "utf8")) !== null);
    expect(offenders, `forbidden term in: ${offenders.join(", ")}`).toEqual([]);
  });
});
