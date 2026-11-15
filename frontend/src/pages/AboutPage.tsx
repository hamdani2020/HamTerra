import { useAuthState } from "@/core/auth/AuthProvider";
import { PitchLayout } from "@/features/pitch/PitchLayout";

/** `/about`: the project page for everyone, including signed-in users (no redirect). */
export default function AboutPage(): JSX.Element {
  const { status } = useAuthState();
  const access = status === "signed_in" ? { kind: "signed_in" as const } : status === "renewing" ? { kind: "restoring" as const } : { kind: "sign_in" as const };
  return <PitchLayout access={access} />;
}
