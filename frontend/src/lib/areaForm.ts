/**
 * Area form rules and the edit diff (Requirements 14.2, 14.11). Pure.
 */
import { stableStringify } from "@/lib/stableJson";
import { ADMIN_AREA_TEXT } from "@/lib/messages";
import type { AreaUpdateRequest, GeoJsonGeometry } from "@/types/api";

export const NAME_MAX = 100;
export const DESCRIPTION_MAX = 1000;

export interface AreaValues {
  name: string;
  description: string | null;
  geometry: GeoJsonGeometry | null;
}

export type AreaFieldErrors = Partial<Record<"name" | "description" | "geometry", string>>;

/** Name 1 to 100 characters after trimming; description at most 1000. */
export function validateAreaFields(name: string, description: string): AreaFieldErrors {
  const errors: AreaFieldErrors = {};
  const trimmed = name.trim();
  if (trimmed.length === 0) errors.name = ADMIN_AREA_TEXT.nameRequired;
  else if (trimmed.length > NAME_MAX) errors.name = ADMIN_AREA_TEXT.nameTooLong;
  if (description.length > DESCRIPTION_MAX) errors.description = ADMIN_AREA_TEXT.descriptionTooLong;
  return errors;
}

/** An empty description and a missing one are the same value. */
const normaliseDescription = (value: string | null): string | null => (value === null || value.trim() === "" ? null : value);

/**
 * Exactly the changed fields among name, description and geometry; an empty object when
 * nothing changed, which keeps the submit control disabled (Property 24).
 */
export function diffAreaForm(original: AreaValues, current: AreaValues): AreaUpdateRequest {
  const changes: AreaUpdateRequest = {};
  if (current.name.trim() !== original.name.trim()) changes.name = current.name.trim();
  const before = normaliseDescription(original.description);
  const after = normaliseDescription(current.description);
  if (after !== before) changes.description = after;
  if (current.geometry && stableStringify(current.geometry) !== stableStringify(original.geometry)) changes.geometry = current.geometry;
  return changes;
}
