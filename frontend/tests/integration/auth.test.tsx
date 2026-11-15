import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STORAGE_KEYS } from "@/core/auth/storage";
import { TOKEN_TIMEOUT_MS } from "@/core/auth/tokenEndpoint";
import { AUTH_FAILURE_TEXT, AUTH_TEXT } from "@/lib/messages";

import { renderApp } from "../auth/authHarness";
import { COGNITO, cognitoToken, tokenOk, tokenRequests } from "../msw/cognito";
import { server } from "../msw/server";

const STATE = "s".repeat(43);
const VERIFIER = "v".repeat(64);

function startedSignIn(returnTo = "/areas"): void {
  sessionStorage.setItem(STORAGE_KEYS.state, STATE);
  sessionStorage.setItem(STORAGE_KEYS.verifier, VERIFIER);
  sessionStorage.setItem(STORAGE_KEYS.returnTo, returnTo);
}

async function expectNoSession(services: Awaited<ReturnType<typeof renderApp>>["services"]): Promise<void> {
  expect(services.auth.getState().status).toBe("signed_out");
  expect(await services.auth.getAccessToken()).toBeNull();
  expect(sessionStorage.getItem(STORAGE_KEYS.refreshToken)).toBeNull();
  expect(sessionStorage.getItem(STORAGE_KEYS.state)).toBeNull();
  expect(sessionStorage.getItem(STORAGE_KEYS.verifier)).toBeNull();
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  tokenRequests.length = 0;
});

afterEach(() => {
  // Requirement 23.2: nothing auth-related ever reaches localStorage.
  expect(localStorage.length).toBe(0);
  vi.useRealTimers();
});

describe("sign-in redirect (Requirement 3.1)", () => {
  it("redirects to the Cognito authorize endpoint with PKCE parameters", async () => {
    const { redirect, config } = await renderApp("/");
    expect(screen.getByRole("heading", { level: 1, name: AUTH_TEXT.appName })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: AUTH_TEXT.signIn }));
    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));

    const url = new URL(String(redirect.mock.calls[0]?.[0]));
    expect(`${url.origin}${url.pathname}`).toBe(`${COGNITO}/oauth2/authorize`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(config.cognitoClientId);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(sessionStorage.getItem(STORAGE_KEYS.state));
    expect(sessionStorage.getItem(STORAGE_KEYS.verifier)).toHaveLength(64);
    expect(screen.getByRole("button", { name: AUTH_TEXT.redirecting })).toBeDisabled();
    expect(tokenRequests).toHaveLength(0);
  });
});

