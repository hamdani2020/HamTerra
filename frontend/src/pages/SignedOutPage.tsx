import { AuthCard } from "@/components/common/AuthCard";
import { SignInButton } from "@/features/auth/SignInButton";
import { AUTH_TEXT } from "@/lib/messages";

/** `/signed-out`: where Cognito returns the browser after sign-out (Requirement 3.10). */
export default function SignedOutPage(): JSX.Element {
  return (
    <AuthCard title={AUTH_TEXT.signedOutTitle}>
      <p>{AUTH_TEXT.signedOutBody}</p>
      <SignInButton label={AUTH_TEXT.signInAgain} />
    </AuthCard>
  );
}
