/**
 * Build-time check of the public configuration (Requirement 22.6). Runs in `vite.config.ts`
 * for every mode except `test`, so a missing variable stops the dev server or the build
 * with a message that lists the names and never the values. The runtime check in
 * `src/core/config.ts` (task 3) is the second line of defence.
 */
export const REQUIRED_VITE_VARS = [
  "VITE_API_BASE_URL",
  "VITE_COGNITO_DOMAIN",
  "VITE_COGNITO_CLIENT_ID",
  "VITE_COGNITO_REGION",
  "VITE_REDIRECT_URI",
  "VITE_LOGOUT_URI",
] as const;

export function missingRequiredEnv(env: Record<string, string | undefined>): string[] {
  return REQUIRED_VITE_VARS.filter((name) => (env[name] ?? "").trim() === "");
}

export function assertRequiredEnv(env: Record<string, string | undefined>): void {
  const missing = missingRequiredEnv(env);
  if (missing.length > 0) {
    throw new Error(
      `Missing or empty frontend configuration: ${missing.join(", ")}. ` +
        "Set them in the root .env (see .env.example).",
    );
  }
}