describe("callback (Requirements 3.2 to 3.5)", () => {
  it("exchanges the code once under strict mode and opens the saved route", async () => {
    startedSignIn("/areas");
    server.use(tokenOk());
    const { services, pathname, config } = await renderApp(`/auth/callback?code=abc&state=${STATE}`);

    await waitFor(() => expect(pathname()).toBe("/areas"));
    expect(tokenRequests).toHaveLength(1);
    const form = tokenRequests[0];
    expect(form?.get("grant_type")).toBe("authorization_code");
    expect(form?.get("code")).toBe("abc");
    expect(form?.get("code_verifier")).toBe(VERIFIER);
    expect(form?.get("client_id")).toBe(config.cognitoClientId);
    expect(form?.get("redirect_uri")).toBe(config.redirectUri);
    expect(form?.has("client_secret")).toBe(false);

    expect(services.auth.getState()).toEqual({ status: "signed_in", idEmail: "researcher@example.org", endReason: null });
    expect(await services.auth.getAccessToken()).toBe("dummy-access-token-1");
    expect(sessionStorage.getItem(STORAGE_KEYS.refreshToken)).toBe("dummy-refresh-token-1");
    expect(sessionStorage.getItem(STORAGE_KEYS.state)).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEYS.verifier)).toBeNull();
    for (let i = 0; i < sessionStorage.length; i += 1) {
      expect(sessionStorage.getItem(sessionStorage.key(i) ?? "")).not.toBe("dummy-access-token-1");
    }
  });

  it("goes to /dashboard when no route was saved", async () => {
    sessionStorage.setItem(STORAGE_KEYS.state, STATE);
    sessionStorage.setItem(STORAGE_KEYS.verifier, VERIFIER);
    server.use(tokenOk());
    const { pathname } = await renderApp(`/auth/callback?code=abc&state=${STATE}`);
    await waitFor(() => expect(pathname()).toBe("/dashboard"));
  });

  it("refuses a state mismatch without a token request", async () => {
    startedSignIn();
    const { services, pathname } = await renderApp("/auth/callback?code=abc&state=other");
    await waitFor(() => expect(pathname()).toBe("/auth/error"));
    expect(await screen.findByRole("heading", { level: 1, name: AUTH_FAILURE_TEXT.state_mismatch.title })).toBeInTheDocument();
    expect(tokenRequests).toHaveLength(0);
    await expectNoSession(services);
  });

  it("refuses a callback after the stored values were removed (reload)", async () => {
    const { services, pathname } = await renderApp(`/auth/callback?code=abc&state=${STATE}`);
    await waitFor(() => expect(pathname()).toBe("/auth/error"));
    expect(await screen.findByRole("heading", { level: 1, name: AUTH_FAILURE_TEXT.state_mismatch.title })).toBeInTheDocument();
    expect(tokenRequests).toHaveLength(0);
    await expectNoSession(services);
  });

  it("names access denied for an error parameter and hides error_description", async () => {
    startedSignIn();
    const { services, pathname, container } = await renderApp(
      `/auth/callback?error=access_denied&error_description=Provider+detail+xyz&state=${STATE}`,
    );
    await waitFor(() => expect(pathname()).toBe("/auth/error"));
    expect(await screen.findByRole("heading", { level: 1, name: AUTH_FAILURE_TEXT.access_denied.title })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(AUTH_FAILURE_TEXT.access_denied.body);
    expect(container.textContent).not.toContain("Provider detail xyz");
    expect(tokenRequests).toHaveLength(0);
    await expectNoSession(services);
  });

  it("names token exchange failed for a rejected code and shows no provider text", async () => {
    startedSignIn();
    server.use(
      cognitoToken(() =>
        HttpResponse.json({ error: "invalid_grant", error_description: "Provider detail xyz" }, { status: 400 }),
      ),
    );
    const { services, pathname, container } = await renderApp(`/auth/callback?code=abc&state=${STATE}`);
    await waitFor(() => expect(pathname()).toBe("/auth/error"));
    expect(await screen.findByRole("heading", { level: 1, name: AUTH_FAILURE_TEXT.token_exchange_failed.title })).toBeInTheDocument();
    expect(container.textContent).not.toContain("Provider detail xyz");
    expect(tokenRequests).toHaveLength(1);
    await expectNoSession(services);
  });

  it("names network failure when the token endpoint does not answer within 10 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    startedSignIn();
    server.use(cognitoToken(async () => {
      await delay("infinite");
      return HttpResponse.json({});
    }));
    const { services, pathname } = await renderApp(`/auth/callback?code=abc&state=${STATE}`);
    await waitFor(() => expect(tokenRequests).toHaveLength(1));
    await act(async () => {
      // A margin, because shouldAdvanceTime also moves the clock with real time.
      await vi.advanceTimersByTimeAsync(TOKEN_TIMEOUT_MS - 500);
    });
    expect(pathname()).toBe("/auth/callback");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await waitFor(() => expect(pathname()).toBe("/auth/error"));
    expect(await screen.findByRole("heading", { level: 1, name: AUTH_FAILURE_TEXT.network_failure.title })).toBeInTheDocument();
    await expectNoSession(services);
  });

  it("offers a way back to the sign-in page", async () => {
    const { pathname } = await renderApp(`/auth/callback?code=abc&state=${STATE}`);
    await waitFor(() => expect(pathname()).toBe("/auth/error"));
    await userEvent.click(await screen.findByRole("link", { name: AUTH_TEXT.backToSignIn }));
    expect(pathname()).toBe("/");
    expect(await screen.findByRole("button", { name: AUTH_TEXT.signIn })).toBeInTheDocument();
  });
});

