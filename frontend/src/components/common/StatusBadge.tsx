import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { StatusTone } from "@/types/display";

const TONE_CLASS: Record<StatusTone, string> = {
  success: "bg-status-success-bg text-status-success",
  warning: "bg-status-warning-bg text-status-warning",
  error: "bg-status-error-bg text-status-error",
  info: "bg-status-info-bg text-status-info",
  neutral: "bg-muted text-muted-foreground",
};

export interface StatusBadgeProps {
  tone: StatusTone;
  label: string;
  icon?: LucideIcon;
  className?: string;
}

/**
 * A status pill. The text label is always shown; colour and icon only reinforce it
 * (Requirement 21.5). Status colours are used only here and in other status components.
 */
export function StatusBadge({ tone, label, icon: Icon, className }: StatusBadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      {Icon && <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />}
      <span>{label}</span>
    </span>
  );
}
