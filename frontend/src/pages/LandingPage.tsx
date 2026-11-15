import { Navigate, useLocation } from "react-router";

import { safeReturnTo } from "@/core/auth/authModule";
import { useAuthState } from "@/core/auth/AuthProvider";
import { ExpiredNotice, PitchLayout } from "@/features/pitch/PitchLayout";
import { readState } from "@/lib/routes";

/**
 * `/`: the public project page with the sign-in control and, after an ended Session, the
 * expired notice (3.8). A signed-in user goes on to the saved path or the dashboard.
 */
export default function LandingPage(): JSX.Element {
  const { status } = useAuthState();
  const location = useLocation();
  const from = readState(location.state, "from");
  const expired = readState(location.state, "notice") === "session_expired";

  if (status === "signed_in") return <Navigate to={safeReturnTo(from)} replace />;

  return (
    <PitchLayout
      access={status === "renewing" ? { kind: "restoring" } : { kind: "sign_in", returnTo: from }}
      notice={expired ? <ExpiredNotice /> : undefined}
    />
  );
}
