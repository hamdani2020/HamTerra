import { type ReactNode, useId } from "react";

import { cn } from "@/lib/utils";

export interface ChartContainerProps {
  title: string;
  description?: string;
  /** A legend or notes shown under the chart. */
  footer?: ReactNode;
  /** Tailwind height class for the plot area; charts need a fixed height. */
  heightClass?: string;
  /** Heading level of the title, to fit the page outline. */
  titleAs?: "h2" | "h3";
  className?: string;
  children: ReactNode;
}

/** A titled figure that gives a chart a fixed-height plot area and a caption. */
export function ChartContainer({ title, description, footer, heightClass = "h-72", titleAs: Title = "h3", className, children }: ChartContainerProps): JSX.Element {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <figure
      aria-labelledby={titleId}
      {...(description ? { "aria-describedby": descriptionId } : {})}
      className={cn("space-y-3 rounded-lg border bg-card p-4 shadow", className)}
    >
      <figcaption>
        <Title id={titleId} className="font-semibold text-foreground">
          {title}
        </Title>
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
