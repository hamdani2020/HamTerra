/**
 * Auth_Module (Requirement 3): Authorization Code with PKCE against Cognito.
 * - The access token and the ID-token email stay in memory; the refresh token is in
 *   `sessionStorage` (Requirement 3.6); nothing goes to `localStorage`.
 * - Roles are never read from tokens; they come only from `GET /me` (Requirement 3.12).
 * - It implements the API client's `AuthProvider` interface.
 */
import type { AuthProvider } from "@/core/api/client";
import type { HttpGuard } from "@/core/api/httpGuard";
import type { PublicConfig } from "@/core/config";
import {
  buildAuthorizeUrl,
  buildLogoutUrl,
  codeChallengeS256,
  randomString,
  STATE_LENGTH,
  VERIFIER_LENGTH,
} from "@/core/auth/pkce";
import { clearPkce, STORAGE_KEYS, type AuthStorage } from "@/core/auth/storage";
import { idTokenEmail, postToken, type TokenResponse } from "@/core/auth/tokenEndpoint";
import { PUBLIC_ROUTES, ROUTES } from "@/lib/routes";

export type AuthStatus = "signed_out" | "renewing" | "signed_in";

export interface AuthState {
  status: AuthStatus;
  /** Display only (Requirement 4.6). */
  idEmail: string | null;
  /** Why the last Session ended, until the next sign-in; guards add the expired notice. */
  endReason: SessionEndReason | null;
}

export type AuthFailure = "state_mismatch" | "access_denied" | "token_exchange_failed" | "network_failure";

export type CallbackResult = { ok: true; returnTo: string } | { ok: false; error: AuthFailure };

export type SessionEndReason = "expired" | "signed_out";

export interface AuthModule extends AuthProvider {
  getState(): AuthState;
  subscribe(listener: () => void): () => void;
  signIn(returnTo?: string): Promise<void>;
  handleCallback(search: string): Promise<CallbackResult>;
  restore(): Promise<void>;
  signOut(): void;
}

export interface AuthDeps {
  guard: HttpGuard;
  storage: AuthStorage;
  fetch?: typeof fetch;
  /** Full-page navigation to Cognito. */
  redirect?: (url: string) => void;
  now?: () => number;
  /** Called after the Session ends: clear cached data and route to `/` (expired) or nowhere. */
  onSessionEnded?: (reason: SessionEndReason) => void;
}

export const RENEW_BEFORE_MS = 60_000;
export const DEFAULT_RETURN_TO: string = ROUTES.dashboard;

