import { Circle, Flag } from "lucide-react";

import { StatusBadge } from "@/components/common/StatusBadge";
import { FLAG_LABEL } from "@/lib/messages";
import type { FlagStatus } from "@/types/display";

/**
 * Flag status from the Backend. "Flagged for investigation" marks a numeric difference at
 * or above the threshold; it is not a finding (Requirement 20.2).
 */
export function FlagBadge({ flag }: { flag: FlagStatus }): JSX.Element {
  return flag === "flagged" ? (
    <StatusBadge tone="info" icon={Flag} label={FLAG_LABEL.flagged} />
  ) : (
    <StatusBadge tone="neutral" icon={Circle} label={FLAG_LABEL.not_flagged} />
  );
}
