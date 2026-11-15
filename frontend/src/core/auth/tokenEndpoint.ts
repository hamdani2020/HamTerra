/**
 * Cognito token endpoint calls: authorization code exchange and refresh (public client,
 * no client secret). 10 s timeout, one attempt.
 */
import type { HttpGuard } from "@/core/api/httpGuard";
import type { PublicConfig } from "@/core/config";

export const TOKEN_TIMEOUT_MS = 10_000;

export interface TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export function isTokenResponse(body: unknown): body is TokenResponse {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.access_token === "string" &&
    b.access_token !== "" &&
    typeof b.expires_in === "number" &&
    Number.isFinite(b.expires_in) &&
    b.expires_in > 0 &&
    typeof b.token_type === "string" &&
    (b.id_token === undefined || typeof b.id_token === "string") &&
    (b.refresh_token === undefined || typeof b.refresh_token === "string")
  );
}

export type TokenFailure = "rejected" | "network" | "timeout";

export type TokenResult = { ok: true; tokens: TokenResponse } | { ok: false; failure: TokenFailure };

export async function postToken(
  config: PublicConfig,
  guard: HttpGuard,
  fetchImpl: typeof fetch,
  form: Record<string, string>,
): Promise<TokenResult> {
  const url = guard.check(new URL("/oauth2/token", config.cognitoDomain));
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TOKEN_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
      credentials: "omit",
    });
    if (!response.ok) return { ok: false, failure: "rejected" };
    const body: unknown = await response.json().catch(() => null);
    return isTokenResponse(body) ? { ok: true, tokens: body } : { ok: false, failure: "rejected" };
  } catch {
    return { ok: false, failure: timedOut ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

/** The `email` claim of an ID token, for display only. Never used for access decisions. */
export function idTokenEmail(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "="));
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0)))) as unknown;
    const email = (claims as { email?: unknown } | null)?.email;
    return typeof email === "string" && email !== "" ? email : null;
  } catch {
    return null;
  }
}
