import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

import { AuthCard } from "@/components/common/AuthCard";
import { useAuth } from "@/core/auth/AuthProvider";
import { AUTH_TEXT } from "@/lib/messages";
import { ROUTES, type AuthErrorState } from "@/lib/routes";

/**
 * `/auth/callback`: runs the code exchange once per page load. The ref keeps strict mode's
 * second effect run from starting another exchange, and `handleCallback` is idempotent per
 * URL as a second safeguard. Navigation replaces the entry, so the code leaves the history.
 */
export default function CallbackPage(): JSX.Element {
  const auth = useAuth();
  const navigate = useNavigate();
  const { search } = useLocation();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void auth.handleCallback(search).then((result) => {
      if (result.ok) {
        void navigate(result.returnTo, { replace: true });
      } else {
        const state: AuthErrorState = { error: result.error };
        void navigate(ROUTES.authError, { replace: true, state });
      }
    });
  }, [auth, navigate, search]);

  return (
    <AuthCard title={AUTH_TEXT.callbackTitle}>
      <p role="status" aria-busy="true">
        {AUTH_TEXT.callbackBody}
      </p>
    </AuthCard>
  );
}
