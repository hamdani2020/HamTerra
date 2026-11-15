import { type FormEvent, useEffect, useState } from "react";

import { FormField } from "@/components/common/FormField";
import { VerbatimText } from "@/components/common/VerbatimText";
import { WarningBanner } from "@/components/common/WarningBanner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError, ApiTimeoutError } from "@/core/api/errors";
import { addDays, todayUtc } from "@/lib/dates";
import { formatInteger } from "@/lib/format";
import { describeError, elapsedText, errorText, mapFieldErrors, REFRESH_TEXT, SOURCE_LABEL, warningText } from "@/lib/messages";
import { buildRefreshRequest, type RefreshErrors } from "@/lib/refresh";
import { SOURCES } from "@/lib/timeseries";
import type { RefreshResult, Source } from "@/types/api";

import type { useRefreshObservations } from "./hooks";

type RefreshMutation = ReturnType<typeof useRefreshObservations>;

export interface RefreshDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mutation: RefreshMutation;
}

function Counts({ result }: { result: RefreshResult }): JSX.Element {
  return (
    <dl className="grid grid-cols-3 gap-2 text-center text-sm" data-testid="refresh-counts">
      {(
        [
          [REFRESH_TEXT.new, result.new],
          [REFRESH_TEXT.updated, result.updated],
          [REFRESH_TEXT.skipped, result.skipped],
        ] as const
      ).map(([label, value]) => (
        <div key={label} className="rounded-md border p-2">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="text-lg font-semibold tabular-nums text-foreground">{formatInteger(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Result({ result }: { result: RefreshResult }): JSX.Element {
  const tone = result.status === "partial" ? "border-status-warning bg-status-warning-bg" : "border-status-success bg-status-success-bg";
  const title =
    result.status === "success" ? REFRESH_TEXT.successTitle : result.status === "empty" ? REFRESH_TEXT.emptyTitle : REFRESH_TEXT.partialTitle;
  return (
    <div role="status" className={`space-y-3 rounded-md border p-3 ${tone}`}>
      <p className="font-medium text-foreground">{title}</p>
      {result.status === "partial" && <p className="text-sm text-foreground">{REFRESH_TEXT.partialBody}</p>}
      <Counts result={result} />
      <WarningBanner messages={result.warnings.map(warningText)} />
      <p className="text-sm text-ink-muted">
        {REFRESH_TEXT.retrievalId}: <code className="[overflow-wrap:anywhere]">{result.retrieval_id}</code>
      </p>
    </div>
  );
}

/**
 * The refresh dialog (Requirement 13, frontend design Refresh Dialog). While the request
 * runs, the confirm and close buttons are disabled; Escape closes the dialog and the request
 * keeps running. The form values stay between openings.
 */
export function RefreshDialog({ open, onOpenChange, mutation }: RefreshDialogProps): JSX.Element {
  const today = todayUtc();
  const [dateFrom, setDateFrom] = useState(addDays(today, -29));
  const [dateTo, setDateTo] = useState(today);
  const [sources, setSources] = useState<Source[]>([...SOURCES]);
  const [errors, setErrors] = useState<RefreshErrors>({});
  const [elapsed, setElapsed] = useState(0);
  const pending = mutation.isPending;

  useEffect(() => {
    if (!pending) return undefined;
    const started = mutation.submittedAt || Date.now();
    setElapsed(Math.floor((Date.now() - started) / 1000));
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [pending, mutation.submittedAt]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (pending) return;
    const built = buildRefreshRequest({ date_from: dateFrom, date_to: dateTo, sources }, todayUtc());
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    mutation.mutate(built.body);
  }

  const toggle = (source: Source, checked: boolean) =>
    setSources((current) => (checked ? [...new Set([...current, source])] : current.filter((s) => s !== source)));

  // Backend 422 field messages go next to the matching inputs.
  const error = mutation.error;
  const apiError = error instanceof ApiError ? error : null;
  const backendFields =
    apiError?.status === 422 ? mapFieldErrors(apiError.details, ["date_from", "date_to", "sources"]).fieldErrors : {};
  const fieldErrors: RefreshErrors = { ...backendFields, ...errors };
  const inProgress = apiError?.status === 409;

  let failure: JSX.Element | null = null;
  if (mutation.isError) {
    if (inProgress) {
      failure = (
        <div role="alert" className="space-y-2 rounded-md border border-status-warning bg-status-warning-bg p-3 text-status-warning">
          <p>{REFRESH_TEXT.inProgress}</p>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {REFRESH_TEXT.tryLater}
          </Button>
        </div>
      );
    } else if (error instanceof ApiTimeoutError) {
      failure = (
        <div role="alert" className="rounded-md border border-status-error bg-status-error-bg p-3 text-status-error">
          <p>{REFRESH_TEXT.timeout}</p>
        </div>
      );
    } else if (apiError && (apiError.status === 502 || apiError.status === 504)) {
      failure = (
        <div role="alert" className="space-y-1 rounded-md border border-status-error bg-status-error-bg p-3 text-status-error">
          <p>{errorText({ code: apiError.code })}</p>
          <p>{REFRESH_TEXT.unchanged}</p>
        </div>
      );
    } else if (!(apiError?.status === 422 && Object.keys(backendFields).length > 0)) {
      const display = describeError(error);
      failure = (
        <div role="alert" className="space-y-1 rounded-md border border-status-error bg-status-error-bg p-3 text-status-error">
          <p className="font-medium">{REFRESH_TEXT.errorContext}</p>
          <VerbatimText text={display.body} />
        </div>
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeDisabled={pending}
        // Clicking outside must not leave a running refresh; Escape still closes (design).
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        className="max-h-[90dvh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{REFRESH_TEXT.title}</DialogTitle>
          <DialogDescription>{REFRESH_TEXT.description}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="space-y-4" aria-label={REFRESH_TEXT.title}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="refresh-from" label={REFRESH_TEXT.dateFrom} error={fieldErrors.date_from}>
              {(control) => <Input {...control} type="date" value={dateFrom} max={today} onChange={(e) => setDateFrom(e.target.value)} />}
            </FormField>
            <FormField id="refresh-to" label={REFRESH_TEXT.dateTo} error={fieldErrors.date_to}>
              {(control) => <Input {...control} type="date" value={dateTo} max={today} onChange={(e) => setDateTo(e.target.value)} />}
            </FormField>
          </div>
          <fieldset className="space-y-2" aria-describedby={fieldErrors.sources ? "refresh-sources-error" : undefined}>
            <legend className="text-sm font-medium text-foreground">{REFRESH_TEXT.sources}</legend>
            <div className="flex flex-wrap gap-4">
              {SOURCES.map((s) => (
                <label key={s} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
                  <input type="checkbox" checked={sources.includes(s)} onChange={(e) => toggle(s, e.target.checked)} className="h-4 w-4 accent-primary" />
                  {SOURCE_LABEL[s]}
                </label>
              ))}
            </div>
            {fieldErrors.sources && (
              <p id="refresh-sources-error" className="text-sm font-medium text-status-error">
                {fieldErrors.sources}
              </p>
            )}
          </fieldset>

          {pending && (
            <div className="space-y-2" role="status" aria-busy="true">
              {/* Indeterminate: no value. Static, because animations longer than 200 ms are not allowed (21.10). */}
              <div role="progressbar" aria-label={REFRESH_TEXT.progressLabel} className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full w-1/3 rounded-full bg-primary" />
              </div>
              <p className="text-sm text-foreground">{REFRESH_TEXT.pending}</p>
              <p className="text-sm tabular-nums text-ink-muted">{elapsedText(elapsed)}</p>
            </div>
          )}
          {mutation.isSuccess && <Result result={mutation.data} />}
          {failure}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              {REFRESH_TEXT.close}
            </Button>
            <Button type="submit" disabled={pending}>
              {REFRESH_TEXT.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
