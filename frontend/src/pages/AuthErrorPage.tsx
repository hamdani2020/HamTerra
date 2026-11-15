import { Link, useLocation } from "react-router";

import { AuthCard } from "@/components/common/AuthCard";
import { AUTH_FAILURE_TEXT, AUTH_TEXT } from "@/lib/messages";
import { readState, ROUTES } from "@/lib/routes";

function failureText(error: string | undefined): { title: string; body: string } {
  if (error && Object.prototype.hasOwnProperty.call(AUTH_FAILURE_TEXT, error)) {
    return AUTH_FAILURE_TEXT[error as keyof typeof AUTH_FAILURE_TEXT];
  }
  return { title: AUTH_TEXT.authErrorFallbackTitle, body: AUTH_TEXT.authErrorFallbackBody };
}

/**
 * `/auth/error`: names the failure class only (Requirements 3.3, 3.4). The class comes from
 * router state; nothing from the callback URL is shown.
 */
export default function AuthErrorPage(): JSX.Element {
  const location = useLocation();
  const { title, body } = failureText(readState(location.state, "error"));
  return (
    <AuthCard title={title}>
      <p role="alert">{body}</p>
      <Link
        to={ROUTES.landing}
        className="inline-block rounded-md font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {AUTH_TEXT.backToSignIn}
      </Link>
    </AuthCard>
  );
}
