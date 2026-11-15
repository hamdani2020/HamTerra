import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

/**
 * True while the page is being printed. Charts measure their container on screen, and the
 * browser lays out the print copy without telling them, so they redraw at a print width.
 * `flushSync` makes the change render before the print layout is taken.
 */
export function usePrintMode(): boolean {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const set = (value: boolean) => () => flushSync(() => setPrinting(value));
    const before = set(true);
    const after = set(false);
    const query = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;
    const onChange = (event: MediaQueryListEvent) => flushSync(() => setPrinting(event.matches));
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    query?.addEventListener("change", onChange);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      query?.removeEventListener("change", onChange);
    };
  }, []);
  return printing;
}
