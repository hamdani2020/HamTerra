import { Navigate, useLocation } from "react-router";

import { AuthCard } from "@/components/common/AuthCard";
import { WarningBanner } from "@/components/common/WarningBanner";
import { safeReturnTo } from "@/core/auth/authModule";
import { useAuthState } from "@/core/auth/AuthProvider";
import { SignInButton } from "@/features/auth/SignInButton";
import { AUTH_TEXT } from "@/lib/messages";
import { readState } from "@/lib/routes";

/** `/`: the sign-in control and, after an ended Session, the expired notice (3.8). */
export default function LandingPage(): JSX.Element {
  const { status } = useAuthState();
  const location = useLocation();
  const from = readState(location.state, "from");
  const expired = readState(location.state, "notice") === "session_expired";

  if (status === "signed_in") return <Navigate to={safeReturnTo(from)} replace />;

  return (
    <AuthCard title={AUTH_TEXT.appName}>
      {expired && <WarningBanner title={AUTH_TEXT.sessionEndedTitle} messages={[AUTH_TEXT.sessionExpired]} />}
      <p>{AUTH_TEXT.landingIntro}</p>
      {status === "renewing" ? (
        <p role="status" aria-busy="true">
          {AUTH_TEXT.restoring}
        </p>
      ) : (
        <SignInButton returnTo={from} />
      )}
    </AuthCard>
  );
}
