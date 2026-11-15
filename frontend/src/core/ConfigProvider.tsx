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
