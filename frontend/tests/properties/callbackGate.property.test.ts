// Feature: eco-sentinel-frontend, Property 4: Callback state gate
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { createHttpGuard } from "@/core/api/httpGuard";
import { createAuthModule } from "@/core/auth/authModule";
import { STORAGE_KEYS, type AuthStorage } from "@/core/auth/storage";

import { buildPublicConfig } from "../factories";
import { buildTokenResponse } from "../msw/cognito";
import { propertyConfig } from "./propertyConfig";

const config = buildPublicConfig();
const token = fc.stringMatching(/^[A-Za-z0-9_-]{1,64}$/);

function memoryStorage(): AuthStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
    clearAll: () => data.clear(),
  };
}

const scenario = fc.record({
  stored: fc.option(token, { nil: undefined }),
  verifier: fc.option(token, { nil: undefined }),
  // "same" makes matching states common enough to exercise the success branch.
  returned: fc.oneof(fc.constant<"same">("same"), fc.constant(undefined), token),
  code: token,
});

describe("Property 4: Callback state gate", () => {
  it("sends a token request iff both states and the verifier are present and equal", async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async ({ stored, verifier, returned, code }) => {
        const storage = memoryStorage();
        if (stored !== undefined) storage.set(STORAGE_KEYS.state, stored);
        if (verifier !== undefined) storage.set(STORAGE_KEYS.verifier, verifier);
        storage.set(STORAGE_KEYS.returnTo, "/areas");
        const returnedState = returned === "same" ? stored : returned;

        const fetch = vi.fn(async () => Response.json(buildTokenResponse()));
        const auth = createAuthModule(config, { guard: createHttpGuard(config), storage, fetch });
        const params = new URLSearchParams({ code });
        if (returnedState !== undefined) params.set("state", returnedState);

        const result = await auth.handleCallback(`?${params.toString()}`);
        const shouldSend =
          stored !== undefined && verifier !== undefined && returnedState !== undefined && returnedState === stored;

        expect(fetch).toHaveBeenCalledTimes(shouldSend ? 1 : 0);
        // Stored PKCE values are gone either way (Requirements 3.2, 3.3).
        expect(storage.get(STORAGE_KEYS.state)).toBeNull();
        expect(storage.get(STORAGE_KEYS.verifier)).toBeNull();
        if (shouldSend) {
          expect(result).toEqual({ ok: true, returnTo: "/areas" });
          const form = new URLSearchParams(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
          expect(form.get("code")).toBe(code);
          expect(form.get("code_verifier")).toBe(verifier);
        } else {
          expect(result).toEqual({ ok: false, error: "state_mismatch" });
          expect(auth.getState().status).toBe("signed_out");
          expect(await auth.getAccessToken()).toBeNull();
        }
      }),
      propertyConfig,
    );
  });
});
