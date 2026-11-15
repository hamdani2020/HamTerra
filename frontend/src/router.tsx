import type { RouteObject } from "react-router";

import { AuthCard } from "@/components/common/AuthCard";
import { ROUTES } from "@/lib/routes";
import AuthErrorPage from "@/pages/AuthErrorPage";
import CallbackPage from "@/pages/CallbackPage";
import LandingPage from "@/pages/LandingPage";
import SignedOutPage from "@/pages/SignedOutPage";

/** Shown for every other path until task 8 registers the protected routes and guards. */
function PendingPage(): JSX.Element {
  return (
    <AuthCard title="Eco-Sentinel Ghana">
      <p>This page is not available yet.</p>
    </AuthCard>
  );
}

/**
 * The route table (frontend design, Routing and Guards). The four public auth pages are
 * eager; protected pages are added as lazy modules in task 8.
 */
export function appRoutes(): RouteObject[] {
  return [
    { path: ROUTES.landing, element: <LandingPage /> },
    { path: ROUTES.callback, element: <CallbackPage /> },
    { path: ROUTES.signedOut, element: <SignedOutPage /> },
    { path: ROUTES.authError, element: <AuthErrorPage /> },
    { path: "*", element: <PendingPage /> },
  ];
}
