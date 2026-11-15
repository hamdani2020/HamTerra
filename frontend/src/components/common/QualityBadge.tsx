import { AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";

import { StatusBadge } from "@/components/common/StatusBadge";
import { QUALITY_LABEL } from "@/lib/messages";
import type { QualityLevel } from "@/types/display";

const VARIANT = {
  good: { tone: "success", icon: CheckCircle2 },
  limited: { tone: "warning", icon: MinusCircle },
  poor: { tone: "error", icon: AlertTriangle },
} as const;

/** Quality level as computed by the Backend. It is displayed, never recomputed. */
export function QualityBadge({ level }: { level: QualityLevel }): JSX.Element {
  const { tone, icon } = VARIANT[level];
  return <StatusBadge tone={tone} icon={icon} label={QUALITY_LABEL[level]} />;
}
