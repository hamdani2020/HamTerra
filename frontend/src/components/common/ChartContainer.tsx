import { type ReactNode, useId } from "react";

import { cn } from "@/lib/utils";

export interface ChartContainerProps {
  title: string;
  description?: string;
  /** A legend or notes shown under the chart. */
  footer?: ReactNode;
  /** Tailwind height class for the plot area; charts need a fixed height. */
  heightClass?: string;
  className?: string;
  children: ReactNode;
}

/** A titled figure that gives a chart a fixed-height plot area and a caption. */
export function ChartContainer({ title, description, footer, heightClass = "h-72", className, children }: ChartContainerProps): JSX.Element {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <figure
      aria-labelledby={titleId}
      {...(description ? { "aria-describedby": descriptionId } : {})}
      className={cn("space-y-3 rounded-lg border bg-card p-4 shadow", className)}
    >
      <figcaption>
        <h3 id={titleId} className="font-semibold text-foreground">
          {title}
        </h3>
        {description && (
          <p id={descriptionId} className="text-sm text-ink-muted">
            {description}
          </p>
        )}
      </figcaption>
      <div className={cn("w-full min-w-0", heightClass)}>{children}</div>
      {footer}
    </figure>
  );
}
