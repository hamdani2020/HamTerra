import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ApiError, ApiTimeoutError, DisallowedHostError, NetworkError, parseError } from "@/core/api/errors";
import { describeError } from "@/lib/messages";
import { propertyConfig } from "./propertyConfig";

// Details values carry a marker that no message, code or request id contains.
const detailValue = fc.stringMatching(/^[a-z ]{1,20}$/).map((s) => `DETAIL_${s}`);
const details = fc.oneof(
  fc.constant(null),
  fc.dictionary(fc.stringMatching(/^[a-z]{1,8}$/), detailValue, { maxKeys: 4 }),
  fc.record({
    fields: fc.array(fc.record({ field: detailValue, reason: detailValue }), { maxLength: 3 }),
    upstream: detailValue,
  }),
);
const message = fc.stringMatching(/^[A-Za-z ,.]{0,40}$/);
const code = fc.oneof(
  fc.constantFrom("VALIDATION_ERROR", "NOT_FOUND", "UPSTREAM_ERROR", "INTERNAL_ERROR", "AREA_OUT_OF_RANGE"),
  fc.stringMatching(/^[A-Z_]{1,20}$/),
);
const requestId = fc.oneof(fc.constant(null), fc.stringMatching(/^req-[a-z0-9]{1,12}$/));

const envelopeBody = fc.record({
  error: fc.record({ code, message, details, request_id: requestId }),
});
const otherBody = fc.oneof(
  fc.constant(null),
  fc.constant(""),
  fc.string({ maxLength: 40 }),
  fc.record({ detail: detailValue }),
  fc.array(fc.integer(), { maxLength: 3 }),
  fc.record({ error: fc.record({ code: fc.integer() }) }),
);
const status = fc.integer({ min: 400, max: 599 });

const thrown = fc.oneof(
  fc.tuple(status, fc.oneof(envelopeBody, otherBody)).map(([s, b]) => ({ value: parseError(s, b) as unknown, body: b })),
  fc.constantFrom<unknown>(
    new NetworkError(),
    new ApiTimeoutError(30_000),
    new DisallowedHostError("x"),
    new DOMException("aborted", "AbortError"),
    "a string",
    42,
    null,
    undefined,
    { message: "plain object" },
    new Error("boom"),
  ).map((value) => ({ value, body: null as unknown })),
);

function detailStrings(body: unknown): string[] {
  const d = (body as { error?: { details?: unknown } } | null)?.error?.details;
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(d);
  return out;
}

describe("describeError", () => {
  // Feature: eco-sentinel-frontend, Property 8: For any HTTP status and any response body (valid Error_Envelope, other JSON, non-JSON text, empty) and for any thrown value, describeError returns a DisplayError with a non-empty title and body, never throws, includes the request_id when the body is a valid envelope, and the rendered text never contains any string taken from error.details.
  it("Property 8: error description is total and hides details", () => {
    fc.assert(
      fc.property(thrown, ({ value, body }) => {
        const display = describeError(value);
        expect(display.title.trim()).not.toBe("");
        expect(display.body.trim()).not.toBe("");
        if (value instanceof ApiError && value.enveloped && value.requestId) {
          expect(display.requestId).toBe(value.requestId);
        }
        const rendered = `${display.title} ${display.body} ${display.requestId ?? ""}`;
        for (const s of detailStrings(body)) expect(rendered).not.toContain(s);
        expect(rendered).not.toContain("DETAIL_");
      }),
      propertyConfig,
    );
  });
});
