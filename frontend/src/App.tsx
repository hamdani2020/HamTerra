import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { RouterProvider } from "react-router";

import { ApiProvider } from "@/core/api/ApiProvider";
import { createAppServices, type AppServices } from "@/core/appServices";
import { AuthProvider } from "@/core/auth/AuthProvider";
import type { PublicConfig } from "@/core/config";

export interface AppProps {
  config: PublicConfig;
  /** Tests inject services built with a memory router and fakes. */
  services?: AppServices;
}

export function App({ config, services }: AppProps): JSX.Element {
  const [{ auth, api, queryClient, router }] = useState(() => services ?? createAppServices(config));
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <AuthProvider auth={auth}>
          <RouterProvider router={router} />
        </AuthProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}
