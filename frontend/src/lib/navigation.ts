/**
 * Navigation items derived from the Principal's roles (Requirements 1.4 to 1.6). Pure, so
 * Property 6 can test it. Role checks in the browser are a usability aid only (4.8).
 */
import { ROUTES } from "@/lib/routes";

export interface NavItem {
  label: string;
  to: string;
  group: "researcher" | "admin";
  /** Active only on an exact match (the admin overview, which prefixes the other admin items). */
  end?: boolean;
}

export const RESEARCHER_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", to: ROUTES.dashboard, group: "researcher" },
  { label: "Map", to: ROUTES.map, group: "researcher" },
  { label: "Areas", to: ROUTES.areas, group: "researcher" },
  { label: "Reports", to: ROUTES.reports, group: "researcher" },
];

export const ADMIN_ITEMS: readonly NavItem[] = [
  { label: "Admin Overview", to: ROUTES.admin, group: "admin", end: true },
  { label: "Users", to: ROUTES.adminUsers, group: "admin" },
  { label: "Areas Management", to: ROUTES.adminAreas, group: "admin" },
  { label: "Retrievals", to: ROUTES.adminRetrievals, group: "admin" },
  { label: "Settings", to: ROUTES.adminSettings, group: "admin" },
  { label: "Activity", to: ROUTES.adminActivity, group: "admin" },
];

/** Admin implies researcher permissions (security steering). */
export function hasKnownRole(roles: readonly string[]): boolean {
  return roles.includes("admin") || roles.includes("researcher");
}

export function isAdmin(roles: readonly string[]): boolean {
  return roles.includes("admin");
}

export function navItems(roles: readonly string[]): NavItem[] {
  if (!hasKnownRole(roles)) return [];
  return isAdmin(roles) ? [...RESEARCHER_ITEMS, ...ADMIN_ITEMS] : [...RESEARCHER_ITEMS];
}

/** The email shown in the header: the Principal's, else the ID-token claim, else none (4.6, 4.7). */
export function displayEmail(principalEmail: string | null, idEmail: string | null): string | null {
  for (const value of [principalEmail, idEmail]) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}
