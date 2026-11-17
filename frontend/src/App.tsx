import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { RouterProvider } from "react-router";

import { ApiProvider } from "@/core/api/ApiProvider";
import { ConfigProvider } from "@/core/ConfigProvider";
import { createAppServices, type AppServices } from "@/core/appServices";
import { AuthProvider } from "@/core/auth/AuthProvider";
import type { PublicConfig } from "@/core/config";
import { DemoProvider } from "@/core/demo/DemoContext";

export interface AppProps {
  config: PublicConfig;
  /** Tests inject services built with a memory router and fakes. */
  services?: AppServices;
}

export function App({ config, services }: AppProps): JSX.Element {
  const [{ auth, api, queryClient, router, demo }] = useState(() => services ?? createAppServices(config));
  return (
    <ConfigProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ApiProvider api={api}>
          <AuthProvider auth={auth}>
            <DemoProvider value={demo}>
              <RouterProvider router={router} />
            </DemoProvider>
          </AuthProvider>
        </ApiProvider>
      </QueryClientProvider>
    </ConfigProvider>
  );
}
