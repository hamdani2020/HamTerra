import { cn } from "@/lib/utils";

export type KeyValueEntries = Record<string, unknown> | readonly (readonly [string, unknown])[];

/** `String(value)` for scalars and JSON for nested values; always rendered as text. */
export function displayValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export interface KeyValueListProps {
  entries: KeyValueEntries;
  label?: string;
  className?: string;
}

/** A read-only definition list, for example audit `details` (frontend design, Activity). */
export function KeyValueList({ entries, label, className }: KeyValueListProps): JSX.Element {
  const pairs = Array.isArray(entries) ? (entries as readonly (readonly [string, unknown])[]) : Object.entries(entries);
  return (
    <dl aria-label={label} className={cn("grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm", className)}>
      {pairs.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="font-medium text-ink-muted">{key}</dt>
          <dd className="text-foreground [overflow-wrap:anywhere]">{displayValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
