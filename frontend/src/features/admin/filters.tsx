import { FormField } from "@/components/common/FormField";
import { Input } from "@/components/ui/input";
import { ADMIN_TEXT } from "@/lib/messages";

export const selectClass =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";

export const noticeClass = "rounded-md border border-status-success bg-status-success-bg p-3 text-sm text-status-success";
export const alertClass = "rounded-md border border-status-error bg-status-error-bg p-3 text-sm text-status-error";

/** Rows per page, 1 to 100 (Requirements 17.1, 18.1, 18.8). */
export function PageSizeField({ id, value, error, onChange }: { id: string; value: string; error: string | undefined; onChange: (v: string) => void }): JSX.Element {
  return (
    <FormField id={id} label={ADMIN_TEXT.pageSize} error={error}>
      {(control) => <Input {...control} type="number" inputMode="numeric" min={1} max={100} step={1} value={value} onChange={(e) => onChange(e.target.value)} />}
    </FormField>
  );
}

/** Optional `from` and `to` date filters with their field errors. */
export function DateFilters({
  idPrefix,
  from,
  to,
  errors,
  onFrom,
  onTo,
}: {
  idPrefix: string;
  from: string;
  to: string;
  errors: { date_from?: string | undefined; date_to?: string | undefined };
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}): JSX.Element {
  return (
    <>
      <FormField id={`${idPrefix}-from`} label={ADMIN_TEXT.dateFrom} error={errors.date_from}>
        {(control) => <Input {...control} type="date" value={from} onChange={(e) => onFrom(e.target.value)} />}
      </FormField>
      <FormField id={`${idPrefix}-to`} label={ADMIN_TEXT.dateTo} error={errors.date_to}>
        {(control) => <Input {...control} type="date" value={to} onChange={(e) => onTo(e.target.value)} />}
      </FormField>
    </>
  );
}
