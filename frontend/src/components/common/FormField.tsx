import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface FieldControlProps {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
}

export interface FormFieldProps {
  id: string;
  label: string;
  /** Validation or Backend field error for this field. */
  error?: string | undefined;
  hint?: string | undefined;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Label, control and messages for one field. The control is linked to the hint and the
 * error with `aria-describedby` and marked `aria-invalid` when there is an error.
 */
export function FormField({ id, label, error, hint, className, children }: FormFieldProps): JSX.Element {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {hint && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm font-medium text-status-error">
          {error}
        </p>
      )}
    </div>
  );
}
