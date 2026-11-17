import { lazy, Suspense } from "react";
import { Outlet } from "react-router";

import { useCurrentPrincipal } from "@/core/auth/principal";
import { useDemo } from "@/core/demo/DemoContext";
import { AUTH_TEXT } from "@/lib/messages";
import { navItems } from "@/lib/navigation";

import { Header } from "./Header";
import { NoticeHost } from "./NoticeHost";
import { SidebarNav } from "./Sidebar";
import { MAIN_CONTENT_ID } from "./SkipLink";

// Loaded only in the demo, together with the demo data.
const DemoBanner = lazy(() => import("@/features/demo/DemoBanner"));

/**
 * The signed-in layout: persistent sidebar from 640 px, drawer below (Requirements 1.2,
 * 1.3), header, notices and the content area.
 */
export function AppShell(): JSX.Element {
  const { roles } = useCurrentPrincipal();
  const items = navItems(roles);
  const demo = useDemo();
  return (
    <div className="min-h-screen bg-background text-foreground sm:grid sm:grid-cols-[15rem_minmax(0,1fr)]" data-print="shell">
      <aside className="hidden border-r bg-card p-4 sm:block">
        <p className="mb-6 px-3 text-lg font-semibold text-foreground">{AUTH_TEXT.appName}</p>
        <SidebarNav items={items} />
      </aside>
      <div className="flex min-w-0 flex-col">
        {demo.active && (
          <Suspense fallback={null}>
            <DemoBanner />
          </Suspense>
        )}
        <Header items={items} />
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="min-w-0 flex-1 p-4 focus:outline-none sm:p-6">
          <NoticeHost />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
