import type { PublicConfig } from "@/core/config";

/**
 * Typed test-data builders. `builder(defaults)` returns a function that produces a fresh
 * copy of the defaults with optional overrides, so tests never share mutable fixtures.
 * Builders for the Backend contract types are added with `src/types/api.ts` (task 6).
 */
export type Builder<T> = (overrides?: Partial<T>) => T;

export function builder<T extends object>(defaults: () => T): Builder<T> {
  return (overrides = {}) => ({ ...defaults(), ...overrides });
}

let counter = 0;

/** A deterministic, unique UUID-shaped identifier for test data. */
export function testId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
}


/** A valid public configuration with placeholder values. */
export const buildPublicConfig = builder<PublicConfig>(() => ({
  apiBaseUrl: "http://localhost:8000/api/v1",
  cognitoDomain: "https://example.auth.eu-west-1.amazoncognito.com",
  cognitoClientId: "exampleclientid",
  cognitoRegion: "eu-west-1",
  redirectUri: "http://localhost:5173/auth/callback",
  logoutUri: "http://localhost:5173/signed-out",
  basemapTileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
}));

/** The same configuration as `VITE_` variables. */
export function buildEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  const c = buildPublicConfig();
  return {
    VITE_API_BASE_URL: c.apiBaseUrl,
    VITE_COGNITO_DOMAIN: c.cognitoDomain,
    VITE_COGNITO_CLIENT_ID: c.cognitoClientId,
    VITE_COGNITO_REGION: c.cognitoRegion,
    VITE_REDIRECT_URI: c.redirectUri,
    VITE_LOGOUT_URI: c.logoutUri,
    ...overrides,
  };
}
