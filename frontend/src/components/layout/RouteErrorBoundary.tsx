import { useRouteError } from "react-router";

import { AuthCard } from "@/components/common/AuthCard";
import { Button } from "@/components/ui/button";
import { SHELL_TEXT } from "@/lib/messages";
import { safeLog } from "@/lib/safeLog";

/**
 * Route-level error boundary for rendering exceptions and failed chunk loads. Logs only
 * the error name, never tokens or response bodies (frontend design, Error Handling).
 */
export function RouteErrorBoundary(): JSX.Element {
  const error = useRouteError();
  safeLog("error", "route render failed", { name: error instanceof Error ? error.name : typeof error });
  return (
    <AuthCard title={SHELL_TEXT.crashTitle}>
      <p role="alert">{SHELL_TEXT.crashBody}</p>
      <Button type="button" onClick={() => window.location.reload()}>
        {SHELL_TEXT.reload}
      </Button>
    </AuthCard>
  );
}

