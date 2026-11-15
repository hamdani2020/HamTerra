import { AuthCard } from "@/components/common/AuthCard";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/core/auth/AuthProvider";
import { SHELL_TEXT } from "@/lib/messages";
import type { PrincipalMe } from "@/types/api";

/** A signed-in user with no role: explanation and sign-out only (Requirement 3.13). */
export default function NoRolePage({ principal }: { principal: PrincipalMe }): JSX.Element {
  const auth = useAuth();
  return (
    <AuthCard title={SHELL_TEXT.noRoleTitle}>
      <p>
        {SHELL_TEXT.signedInAs} <span className="font-medium text-foreground">{principal.username}</span>
      </p>
      <p>{SHELL_TEXT.noRoleBody}</p>
      <Button type="button" className="w-full" onClick={() => auth.signOut()}>
        {SHELL_TEXT.signOut}
      </Button>
    </AuthCard>
  );
}
