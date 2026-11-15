import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { RouterProvider } from "react-router";

import { createAppServices, type AppServices } from "@/core/appServices";
import { AuthProvider } from "@/core/auth/AuthProvider";
import type { PublicConfig } from "@/core/config";

export interface AppProps {
  config: PublicConfig;
  /** Tests inject services built with a memory router and fakes. */
  services?: AppServices;
}

export function App({ config, services }: AppProps): JSX.Element {
  const [{ auth, queryClient, router }] = useState(() => services ?? createAppServices(config));
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider auth={auth}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
