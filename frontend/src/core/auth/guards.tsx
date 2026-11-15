import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { Button } from "@/components/ui/button";
import { useAuthState } from "@/core/auth/AuthProvider";
import { PrincipalProvider, useCurrentPrincipal, usePrincipal } from "@/core/auth/principal";
import { describeError, SHELL_TEXT } from "@/lib/messages";
import { hasKnownRole } from "@/lib/navigation";
import { ROUTES, type LandingState, type NoticeState } from "@/lib/routes";
import NoRolePage from "@/pages/NoRolePage";

/** A full-page status card used while the Session or the Principal is not ready. */
function GateStatus({ children, busy = false }: { children: ReactNode; busy?: boolean }): JSX.Element {
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-background p-4">
      <section aria-busy={busy} className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6 text-foreground shadow">
        {children}
      </section>
    </main>
  );
}

/**
 * No Session: save the requested path and go to `/` (Requirements 1.8, 4.3). While a
 * stored refresh token is being renewed, wait instead of redirecting.
 */
export function RequireSession({ children }: { children: ReactNode }): JSX.Element {
  const { status, endReason } = useAuthState();
  const location = useLocation();
  if (status === "renewing") {
    return (
      <GateStatus busy>
        <p role="status">{SHELL_TEXT.loadingAccount}</p>
      </GateStatus>
    );
  }
  if (status === "signed_out") {
    // The expired notice is added here as well as by the Auth_Module's handler, so the
    // result does not depend on which navigation runs last (Requirement 3.8).
    const state: LandingState = { from: `${location.pathname}${location.search}` };
    if (endReason === "expired") state.notice = "session_expired";
    return <Navigate to={ROUTES.landing} replace state={state} />;
  }
  return <>{children}</>;
}

/**
 * Loads `GET /me` before any protected content (Requirements 4.1 to 4.5, 3.13). A 401 is
 * renewed and replayed by the API client; when that fails the Session ends and the
 * Auth_Module's handler routes to `/` with the expired notice.
 */
export function RequirePrincipal({ children }: { children: ReactNode }): JSX.Element {
  const query = usePrincipal();

  if (query.data) {
    if (!hasKnownRole(query.data.roles)) return <NoRolePage principal={query.data} />;
    return <PrincipalProvider principal={query.data}>{children}</PrincipalProvider>;
  }
  if (query.isError) {
    const display = describeError(query.error);
    return (
      <GateStatus>
        <h1 tabIndex={-1} className="text-xl font-semibold">
          {SHELL_TEXT.accountErrorTitle}
        </h1>
        <div role="alert" className="space-y-1 text-ink-muted">
          <p className="font-medium text-foreground">{display.title}</p>
          <p>{display.body}</p>
          {display.requestId && (
            <p className="text-sm">
              {SHELL_TEXT.requestId}: <code>{display.requestId}</code>
            </p>
          )}
        </div>
        {display.retry && (
          <Button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>
            {SHELL_TEXT.retry}
          </Button>
        )}
      </GateStatus>
    );
  }
  return (
    <GateStatus busy>
      <p role="status">{SHELL_TEXT.loadingAccount}</p>
    </GateStatus>
  );
}

/** A usability aid only; the Backend enforces roles (Requirements 1.7, 4.8). */
export function RequireRole({ requires, children }: { requires: "admin"; children: ReactNode }): JSX.Element {
  const { roles } = useCurrentPrincipal();
  if (!roles.includes(requires)) {
    const state: NoticeState = { notice: "ADMIN_REQUIRED" };
    return <Navigate to={ROUTES.dashboard} replace state={state} />;
  }
  return <>{children}</>;
}
