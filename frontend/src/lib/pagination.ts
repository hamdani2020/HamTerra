/**
 * Limit and offset clamping (Requirements 5.14, 5.15). The Backend maximum is 100 for the
 * admin user, retrieval and activity lists and 200 for every other list.
 */
const MAX_100 = ["/admin/users", "/admin/retrievals", "/admin/activity"];

export function maxLimitFor(path: string): number {
  return MAX_100.some((p) => path === p || path.startsWith(`${p}?`)) ? 100 : 200;
}

/** An integer from 1 to the endpoint maximum. Non-integers are floored, NaN becomes 1. */
export function clampLimit(path: string, limit: number): number {
  const max = maxLimitFor(path);
  if (!Number.isFinite(limit)) return Number.isNaN(limit) ? 1 : limit > 0 ? max : 1;
  return Math.min(max, Math.max(1, Math.floor(limit)));
}

/** An integer of 0 or more. */
export function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}

/** A page size typed by an admin: a whole number from 1 to 100 (Requirements 17.1, 18.1, 18.8), or null. */
export function parsePageSize(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= 100 ? value : null;
}
