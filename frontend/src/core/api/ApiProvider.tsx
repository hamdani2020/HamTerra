import { createContext, type ReactNode, useContext } from "react";

import type { Endpoints } from "@/core/api/endpoints";

const ApiContext = createContext<Endpoints | null>(null);

/** Supplies the endpoint functions built in `createAppServices`, so hooks never build a client. */
export function ApiProvider({ api, children }: { api: Endpoints; children: ReactNode }): JSX.Element {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): Endpoints {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi must be used inside ApiProvider");
  return api;
}

// Hot updates would re-create the API context while mounted components keep the old one,
// so a change to this module (or anything it imports) reloads the page in development.
// Vite 7 has no `decline`: the module accepts its own update and reloads instead.
import.meta.hot?.accept(() => window.location.reload());
