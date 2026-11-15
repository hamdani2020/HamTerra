/**
 * The single module for Frontend-authored wording about evidence, status, warnings and
 * errors (Requirement 20.10, 20.11). Task 5 adds the warning and error code mappings and
 * `describeError`. Backend `summary_text`, `limitations`, `caveats` and warning messages
 * never pass through here; they are rendered unchanged by `VerbatimText`.
 */
import type { QualityLevel, FlagStatus } from "@/types/display";

export const EVIDENCE_TEXT = {
  aggregateNote: "NDVI values are polygon-level aggregates.",
  flagged: "Flagged for investigation",
  notFlagged: "Not flagged",
} as const;

export const QUALITY_LABEL: Record<QualityLevel, string> = {
  good: "Good",
  limited: "Limited",
  poor: "Poor",
};

export const FLAG_LABEL: Record<FlagStatus, string> = {
  flagged: EVIDENCE_TEXT.flagged,
  not_flagged: EVIDENCE_TEXT.notFlagged,
};
