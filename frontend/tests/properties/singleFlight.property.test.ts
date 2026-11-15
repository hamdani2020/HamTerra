// Feature: eco-sentinel-frontend, Property 5: Single-flight renewal
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHttpGuard } from "@/core/api/httpGuard";
import { createAuthModule, RENEW_BEFORE_MS } from "@/core/auth/authModule";
import { STORAGE_KEYS, type AuthStorage } from "@/core/auth/storage";

import { buildPublicConfig } from "../factories";
import { buildTokenResponse } from "../msw/cognito";
import { propertyConfig } from "./propertyConfig";

const config = buildPublicConfig();

function memoryStorage(): AuthStorage {
  const data = new Map<string, string>();
  return {
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
    clearAll: () => data.clear(),
  };
}

function form(init: RequestInit | undefined): URLSearchParams {
  return new URLSearchParams(String(init?.body ?? ""));
}

describe("Property 5: Single-flight renewal", () => {
  // Timers are faked so the proactive renewal timer cannot add a request of its own.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("N concurrent callers share one refresh request and one outcome", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 25 }),
        fc.boolean(),
        // Remaining lifetime of the current token, always under the 60 s renewal window.
        fc.integer({ min: 1, max: Math.floor(RENEW_BEFORE_MS / 1000) }),
        async (n, succeeds, lifetimeS) => {
          const storage = memoryStorage();
          storage.set(STORAGE_KEYS.state, "s".repeat(43));
          storage.set(STORAGE_KEYS.verifier, "v".repeat(64));
          let release!: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
            if (form(init).get("grant_type") === "authorization_code") {
              return Response.json(buildTokenResponse({ access_token: "first", expires_in: lifetimeS }));
            }
            await gate;
            return succeeds
              ? Response.json(buildTokenResponse({ access_token: "renewed", refresh_token: undefined }))
              : new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
          });
          const auth = createAuthModule(config, { guard: createHttpGuard(config), storage, fetch });
          const signedIn = await auth.handleCallback(`?code=c&state=${"s".repeat(43)}`);
          expect(signedIn.ok).toBe(true);

          const calls = Array.from({ length: n }, () => auth.getAccessToken());
          release();
          const results = await Promise.all(calls);

          const refreshes = fetch.mock.calls.filter(([, init]) => form(init).get("grant_type") === "refresh_token");
          expect(refreshes).toHaveLength(1);
          expect(new Set(results)).toEqual(new Set([succeeds ? "renewed" : null]));
          expect(auth.getState().status).toBe(succeeds ? "signed_in" : "signed_out");
        },
      ),
      propertyConfig,
    );
  });
});
