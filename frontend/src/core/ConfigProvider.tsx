import { createContext, type ReactNode, useContext } from "react";

import type { PublicConfig } from "@/core/config";

const ConfigContext = createContext<PublicConfig | null>(null);

/** The validated public configuration (Requirement 2). Contains no secrets. */
export function ConfigProvider({ config, children }: { config: PublicConfig; children: ReactNode }): JSX.Element {
  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

export function useConfig(): PublicConfig {
  const config = useContext(ConfigContext);
  if (!config) throw new Error("useConfig must be used inside ConfigProvider");
  return config;
}

// Hot updates would re-create the configuration context while mounted components keep the old one,
// so a change to this module (or anything it imports) reloads the page in development.
// Vite 7 has no `decline`: the module accepts its own update and reloads instead.
import.meta.hot?.accept(() => window.location.reload());
