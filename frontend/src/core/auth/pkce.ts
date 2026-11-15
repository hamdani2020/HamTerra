/** PKCE and state helpers (Requirement 3.1, RFC 7636). Pure apart from the random source. */
import type { PublicConfig } from "@/core/config";

export const VERIFIER_LENGTH = 64; // RFC 7636 allows 43 to 128
export const STATE_LENGTH = 43; // 32 random bytes in base64url
export const SCOPES = "openid email profile";

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `length` characters of base64url from the Web Crypto random source. */
export function randomString(length: number): string {
  const bytes = new Uint8Array(Math.ceil((length * 3) / 4) + 1);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes).slice(0, length);
}

/** base64url(SHA-256(ascii(verifier))), no padding. */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export function buildAuthorizeUrl(
  config: PublicConfig,
  { state, challenge }: { state: string; challenge: string },
): string {
  const url = new URL("/oauth2/authorize", config.cognitoDomain);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.cognitoClientId,
    redirect_uri: config.redirectUri,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export function buildLogoutUrl(config: PublicConfig): string {
  const url = new URL("/logout", config.cognitoDomain);
  url.search = new URLSearchParams({
    client_id: config.cognitoClientId,
    logout_uri: config.logoutUri,
  }).toString();
  return url.toString();
}
