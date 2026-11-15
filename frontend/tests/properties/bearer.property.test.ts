import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Endpoints } from "@/core/api/endpoints";

import { fakeAuth, makeApi } from "../api/apiHarness";
import { ENDPOINT_CALLS, HEALTH_ENDPOINTS } from "../api/endpointCalls";
import { server } from "../msw/server";
import { propertyConfig } from "./propertyConfig";

const names = Object.keys(ENDPOINT_CALLS) as (keyof Endpoints)[];
const token = fc.stringMatching(/^[A-Za-z0-9._~+/-]{1,80}$/);

describe("bearer attachment", () => {
  it("has a sample call for every endpoint function", () => {
    const { api } = makeApi();
    expect(names.sort()).toEqual(Object.keys(api).sort());
  });

  // Feature: eco-sentinel-frontend, Property 7: For any endpoint function other than the health endpoints and any access token string, the outgoing request carries the header Authorization: Bearer <token> with that exact token, and requests to health endpoints carry no Authorization header.
  it("Property 7: bearer attachment", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...names), token, async (name, value) => {
        const seen: (string | null)[] = [];
        const listener = ({ request }: { request: Request }): void => {
          seen.push(request.headers.get("Authorization"));
        };
        server.events.on("request:start", listener);
        try {
          const { api } = makeApi(fakeAuth(value));
          await ENDPOINT_CALLS[name](api);
        } finally {
          server.events.removeListener("request:start", listener);
        }
        expect(seen).toHaveLength(1);
        expect(seen[0]).toBe(HEALTH_ENDPOINTS.has(name) ? null : `Bearer ${value}`);
      }),
      propertyConfig,
    );
  });
});