/** Only in-app paths may be returned to, so a crafted value cannot redirect elsewhere. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return DEFAULT_RETURN_TO;
  }
  const path = value.split(/[?#]/, 1)[0] ?? value;
  if (PUBLIC_ROUTES.includes(path)) return DEFAULT_RETURN_TO;
  return value;
}

export function createAuthModule(config: PublicConfig, deps: AuthDeps): AuthModule {
  const fetchImpl = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const redirect = deps.redirect ?? ((url: string) => window.location.assign(url));
  const now = deps.now ?? (() => Date.now());
  const { storage, guard } = deps;

  let accessToken: string | null = null;
  let expiresAt = 0;
  // With a stored refresh token the Session is being restored, so guards wait for
  // `restore()` (called by AuthProvider) instead of redirecting to sign-in.
  let state: AuthState = {
    status: storage.get(STORAGE_KEYS.refreshToken) ? "renewing" : "signed_out",
    idEmail: null,
    endReason: null,
  };
  let inflight: Promise<boolean> | null = null;
  let callbackRun: { search: string; result: Promise<CallbackResult> } | null = null;
  let renewTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  function setState(next: AuthState): void {
    if (next.status === state.status && next.idEmail === state.idEmail && next.endReason === state.endReason) return;
    state = next;
    for (const listener of listeners) listener();
  }

  function scheduleRenewal(): void {
    clearTimeout(renewTimer);
    const delay = Math.max(0, expiresAt - now() - RENEW_BEFORE_MS);
    renewTimer = setTimeout(() => {
      // Renew proactively while the tab is visible; otherwise getAccessToken renews on use.
      if (typeof document === "undefined" || document.visibilityState === "visible") void renew();
    }, delay);
  }

  function acceptTokens(tokens: TokenResponse): void {
    accessToken = tokens.access_token;
    expiresAt = now() + tokens.expires_in * 1000;
    // Cognito usually returns no new refresh token on renewal; keep the stored one then.
    if (tokens.refresh_token) storage.set(STORAGE_KEYS.refreshToken, tokens.refresh_token);
    const email = tokens.id_token ? idTokenEmail(tokens.id_token) : state.idEmail;
    setState({ status: "signed_in", idEmail: email, endReason: null });
    scheduleRenewal();
  }

  function clearSession(endReason: SessionEndReason | null = null): void {
    clearTimeout(renewTimer);
    accessToken = null;
    expiresAt = 0;
    storage.clearAll();
    setState({ status: "signed_out", idEmail: null, endReason });
  }

  function endSession(reason: "expired"): void {
    clearSession(reason);
    deps.onSessionEnded?.(reason);
  }

  async function doRenew(): Promise<boolean> {
    const refreshToken = storage.get(STORAGE_KEYS.refreshToken);
    if (!refreshToken) return false;
    setState({ status: "renewing", idEmail: state.idEmail, endReason: state.endReason });
    const result = await postToken(config, guard, fetchImpl, {
      grant_type: "refresh_token",
      client_id: config.cognitoClientId,
      refresh_token: refreshToken,
    });
    if (!result.ok) return false;
    acceptTokens(result.tokens);
    return true;
  }

  /** Single flight: concurrent callers share one request (Requirement 3.7). */
  function renew(): Promise<boolean> {
    inflight ??= doRenew()
      .then((ok) => {
        if (!ok && (accessToken !== null || storage.get(STORAGE_KEYS.refreshToken) !== null || state.status !== "signed_out")) {
          endSession("expired");
        }
        return ok;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  async function getAccessToken(): Promise<string | null> {
    if (accessToken && expiresAt - now() > RENEW_BEFORE_MS) return accessToken;
    if (!storage.get(STORAGE_KEYS.refreshToken)) return accessToken && expiresAt > now() ? accessToken : null;
    return (await renew()) ? accessToken : null;
  }

  async function signIn(returnTo?: string): Promise<void> {
    const verifier = randomString(VERIFIER_LENGTH);
    const stateValue = randomString(STATE_LENGTH);
    const challenge = await codeChallengeS256(verifier);
    storage.set(STORAGE_KEYS.verifier, verifier);
    storage.set(STORAGE_KEYS.state, stateValue);
    storage.set(STORAGE_KEYS.returnTo, safeReturnTo(returnTo));
    redirect(guard.check(buildAuthorizeUrl(config, { state: stateValue, challenge })).toString());
  }

  async function runCallback(search: string): Promise<CallbackResult> {
    const params = new URLSearchParams(search);
    const storedState = storage.get(STORAGE_KEYS.state);
    const verifier = storage.get(STORAGE_KEYS.verifier);
    const returnTo = safeReturnTo(storage.get(STORAGE_KEYS.returnTo));
    const returnedState = params.get("state");

    // State gate (Requirements 3.3, 3.14): no token request unless everything matches.
    if (!storedState || !verifier || !returnedState || returnedState !== storedState) {
      clearPkce(storage);
      return { ok: false, error: "state_mismatch" };
    }
    // The provider's error_description is never shown (Requirement 3.4).
    if (params.has("error")) {
      clearPkce(storage);
      return { ok: false, error: "access_denied" };
    }
    const code = params.get("code");
    if (!code) {
      clearPkce(storage);
      return { ok: false, error: "token_exchange_failed" };
    }

    const exchange = postToken(config, guard, fetchImpl, {
      grant_type: "authorization_code",
      client_id: config.cognitoClientId,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    });
    // Removed as soon as the request is sent (Requirement 3.2).
    clearPkce(storage);
    const result = await exchange;
    if (!result.ok) {
      clearSession();
      return { ok: false, error: result.failure === "rejected" ? "token_exchange_failed" : "network_failure" };
    }
    acceptTokens(result.tokens);
    return { ok: true, returnTo };
  }

  function handleCallback(search: string): Promise<CallbackResult> {
    // Idempotent per URL, so a second run (React strict mode) sends nothing new.
    if (callbackRun?.search !== search) callbackRun = { search, result: runCallback(search) };
    return callbackRun.result;
  }

  async function restore(): Promise<void> {
    if (accessToken || !storage.get(STORAGE_KEYS.refreshToken)) return;
    await renew();
  }

  function signOut(): void {
    clearSession("signed_out");
    deps.onSessionEnded?.("signed_out");
    redirect(guard.check(buildLogoutUrl(config)).toString());
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    signIn,
    handleCallback,
    getAccessToken,
    renew,
    endSession,
    restore,
    signOut,
  };
}
