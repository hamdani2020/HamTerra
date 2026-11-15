import { cn } from "@/lib/utils";

export interface LegendItem {
  label: string;
  /** A colour from `styles/tokens.ts` or `lib/ndviRamp.ts`; never a one-off value. */
  color: string;
  shape?: "square" | "line" | "dashed" | "dot";
}

export interface LegendProps {
  title: string;
  items: readonly LegendItem[];
  className?: string;
}

function Swatch({ color, shape = "square" }: Pick<LegendItem, "color" | "shape">): JSX.Element {
  const base = "inline-block shrink-0";
  if (shape === "line" || shape === "dashed") {
    return <span aria-hidden="true" className={cn(base, "h-0 w-6 border-t-2", shape === "dashed" && "border-dashed")} style={{ borderColor: color }} />;
  }
  return <span aria-hidden="true" className={cn(base, "h-3 w-3", shape === "dot" ? "rounded-full" : "rounded-sm")} style={{ backgroundColor: color }} />;
}

/** A legend whose every entry has a text label; the swatch only reinforces it (21.5). */
export function Legend({ title, items, className }: LegendProps): JSX.Element {
  return (
    <div className={cn("text-sm", className)}>
      <p className="font-medium text-foreground">{title}</p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-ink-muted">
            <Swatch color={item.color} {...(item.shape ? { shape: item.shape } : {})} />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
