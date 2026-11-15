import { Outlet } from "react-router";

import { RouteAnnouncer } from "./RouteAnnouncer";
import { SkipLink } from "./SkipLink";

/** Wraps every route: the skip link comes first, then the page (Requirements 1.11, 1.12). */
export function RootLayout(): JSX.Element {
  return (
    <>
      <SkipLink />
      <RouteAnnouncer />
      <Outlet />
    </>
  );
}
