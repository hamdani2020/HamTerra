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
