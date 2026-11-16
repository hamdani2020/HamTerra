import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { STORAGE_KEYS } from "@/core/auth/storage";
import { AUTH_TEXT, SHELL_TEXT } from "@/lib/messages";

import { renderApp, renderSignedIn } from "../auth/authHarness";
import { buildTokenResponse, cognitoToken, tokenOk, tokenRequests } from "../msw/cognito";
import { API, envelope } from "../msw/contract";
import { server } from "../msw/server";

let meCalls = 0;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  tokenRequests.length = 0;
  meCalls = 0;
});

const countedMe = (respond: () => Response) =>
  http.get(`${API}/me`, () => {
    meCalls += 1;
    return respond();
  });

describe("route protection (Requirements 1.8, 4.3)", () => {
  it("sends a visitor without a Session to / and keeps the requested path", async () => {
    const { pathname, services } = await renderApp("/areas?status=active");
    await waitFor(() => expect(pathname()).toBe("/"));
    expect(await screen.findByRole("button", { name: AUTH_TEXT.signIn })).toBeInTheDocument();
    expect(services.router.state.location.state).toEqual({ from: "/areas?status=active" });
    expect(meCalls).toBe(0);
  });

  it("returns to the requested path after sign-in", async () => {
    const first = await renderApp("/reports");
    await waitFor(() => expect(first.pathname()).toBe("/"));
    await userEvent.click(await screen.findByRole("button", { name: AUTH_TEXT.signIn }));
    await waitFor(() => expect(first.redirect).toHaveBeenCalledTimes(1));
    const state = new URL(String(first.redirect.mock.calls[0]?.[0])).searchParams.get("state");
    expect(sessionStorage.getItem(STORAGE_KEYS.returnTo)).toBe("/reports");
    first.unmount();

    server.use(tokenOk(), countedMe(() => HttpResponse.json({ sub: "s", username: "researcher1", email: null, roles: ["researcher"], permissions: [] })));
    const second = await renderApp(`/auth/callback?code=abc&state=${state ?? ""}`);
    await waitFor(() => expect(second.pathname()).toBe("/reports"));
    expect(await screen.findByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();
    expect(meCalls).toBe(1);
  });

  it("shows a loading state until GET /me completes, then the shell", async () => {
    const view = await renderSignedIn("/dashboard", { username: "researcher1", email: "researcher1@example.org" });
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByTestId("principal-email")).toHaveTextContent("researcher1@example.org");
    expect(view.pathname()).toBe("/dashboard");
  });
});

describe("GET /me failures (Requirements 4.4, 4.5)", () => {
  it("401 renews once, and when renewal fails ends the Session with the expired notice", async () => {
    let refreshes = 0;
    const token = cognitoToken(() => {
      refreshes += 1;
      return refreshes === 1
        ? HttpResponse.json(buildTokenResponse({ refresh_token: undefined }))
        : HttpResponse.json({ error: "invalid_grant" }, { status: 400 });
    });
    const { pathname, services } = await renderSignedIn(
      "/areas",
      {},
      countedMe(() => HttpResponse.json(envelope("UNAUTHENTICATED", "Token expired"), { status: 401 })),
      token,
    );
    await waitFor(() => expect(pathname()).toBe("/"));
    expect(await screen.findByText(AUTH_TEXT.sessionExpired)).toBeInTheDocument();
    expect(meCalls).toBe(1);
    expect(refreshes).toBe(2);
    expect(services.auth.getState().status).toBe("signed_out");
    expect(sessionStorage.getItem(STORAGE_KEYS.refreshToken)).toBeNull();
    expect(services.router.state.location.state).toEqual({ notice: "session_expired", from: "/areas" });
  });

  it.each([
    ["500", () => HttpResponse.json(envelope("INTERNAL_ERROR", "x"), { status: 500 })],
    ["503", () => HttpResponse.json(envelope("SERVICE_UNAVAILABLE", "x"), { status: 503 })],
    ["a network error", () => HttpResponse.error()],
  ])("%s shows an error with retry, keeps the Session and renders no protected content", async (_label, respond) => {
    let fail = true;
    const { pathname, services } = await renderSignedIn(
      "/areas",
      {},
      countedMe(() => (fail ? respond() : HttpResponse.json({ sub: "s", username: "researcher1", email: null, roles: ["researcher"], permissions: [] }))),
    );
    expect(await screen.findByRole("heading", { level: 1, name: SHELL_TEXT.accountErrorTitle })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(pathname()).toBe("/areas");
    expect(services.auth.getState().status).toBe("signed_in");
    expect(meCalls).toBe(1);

    fail = false;
    await userEvent.click(screen.getByRole("button", { name: SHELL_TEXT.retry }));
    expect(await screen.findByRole("heading", { level: 1, name: "Areas" })).toBeInTheDocument();
    expect(meCalls).toBe(2);
  });

  it("a malformed GET /me body is an error, not a Principal", async () => {
    await renderSignedIn("/dashboard", {}, countedMe(() => HttpResponse.json({ sub: "s", roles: "admin" })));
    expect(await screen.findByRole("heading", { level: 1, name: SHELL_TEXT.accountErrorTitle })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});

describe("no role (Requirement 3.13)", () => {
  it("explains the missing role and offers only sign-out", async () => {
    const { pathname, redirect } = await renderSignedIn("/dashboard", { roles: [], username: "newuser" });
    expect(await screen.findByRole("heading", { level: 1, name: SHELL_TEXT.noRoleTitle })).toBeInTheDocument();
    expect(screen.getByText(SHELL_TEXT.noRoleBody)).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    const main = screen.getByRole("main");
    expect(within(main).getAllByRole("button").map((b) => b.textContent)).toEqual([SHELL_TEXT.signOut]);
    expect(within(main).queryAllByRole("link")).toHaveLength(0);
    expect(pathname()).toBe("/dashboard");

    await userEvent.click(screen.getByRole("button", { name: SHELL_TEXT.signOut }));
    expect(String(redirect.mock.calls.at(-1)?.[0])).toContain("/logout?");
  });

  it("treats unknown role names as no role", async () => {
    await renderSignedIn("/dashboard", { roles: ["viewer"] });
    expect(await screen.findByRole("heading", { level: 1, name: SHELL_TEXT.noRoleTitle })).toBeInTheDocument();
  });
});

describe("not found (Requirement 1.10)", () => {
  it("links to / without a Session", async () => {
    await renderApp("/no-such-page");
    expect(screen.getByRole("heading", { level: 1, name: SHELL_TEXT.notFoundTitle })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: SHELL_TEXT.toSignIn })).toHaveAttribute("href", "/");
  });

  it("links to /dashboard with a Session", async () => {
    await renderSignedIn("/no-such-page");
    await waitFor(() => expect(screen.getByRole("link", { name: SHELL_TEXT.toDashboard })).toHaveAttribute("href", "/dashboard"));
  });
});
