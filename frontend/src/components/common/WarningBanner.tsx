import { AlertTriangle, Info } from "lucide-react";

import { VerbatimText } from "@/components/common/VerbatimText";
import { cn } from "@/lib/utils";

export interface WarningBannerProps {
  /** Display texts, already resolved through `warningText` in `lib/messages.ts`. */
  messages: string[];
  title?: string;
  tone?: "warning" | "info";
  className?: string;
}

/** Lists notices for a region. Renders nothing when there is nothing to show. */
export function WarningBanner({
  messages,
  title = "Notices",
  tone = "warning",
  className,
}: WarningBannerProps): JSX.Element | null {
  if (messages.length === 0) return null;
  const Icon = tone === "warning" ? AlertTriangle : Info;
  return (
    <section
      aria-label={title}
      className={cn(
        "rounded-md border p-3",
        tone === "warning"
          ? "border-status-warning bg-status-warning-bg text-status-warning"
          : "border-status-info bg-status-info-bg text-status-info",
        className,
      )}
    >
      <p className="flex items-center gap-2 font-medium">
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
        {title}
      </p>
      <ul className="mt-1 list-disc pl-6">
        {messages.map((message, index) => (
          <VerbatimText key={`${index}-${message}`} as="li" text={message} />
        ))}
      </ul>
    </section>
  );
}
