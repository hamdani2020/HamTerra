import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { createMemoryRouter } from "react-router";
import { vi } from "vitest";

import { App } from "@/App";
import { createAppServices } from "@/core/appServices";

import { buildPublicConfig } from "../factories";

/** The real app wiring with a memory router and a captured full-page redirect. */
export async function renderApp(path: string) {
  const config = buildPublicConfig();
  const redirect = vi.fn<(url: string) => void>();
  const services = createAppServices(config, {
    createRouter: (routes) => createMemoryRouter(routes, { initialEntries: [path] }),
    redirect,
  });
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <StrictMode>
        <App config={config} services={services} />
      </StrictMode>,
    );
  });
  return { ...view, services, redirect, config, pathname: () => services.router.state.location.pathname };
}
