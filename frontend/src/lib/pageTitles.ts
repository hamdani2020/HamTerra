/** Page names for headings and `document.title` (Requirement 1.11). */
export const APP_TITLE_SUFFIX = "Eco-Sentinel";

export const PAGE_TITLE = {
  landing: "Sign in",
  callback: "Completing sign-in",
  signedOut: "Signed out",
  authError: "Sign-in problem",
  dashboard: "Dashboard",
  map: "Map",
  areas: "Areas",
  area: "Area details",
  timeSeries: "NDVI time series",
  comparison: "Date comparison",
  reports: "Reports",
  report: "Report",
  admin: "Admin Overview",
  adminUsers: "Users",
  adminAreas: "Areas Management",
  adminRetrievals: "Retrievals",
  adminSettings: "Settings",
  adminActivity: "Activity",
  notFound: "Page not found",
} as const;

export function documentTitle(pageName: string | undefined): string {
  return pageName ? `${pageName} - ${APP_TITLE_SUFFIX}` : APP_TITLE_SUFFIX;
}
