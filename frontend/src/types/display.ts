/**
 * Enumerations used by display components. They are the same literal types as the
 * Backend contract; `src/types/api.ts` (task 6) re-exports them so there is one definition.
 */
export type QualityLevel = "good" | "limited" | "poor";
export type FlagStatus = "flagged" | "not_flagged";
export type StatusTone = "success" | "warning" | "error" | "info" | "neutral";
