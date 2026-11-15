// Feature: eco-sentinel-frontend, Property 3: PKCE derivation and authorize URL
import { createHash } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createHttpGuard } from "@/core/api/httpGuard";
import { createAuthModule } from "@/core/auth/authModule";
import {
  buildAuthorizeUrl,
  codeChallengeS256,
  randomString,
  STATE_LENGTH,
  VERIFIER_LENGTH,
} from "@/core/auth/pkce";
import { STORAGE_KEYS, type AuthStorage } from "@/core/auth/storage";

import { buildPublicConfig } from "../factories";
import { propertyConfig } from "./propertyConfig";

const UNRESERVED = /^[A-Za-z0-9\-._~]+$/;

function referenceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

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

const unreservedVerifier = fc.stringMatching(/^[A-Za-z0-9\-._~]{43,128}$/);
const label = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/);
const configArb = fc.record({
  cognitoDomain: label.map((l) => `https://${l}.auth.eu-west-1.amazoncognito.com`),
  cognitoClientId: fc.stringMatching(/^[a-z0-9]{1,40}$/),
  redirectUri: fc.webPath().map((p) => `http://localhost:5173/auth/callback${p.replace(/[?#].*$/, "")}`),
});

describe("Property 3: PKCE derivation and authorize URL", () => {
  it("generated verifiers and states have the required length and alphabet", () => {
    fc.assert(
      fc.property(fc.integer({ min: 43, max: 128 }), (length) => {
        const value = randomString(length);
        expect(value).toHaveLength(length);
        expect(value).toMatch(UNRESERVED);
      }),
      propertyConfig,
    );
    const verifier = randomString(VERIFIER_LENGTH);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(randomString(STATE_LENGTH).length).toBeGreaterThanOrEqual(32);
  });

  it("the challenge is the unpadded base64url SHA-256 of the verifier", async () => {
    await fc.assert(
      fc.asyncProperty(unreservedVerifier, async (verifier) => {
        const challenge = await codeChallengeS256(verifier);
        expect(challenge).toBe(referenceChallenge(verifier));
        expect(challenge).not.toContain("=");
        expect(challenge).toHaveLength(43);
      }),
      propertyConfig,
    );
  });

  it("the authorize URL carries every required parameter for any configuration", () => {
    fc.assert(
      fc.property(configArb, fc.stringMatching(/^[A-Za-z0-9_-]{32,64}$/), fc.stringMatching(/^[A-Za-z0-9_-]{43}$/), (overrides, state, challenge) => {
        const config = buildPublicConfig(overrides);
        const url = new URL(buildAuthorizeUrl(config, { state, challenge }));
        expect(url.origin).toBe(new URL(config.cognitoDomain).origin);
        expect(url.pathname).toBe("/oauth2/authorize");
        const q = url.searchParams;
        expect(q.get("response_type")).toBe("code");
        expect(q.get("client_id")).toBe(config.cognitoClientId);
        expect(q.get("redirect_uri")).toBe(config.redirectUri);
        expect(q.get("scope")?.split(" ").sort()).toEqual(["email", "openid", "profile"]);
        expect(q.get("state")).toBe(state);
        expect(q.get("code_challenge")).toBe(challenge);
        expect(q.get("code_challenge_method")).toBe("S256");
        expect(q.has("client_secret")).toBe(false);
      }),
      propertyConfig,
    );
  });

  it("signIn stores the state and verifier it sends, and the challenge matches the verifier", async () => {
    await fc.assert(
      fc.asyncProperty(configArb, async (overrides) => {
        const config = buildPublicConfig(overrides);
        const storage = memoryStorage();
        let target = "";
        const auth = createAuthModule(config, {
          guard: createHttpGuard(config),
          storage,
          fetch: () => Promise.reject(new Error("no request expected")),
          redirect: (url) => {
            target = url;
          },
        });
        await auth.signIn("/areas");
        const q = new URL(target).searchParams;
        const verifier = storage.get(STORAGE_KEYS.verifier) ?? "";
        expect(verifier).toMatch(UNRESERVED);
        expect(verifier).toHaveLength(VERIFIER_LENGTH);
        expect(q.get("state")).toBe(storage.get(STORAGE_KEYS.state));
        expect(q.get("state")?.length ?? 0).toBeGreaterThanOrEqual(32);
        expect(q.get("code_challenge")).toBe(referenceChallenge(verifier));
        expect(storage.get(STORAGE_KEYS.returnTo)).toBe("/areas");
      }),
      propertyConfig,
    );
  });
});
