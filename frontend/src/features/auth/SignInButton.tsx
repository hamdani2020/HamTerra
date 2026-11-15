import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/core/auth/AuthProvider";
import { AUTH_TEXT } from "@/lib/messages";
import { safeLog } from "@/lib/safeLog";

export interface SignInButtonProps {
  label?: string;
  /** In-app path to open after sign-in; unsafe values fall back to the dashboard. */
  returnTo?: string | undefined;
  disabled?: boolean;
}

/** Starts the PKCE redirect (Requirement 3.1). Disabled while the redirect is pending. */
export function SignInButton({ label = AUTH_TEXT.signIn, returnTo, disabled = false }: SignInButtonProps): JSX.Element {
  const auth = useAuth();
  const [phase, setPhase] = useState<"idle" | "redirecting" | "failed">("idle");

  async function start(): Promise<void> {
    setPhase("redirecting");
    try {
      await auth.signIn(returnTo);
    } catch (error) {
      safeLog("error", "sign-in could not start", error);
      setPhase("failed");
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" className="w-full" disabled={disabled || phase === "redirecting"} onClick={() => void start()}>
        {phase === "redirecting" ? AUTH_TEXT.redirecting : label}
      </Button>
      {phase === "failed" && (
        <p role="alert" className="text-sm text-status-error">
          {AUTH_TEXT.signInStartFailed}
        </p>
      )}
    </div>
  );
}
