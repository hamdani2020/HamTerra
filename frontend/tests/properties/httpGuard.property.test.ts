import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "@/core/api/client";
import { DisallowedHostError } from "@/core/api/errors";
import { createHttpGuard } from "@/core/api/httpGuard";

import { fakeAuth } from "../api/apiHarness";
import { buildPublicConfig } from "../factories";
import { propertyConfig } from "./propertyConfig";

const config = buildPublicConfig();
const guard = createHttpGuard(config);
const ALLOWED_ORIGINS = [
  new URL(config.apiBaseUrl).origin,
  new URL(config.cognitoDomain).origin,
  "https://tile.openstreetmap.org",
];

const safeSegment = fc.stringMatching(/^[a-zA-Z0-9_-]{1,12}$/);
const badSegment = fc.constantFrom("..", ".", "%2e%2e", "%2E%2E", "%2f", "a%5cb", "%zz");
const host = fc.oneof(
  fc.constantFrom(...ALLOWED_ORIGINS),
  fc.constantFrom(
    "https://evil.example",
    "https://localhost.evil.example",
    "http://localhost:8001",
    "https://tile.openstreetmap.org.evil.example",
    "http://example.auth.eu-west-1.amazoncognito.com",
    "https://api.agromonitoring.com",
  ),
);

type Candidate = { path: string; safe: boolean };

const pathCandidate: fc.Arbitrary<Candidate> = fc.oneof(
  fc.array(safeSegment, { minLength: 1, maxLength: 4 }).map((s) => ({ path: `/${s.join("/")}`, safe: true })),
  fc
    .tuple(fc.array(safeSegment, { maxLength: 2 }), badSegment, fc.array(safeSegment, { maxLength: 2 }))
    .map(([a, bad, b]) => ({ path: `/${[...a, bad, ...b].join("/")}`, safe: false })),
  fc.constantFrom(
    { path: "//evil.example/areas", safe: false },
    { path: "/https://evil.example", safe: false },
    { path: "/javascript:alert(1)", safe: false },
    { path: "areas", safe: false },
    { path: "/\\evil.example", safe: false },
    { path: "", safe: false },
  ),
);

describe("request host allow-list", () => {
  // Feature: eco-sentinel-frontend, Property 2: For any request path or URL string, HttpGuard permits the request if and only if the resolved host equals the API host, the Cognito domain host or the configured basemap host, and the path contains no scheme, no // prefix and no .. segment. A refused request makes no fetch call.
  it("Property 2: request host allow-list", async () => {
    await fc.assert(
      fc.asyncProperty(pathCandidate, host, async (candidate, origin) => {
        // API paths: permitted exactly when the path is safe.
        let permitted = true;
        try {
          const url = guard.apiUrl(candidate.path);
          expect(url.origin).toBe(ALLOWED_ORIGINS[0]);
          expect(url.pathname.startsWith("/api/v1/")).toBe(true);
        } catch (error) {
          expect(error).toBeInstanceOf(DisallowedHostError);
          permitted = false;
        }
        expect(permitted).toBe(candidate.safe);

        // Absolute URLs: permitted exactly when the origin is on the list.
        let allowed = true;
        try {
          guard.check(`${origin}/x`);
        } catch (error) {
          expect(error).toBeInstanceOf(DisallowedHostError);
          allowed = false;
        }
        expect(allowed).toBe(ALLOWED_ORIGINS.includes(origin));

        // A refused request never reaches fetch.
        if (!candidate.safe) {
          const fetchSpy = vi.fn(async () => new Response("{}"));
          const client = createApiClient(guard, fakeAuth(), fetchSpy);
          await expect(client.request(candidate.path)).rejects.toBeInstanceOf(DisallowedHostError);
          expect(fetchSpy).not.toHaveBeenCalled();
        }
      }),
      propertyConfig,
    );
  });

  it("rejects user information in an allowed host", () => {
    expect(() => guard.check("http://user:pass@localhost:8000/api/v1/me")).toThrow(DisallowedHostError);
  });
});
