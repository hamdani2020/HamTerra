import type { ComponentType } from "react";
import { Outlet, type RouteObject } from "react-router";

import { AppShell } from "@/components/layout/AppShell";
import { RootLayout } from "@/components/layout/RootLayout";
import type { RouteHandle } from "@/components/layout/RouteAnnouncer";
import { RouteErrorBoundary } from "@/components/layout/RouteErrorBoundary";
import { RequirePrincipal, RequireRole, RequireSession } from "@/core/auth/guards";
import { SHELL_TEXT } from "@/lib/messages";
import { PAGE_TITLE } from "@/lib/pageTitles";
import { ROUTE_PATTERNS, ROUTES } from "@/lib/routes";
import AuthErrorPage from "@/pages/AuthErrorPage";
import CallbackPage from "@/pages/CallbackPage";
import LandingPage from "@/pages/LandingPage";
import NotFoundPage from "@/pages/NotFoundPage";
import SignedOutPage from "@/pages/SignedOutPage";

const handle = (title: string): RouteHandle => ({ title });

/** A lazy route module with a default export. */
const page = (load: () => Promise<{ default: ComponentType }>) => async () => ({
  Component: (await load()).default,
});

/** All admin pages come from one module, so they share one chunk (Requirement 24.4). */
type AdminModule = typeof import("@/pages/admin");
const admin = (pick: (m: AdminModule) => ComponentType) => async () => ({
  Component: pick(await import("@/pages/admin")),
});

function ProtectedLayout(): JSX.Element {
  return (
    <RequireSession>
      <RequirePrincipal>
        <AppShell />
      </RequirePrincipal>
    </RequireSession>
  );
}

function AdminGate(): JSX.Element {
  return (
    <RequireRole requires="admin">
      <Outlet />
    </RequireRole>
  );
}

function RouteLoading(): JSX.Element {
  return (
    <p role="status" aria-busy="true" className="p-6 text-ink-muted">
      {SHELL_TEXT.loadingAccount}
    </p>
  );
}

/** The route table of Requirement 1.1 (frontend design, Routing and Guards). */
export function appRoutes(): RouteObject[] {
  return [
    {
      element: <RootLayout />,
      errorElement: <RouteErrorBoundary />,
      hydrateFallbackElement: <RouteLoading />,
      children: [
        { path: ROUTES.landing, element: <LandingPage />, handle: handle(PAGE_TITLE.landing) },
        { path: ROUTES.callback, element: <CallbackPage />, handle: handle(PAGE_TITLE.callback) },
        { path: ROUTES.signedOut, element: <SignedOutPage />, handle: handle(PAGE_TITLE.signedOut) },
        { path: ROUTES.authError, element: <AuthErrorPage />, handle: handle(PAGE_TITLE.authError) },
        { path: ROUTES.about, lazy: page(() => import("@/pages/AboutPage")), handle: handle(PAGE_TITLE.about) },
        {
          element: <ProtectedLayout />,
          errorElement: <RouteErrorBoundary />,
          children: [
            { path: ROUTES.dashboard, lazy: page(() => import("@/pages/DashboardPage")), handle: handle(PAGE_TITLE.dashboard) },
            { path: ROUTES.map, lazy: page(() => import("@/pages/MapPage")), handle: handle(PAGE_TITLE.map) },
            { path: ROUTES.areas, lazy: page(() => import("@/pages/AreaListPage")), handle: handle(PAGE_TITLE.areas) },
            { path: ROUTE_PATTERNS.area, lazy: page(() => import("@/pages/AreaDetailPage")), handle: handle(PAGE_TITLE.area) },
            {
              path: ROUTE_PATTERNS.areaTimeSeries,
              lazy: page(() => import("@/pages/TimeSeriesPage")),
              handle: handle(PAGE_TITLE.timeSeries),
            },
            {
              path: ROUTE_PATTERNS.areaCompare,
              lazy: page(() => import("@/pages/ComparisonPage")),
              handle: handle(PAGE_TITLE.comparison),
            },
            { path: ROUTES.reports, lazy: page(() => import("@/pages/ReportListPage")), handle: handle(PAGE_TITLE.reports) },
            { path: ROUTE_PATTERNS.report, lazy: page(() => import("@/pages/ReportViewPage")), handle: handle(PAGE_TITLE.report) },
            {
              element: <AdminGate />,
              children: [
                { path: ROUTES.admin, lazy: admin((m) => m.AdminOverviewPage), handle: handle(PAGE_TITLE.admin) },
                { path: ROUTES.adminUsers, lazy: admin((m) => m.AdminUsersPage), handle: handle(PAGE_TITLE.adminUsers) },
                { path: ROUTES.adminAreas, lazy: admin((m) => m.AdminAreasPage), handle: handle(PAGE_TITLE.adminAreas) },
                {
                  path: ROUTES.adminRetrievals,
                  lazy: admin((m) => m.AdminRetrievalsPage),
                  handle: handle(PAGE_TITLE.adminRetrievals),
                },
                {
                  path: ROUTES.adminSettings,
                  lazy: admin((m) => m.AdminSettingsPage),
                  handle: handle(PAGE_TITLE.adminSettings),
                },
                {
                  path: ROUTES.adminActivity,
                  lazy: admin((m) => m.AdminActivityPage),
                  handle: handle(PAGE_TITLE.adminActivity),
                },
              ],
            },
          ],
        },
        { path: "*", element: <NotFoundPage />, handle: handle(PAGE_TITLE.notFound) },
      ],
    },
  ];
}
