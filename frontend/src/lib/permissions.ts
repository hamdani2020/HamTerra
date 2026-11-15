/**
 * Permission strings the Frontend checks, copied from the Backend contract (backend
 * `app/core/permissions.py`). These checks only decide what to offer; the Backend enforces
 * access (Requirement 4.8).
 */
export const PERMISSION = {
  refreshObservations: "observations:refresh",
} as const;

export function hasPermission(permissions: readonly string[], permission: string): boolean {
  return permissions.includes(permission);
}
