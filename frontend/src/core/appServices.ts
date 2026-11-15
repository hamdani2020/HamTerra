import type { QueryClient } from "@tanstack/react-query";
import { createBrowserRouter, type RouteObject } from "react-router";

import { createApiClient } from "@/core/api/client";
import { createEndpoints, type Endpoints } from "@/core/api/endpoints";
import { createHttpGuard } from "@/core/api/httpGuard";
import { createQueryClient } from "@/core/api/queryClient";
import { createAuthModule, type AuthModule } from "@/core/auth/authModule";
import { sessionAuthStorage, type AuthStorage } from "@/core/auth/storage";
import type { PublicConfig } from "@/core/config";
import { ROUTES, type LandingState } from "@/lib/routes";
import { appRoutes } from "@/router";

export type AppRouter = ReturnType<typeof createBrowserRouter>;

export interface AppServices {
  auth: AuthModule;
  api: Endpoints;
  queryClient: QueryClient;
  router: AppRouter;
}

export interface AppServiceOverrides {
  createRouter?: (routes: RouteObject[]) => AppRouter;
  storage?: AuthStorage;
  fetch?: typeof fetch;
  redirect?: (url: string) => void;
}

/**
 * Wires the Auth_Module, API client, query cache and router once per page load. When the
 * Session ends, the cache is cleared; an expired Session also lands on `/` with the notice
 * (Requirements 3.8, 3.9).
 */
export function createAppServices(config: PublicConfig, overrides: AppServiceOverrides = {}): AppServices {
  const guard = createHttpGuard(config);
  const queryClient = createQueryClient();
  const router = (overrides.createRouter ?? ((routes) => createBrowserRouter(routes)))(appRoutes());
  const auth = createAuthModule(config, {
    guard,
    storage: overrides.storage ?? sessionAuthStorage(),
    ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
    ...(overrides.redirect ? { redirect: overrides.redirect } : {}),
    onSessionEnded(reason) {
      queryClient.clear();
      if (reason === "expired") {
        const state: LandingState = { notice: "session_expired" };
        void router.navigate(ROUTES.landing, { replace: true, state });
      }
    },
  });
  const api = createEndpoints(createApiClient(guard, auth));
  return { auth, api, queryClient, router };
}
