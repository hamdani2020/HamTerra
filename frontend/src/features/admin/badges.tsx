import { CheckCircle2, CircleDashed, CircleSlash, Loader, MinusCircle, XCircle } from "lucide-react";

import { StatusBadge } from "@/components/common/StatusBadge";
import { OUTCOME_LABEL, RETRIEVAL_STATUS_LABEL } from "@/lib/messages";
import type { AuditOutcome, RetrievalStatus } from "@/types/api";
import type { StatusTone } from "@/types/display";

const RETRIEVAL: Record<RetrievalStatus, { tone: StatusTone; icon: typeof CheckCircle2 }> = {
  running: { tone: "info", icon: Loader },
  success: { tone: "success", icon: CheckCircle2 },
  partial: { tone: "warning", icon: MinusCircle },
  empty: { tone: "neutral", icon: CircleDashed },
  failed: { tone: "error", icon: XCircle },
};

/** Text label plus colour and icon (Requirements 18.4, 21.5). */
export function RetrievalStatusBadge({ status }: { status: RetrievalStatus }): JSX.Element {
  const variant = RETRIEVAL[status] ?? { tone: "neutral" as const, icon: CircleDashed };
  return <StatusBadge tone={variant.tone} icon={variant.icon} label={RETRIEVAL_STATUS_LABEL[status] ?? status} />;
}

const OUTCOME: Record<AuditOutcome, { tone: StatusTone; icon: typeof CheckCircle2 }> = {
  success: { tone: "success", icon: CheckCircle2 },
  failure: { tone: "error", icon: XCircle },
  denied: { tone: "warning", icon: CircleSlash },
};

export function OutcomeBadge({ outcome }: { outcome: AuditOutcome }): JSX.Element {
  const variant = OUTCOME[outcome] ?? { tone: "neutral" as const, icon: CircleDashed };
  return <StatusBadge tone={variant.tone} icon={variant.icon} label={OUTCOME_LABEL[outcome] ?? outcome} />;
}