describe("renewal (Requirements 3.6 to 3.8)", () => {
  it("restores the Session from the stored refresh token on reload", async () => {
    sessionStorage.setItem(STORAGE_KEYS.refreshToken, "dummy-refresh-token-1");
    server.use(tokenOk({ access_token: "dummy-access-token-2", refresh_token: undefined }));
    const { services, pathname } = await renderApp("/");
    await waitFor(() => expect(pathname()).toBe("/dashboard"));
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]?.get("grant_type")).toBe("refresh_token");
    expect(tokenRequests[0]?.get("refresh_token")).toBe("dummy-refresh-token-1");
    expect(await services.auth.getAccessToken()).toBe("dummy-access-token-2");
    // Cognito sent no new refresh token, so the stored one is kept.
    expect(sessionStorage.getItem(STORAGE_KEYS.refreshToken)).toBe("dummy-refresh-token-1");
  });

  it("ends the Session with the expired notice when renewal fails", async () => {
    sessionStorage.setItem(STORAGE_KEYS.refreshToken, "dummy-refresh-token-1");
    server.use(cognitoToken(() => HttpResponse.json({ error: "invalid_grant" }, { status: 400 })));
    const { services, pathname } = await renderApp("/");
    await waitFor(() => expect(screen.getByText(AUTH_TEXT.sessionExpired)).toBeInTheDocument());
    expect(pathname()).toBe("/");
    expect(tokenRequests).toHaveLength(1);
    expect(screen.getByRole("button", { name: AUTH_TEXT.signIn })).toBeInTheDocument();
    await expectNoSession(services);
  });

  it("clears cached API data when the Session expires", async () => {
    startedSignIn();
    server.use(tokenOk({ expires_in: 3600 }));
    const { services, pathname } = await renderApp(`/auth/callback?code=abc&state=${STATE}`);
    await waitFor(() => expect(pathname()).toBe("/areas"));
    services.queryClient.setQueryData(["areas", {}], { items: [] });

    server.use(cognitoToken(() => HttpResponse.json({ error: "invalid_grant" }, { status: 400 })));
    await act(async () => {
      expect(await services.auth.renew()).toBe(false);
    });
    await waitFor(() => expect(pathname()).toBe("/"));
    expect(await screen.findByText(AUTH_TEXT.sessionExpired)).toBeInTheDocument();
    expect(services.queryClient.getQueryData(["areas", {}])).toBeUndefined();
    await expectNoSession(services);
  });
});

describe("sign-out (Requirements 3.9, 3.10)", () => {
  it("clears tokens, storage and cache, then redirects to the Cognito logout endpoint", async () => {
    startedSignIn();
    server.use(tokenOk());
    const { services, pathname, redirect, config } = await renderApp(`/auth/callback?code=abc&state=${STATE}`);
    await waitFor(() => expect(pathname()).toBe("/areas"));
    services.queryClient.setQueryData(["me"], { sub: "x" });

    act(() => services.auth.signOut());

    const url = new URL(String(redirect.mock.calls.at(-1)?.[0]));
    expect(`${url.origin}${url.pathname}`).toBe(`${COGNITO}/logout`);
    expect(url.searchParams.get("client_id")).toBe(config.cognitoClientId);
    expect(url.searchParams.get("logout_uri")).toBe(config.logoutUri);
    expect(services.queryClient.getQueryData(["me"])).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
    await expectNoSession(services);
  });

  it("the signed-out page confirms the sign-out and starts sign-in again", async () => {
    const { redirect } = await renderApp("/signed-out");
    expect(screen.getByRole("heading", { level: 1, name: AUTH_TEXT.signedOutTitle })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: AUTH_TEXT.signInAgain }));
    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
    expect(String(redirect.mock.calls[0]?.[0])).toContain(`${COGNITO}/oauth2/authorize?`);
  });
});
