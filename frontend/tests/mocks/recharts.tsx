/**
 * jsdom has no layout, so Recharts' ResponsiveContainer measures 0 x 0 and draws nothing.
 * Tests install `vi.mock("recharts", rechartsWithFixedSize)` to give charts a fixed size.
 */
import { cloneElement, isValidElement, type ReactNode } from "react";

export async function rechartsWithFixedSize(importOriginal: () => Promise<typeof import("recharts")>) {
  const actual = await importOriginal();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <div style={{ width: 800, height: 300 }}>
        {isValidElement<{ width?: number; height?: number }>(children) ? cloneElement(children, { width: 800, height: 300 }) : children}
      </div>
    ),
  };
}
