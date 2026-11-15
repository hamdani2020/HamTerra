import type { MouseEvent } from "react";

import { SHELL_TEXT } from "@/lib/messages";

export const MAIN_CONTENT_ID = "main-content";

/**
 * The first focusable element; visible when focused (Requirement 1.12). Focus is moved by
 * hand so the URL gains no hash and the router sees no navigation.
 */
export function SkipLink(): JSX.Element {
  function onClick(event: MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    document.getElementById(MAIN_CONTENT_ID)?.focus();
  }
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      onClick={onClick}
      className="sr-only rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
    >
      {SHELL_TEXT.skipLink}
    </a>
  );
}
