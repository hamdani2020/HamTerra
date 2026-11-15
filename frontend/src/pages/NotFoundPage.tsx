import { Link } from "react-router";

import { AuthCard } from "@/components/common/AuthCard";
import { useAuthState } from "@/core/auth/AuthProvider";
import { SHELL_TEXT } from "@/lib/messages";
import { ROUTES } from "@/lib/routes";

/** Unknown path: a link to the dashboard, or to `/` without a Session (Requirement 1.10). */
export default function NotFoundPage(): JSX.Element {
  const { status } = useAuthState();
  const signedIn = status !== "signed_out";
  return (
    <AuthCard title={SHELL_TEXT.notFoundTitle}>
      <p>{SHELL_TEXT.notFoundBody}</p>
      <Link
        to={signedIn ? ROUTES.dashboard : ROUTES.landing}
        className="inline-block rounded-md font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {signedIn ? SHELL_TEXT.toDashboard : SHELL_TEXT.toSignIn}
      </Link>
    </AuthCard>
  );
}
