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
  map: "/map",
  areas: "/areas",
  reports: "/reports",
  admin: "/admin",
  adminUsers: "/admin/users",
  adminAreas: "/admin/areas",
  adminRetrievals: "/admin/retrievals",
  adminSettings: "/admin/settings",
  adminActivity: "/admin/activity",
} as const;

/** Route patterns with parameters, for the router table. */
export const ROUTE_PATTERNS = {
  area: "/areas/:areaId",
  areaTimeSeries: "/areas/:areaId/timeseries",
  areaCompare: "/areas/:areaId/compare",
  report: "/reports/:reportId",
} as const;

const seg = (value: string): string => encodeURIComponent(value);

/** Links to parameterised routes. */
export const routeTo = {
  area: (areaId: string) => `${ROUTES.areas}/${seg(areaId)}`,
  areaTimeSeries: (areaId: string) => `${ROUTES.areas}/${seg(areaId)}/timeseries`,
  areaCompare: (areaId: string) => `${ROUTES.areas}/${seg(areaId)}/compare`,
  report: (reportId: string) => `${ROUTES.reports}/${seg(reportId)}`,
};

/** Routes reachable without a Session (Requirement 1.8). */
export const PUBLIC_ROUTES: readonly string[] = [
  ROUTES.landing,
  ROUTES.callback,
  ROUTES.signedOut,
  ROUTES.authError,
];

/** Router state read by the landing page: the requested path and the expired notice. */
/** Router state that asks `NoticeHost` to show a notice (Requirement 1.7). */
export interface NoticeState {
  notice: "ADMIN_REQUIRED";
}

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
