import { useEffect, useRef } from "react";
import { useLocation, useMatches } from "react-router";

import { documentTitle } from "@/lib/pageTitles";

import { MAIN_CONTENT_ID } from "./SkipLink";

export const FOCUS_DEADLINE_MS = 500;
const POLL_MS = 50;

export interface RouteHandle {
  title?: string;
}

function routeTitle(matches: ReturnType<typeof useMatches>): string | undefined {
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const handle = matches[i]?.handle as RouteHandle | undefined;
    if (handle?.title) return handle.title;
  }
  return undefined;
}

/**
 * On every route change: set `document.title` to "<Page name> - Eco-Sentinel" and move
 * focus to the content heading within 500 ms (Requirement 1.11). The first page load keeps
 * the browser's default focus.
 */
export function RouteAnnouncer(): null {
  const location = useLocation();
  const title = routeTitle(useMatches());
  // Compared with the previous path rather than a first-render flag, so strict mode's second
  // effect run on mount does not count as a route change.
  const lastPath = useRef(location.pathname);

  useEffect(() => {
    document.title = documentTitle(title);
  }, [title]);

  useEffect(() => {
    if (lastPath.current === location.pathname) return undefined;
    lastPath.current = location.pathname;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryFocus = (): void => {
      const heading = document.querySelector<HTMLElement>(`#${MAIN_CONTENT_ID} h1`);
      if (heading) {
        if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
        heading.focus();
        return;
      }
      if (Date.now() - started + POLL_MS <= FOCUS_DEADLINE_MS) timer = setTimeout(tryFocus, POLL_MS);
    };
    timer = setTimeout(tryFocus, 0);
    return () => clearTimeout(timer);
  }, [location.pathname]);

  return null;
}
