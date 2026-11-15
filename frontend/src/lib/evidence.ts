/**
 * Terms the Frontend must never author (Requirement 20.1). This list is the only place in
 * `src` that spells them; tests import it rather than repeating the words.
 */
export const FORBIDDEN_TERMS = [
  "illegal mining",
  "illegal",
  "deforestation",
  "destruction",
  "destroyed",
  "recovery",
  "recovered",
] as const;

export type ForbiddenTerm = (typeof FORBIDDEN_TERMS)[number];

/** The first forbidden term found in `text`, ignoring case, or null. */
export function containsForbiddenTerm(text: string): ForbiddenTerm | null {
  const lowered = text.toLowerCase();
  return FORBIDDEN_TERMS.find((term) => lowered.includes(term)) ?? null;
}
