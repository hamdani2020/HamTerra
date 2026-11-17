import { createContext, type ReactNode, useContext } from "react";

export interface DemoValue {
  active: boolean;
  /** Enters the demo and reloads the dashboard. */
  start: () => void;
  /** Leaves the demo and reloads the landing page. */
  exit: () => void;
}

const DemoContext = createContext<DemoValue>({ active: false, start: () => undefined, exit: () => undefined });

export function DemoProvider({ value, children }: { value: DemoValue; children: ReactNode }): JSX.Element {
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoValue {
  return useContext(DemoContext);
}

// Hot updates would re-create the context while mounted components keep the old one.
import.meta.hot?.accept(() => window.location.reload());
