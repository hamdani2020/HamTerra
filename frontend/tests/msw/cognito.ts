import { http, HttpResponse, type HttpResponseResolver } from "msw";

import type { TokenResponse } from "@/core/auth/tokenEndpoint";

import { buildPublicConfig } from "../factories";

/** The placeholder Cognito domain from `buildPublicConfig`. */
export const COGNITO = buildPublicConfig().cognitoDomain;
export const TOKEN_URL = `${COGNITO}/oauth2/token`;

function base64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** An unsigned JWT-shaped ID token; the Frontend reads only the `email` claim for display. */
export function buildIdToken(claims: Record<string, unknown>): string {
  return `${base64Url(JSON.stringify({ alg: "none" }))}.${base64Url(JSON.stringify(claims))}.sig`;
}

export function buildTokenResponse(overrides: Partial<TokenResponse> = {}): TokenResponse {
  return {
    access_token: "dummy-access-token-1",
    id_token: buildIdToken({ email: "researcher@example.org", "cognito:groups": ["admin"] }),
    refresh_token: "dummy-refresh-token-1",
    expires_in: 3600,
    token_type: "Bearer",
    ...overrides,
  };
}

/** Every form posted to the token endpoint by the handlers below, in order. */
export const tokenRequests: URLSearchParams[] = [];

/** Install a token endpoint handler that records the posted form before answering. */
export function cognitoToken(resolve: (form: URLSearchParams) => Response | Promise<Response>) {
  const resolver: HttpResponseResolver = async ({ request }) => {
    const form = new URLSearchParams(await request.text());
    tokenRequests.push(form);
    return resolve(form);
  };
  return http.post(TOKEN_URL, resolver);
}

export const tokenOk = (overrides: Partial<TokenResponse> = {}) =>
  cognitoToken(() => HttpResponse.json(buildTokenResponse(overrides)));
