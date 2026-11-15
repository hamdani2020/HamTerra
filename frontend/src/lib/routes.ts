/**
 * In-app route paths (Requirement 1.1). This is the only module that writes them, so the
 * static path scan can tell route paths from Backend API paths.
 */
export const ROUTES = {
  landing: "/",
  callback: "/auth/callback",
  signedOut: "/signed-out",
  authError: "/auth/error",
  dashboard: "/dashboard",
} as const;

/** Routes reachable without a Session (Requirement 1.8). */
export const PUBLIC_ROUTES: readonly string[] = [
  ROUTES.landing,
  ROUTES.callback,
  ROUTES.signedOut,
  ROUTES.authError,
];

/** Router state read by the landing page: the requested path and the expired notice. */
export interface LandingState {
  from?: string;
  notice?: "session_expired";
}

/** Router state read by the auth error page. */
export interface AuthErrorState {
  error: string;
}

/** Read router state written by this app without trusting its shape. */
export function readState<K extends string>(state: unknown, key: K): string | undefined {
  if (typeof state !== "object" || state === null) return undefined;
  const value = (state as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
