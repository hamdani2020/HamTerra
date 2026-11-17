import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { http, HttpResponse, type RequestHandler } from "msw";
import { createMemoryRouter } from "react-router";
import { vi } from "vitest";

import { App } from "@/App";
import { createAppServices } from "@/core/appServices";
import { STORAGE_KEYS } from "@/core/auth/storage";
import type { PrincipalMe } from "@/types/api";

import { buildPublicConfig } from "../factories";
import { tokenOk } from "../msw/cognito";
import { API, buildMe } from "../msw/contract";
import { server } from "../msw/server";

/** The real app wiring with a memory router and a captured full-page redirect. */
export async function renderApp(path: string) {
  const config = buildPublicConfig();
  const redirect = vi.fn<(url: string) => void>();
  const navigate = vi.fn<(url: string) => void>();
  const services = createAppServices(config, {
    createRouter: (routes) => createMemoryRouter(routes, { initialEntries: [path] }),
    redirect,
    navigate,
  });
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <StrictMode>
        <App config={config} services={services} />
      </StrictMode>,
    );
  });
  return { ...view, services, redirect, navigate, config, pathname: () => services.router.state.location.pathname };
}

/**
 * The app opened at `path` with a Session restored from a stored refresh token (the
 * reload path), and `GET /me` answering with `me`.
 */
export async function renderSignedIn(
  path: string,
  me: Partial<PrincipalMe> = {},
  meHandler?: RequestHandler,
  tokenHandler?: RequestHandler,
) {
  sessionStorage.setItem(STORAGE_KEYS.refreshToken, "dummy-refresh-token-1");
  server.use(
    tokenHandler ?? tokenOk({ refresh_token: undefined }),
    meHandler ?? http.get(`${API}/me`, () => HttpResponse.json(buildMe(me))),
  );
  return renderApp(path);
}
