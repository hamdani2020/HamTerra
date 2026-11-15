import { cleanup, render } from "@testing-library/react";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { VerbatimText } from "@/components/common/VerbatimText";
import { propertyConfig } from "./propertyConfig";

const backendText = fc.oneof(
  fc.string({ maxLength: 50 }),
  fc.string({ minLength: 500, maxLength: 3000 }),
  fc.constantFrom(
    "<b>bold</b> & <script>alert(1)</script>",
    "   ",
    "\t \n ",
    "&amp; &lt;tag&gt;",
    "x".repeat(4000),
    "NDVI values are polygon-level aggregates; seasonality is not removed.",
  ),
  fc.stringMatching(/^[<>&"' a-z]{0,40}$/),
);

describe("VerbatimText", () => {
  // Feature: eco-sentinel-frontend, Property 29: For any string, including long strings, strings with markup characters and strings with only whitespace, VerbatimText renders a text node whose content equals the input, with no truncation and no HTML interpretation.
  it("Property 29: Backend text is rendered verbatim", () => {
    fc.assert(
      fc.property(backendText, (text) => {
        const { container } = render(<VerbatimText text={text} />);
        const element = container.firstElementChild;
        expect(element).not.toBeNull();
        expect(element?.textContent).toBe(text);
        // No HTML interpretation: the only children are text nodes.
        expect(element?.children.length).toBe(0);
        expect(element?.className).not.toMatch(/truncate|line-clamp|text-ellipsis/);
        cleanup();
      }),
      propertyConfig,
    );
  });
});
