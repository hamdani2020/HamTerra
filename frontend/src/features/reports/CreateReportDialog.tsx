import { Plus, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";

import { FormField } from "@/components/common/FormField";
import { RegionError } from "@/components/common/RegionState";
import { VerbatimText } from "@/components/common/VerbatimText";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError, ApiTimeoutError, NetworkError } from "@/core/api/errors";
import { addDays, todayUtc } from "@/lib/dates";
import { describeError, errorText, mapFieldErrors, REPORT_TEXT, SOURCE_LABEL } from "@/lib/messages";
import { PAIRS_MAX, validateReportForm, type ReportFormErrors, type ReportPairInput } from "@/lib/reportForm";
import { routeTo } from "@/lib/routes";
import { SOURCES } from "@/lib/timeseries";
import type { Source } from "@/types/api";

import { useCreateReport, useReportAreas } from "./hooks";

const selectClass =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";
const linkClass = "font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export interface CreateReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Set when opened from an area page: the area is fixed (Requirement 15.1). */
  fixedArea?: { id: string; name: string } | undefined;
}

/** Kinds of failure that keep the form open with a retry (15.15) versus a message only. */
function isRetryable(error: unknown): boolean {
  return error instanceof NetworkError || error instanceof ApiTimeoutError || (error instanceof ApiError && error.status >= 500);
}

/**
 * The create-report form (Requirement 15.1 to 15.5, 15.15). Invalid input sends nothing; every
 * failure keeps the entered values. On 201 the new report opens.
 */
export function CreateReportDialog({ open, onOpenChange, fixedArea }: CreateReportDialogProps): JSX.Element {
  const navigate = useNavigate();
  const create = useCreateReport();
  const areas = useReportAreas(open && !fixedArea);
  const today = todayUtc();
  const [areaId, setAreaId] = useState(fixedArea?.id ?? "");
  const [source, setSource] = useState<Source>("sentinel-2");
  const [dateFrom, setDateFrom] = useState(addDays(today, -364));
  const [dateTo, setDateTo] = useState(today);
  const [title, setTitle] = useState("");
  const [pairs, setPairs] = useState<ReportPairInput[]>([]);
  const [includeWeather, setIncludeWeather] = useState(false);
  const [errors, setErrors] = useState<ReportFormErrors>({});
  const effectiveArea = fixedArea?.id ?? areaId;
  const pending = create.isPending;

  function submit(event?: FormEvent): void {
    event?.preventDefault();
    if (pending) return;
    const result = validateReportForm({ area_id: effectiveArea, source, date_from: dateFrom, date_to: dateTo, title, pairs, include_weather: includeWeather });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    create.mutate(result.body, {
      onSuccess: (report) => {
        onOpenChange(false);
        void navigate(routeTo.report(report.id));
      },
    });
  }

  const error = create.error;
  const apiError = error instanceof ApiError ? error : null;
  const noObservations = apiError?.code === "NO_OBSERVATIONS";
  const backendFields = apiError?.status === 422 && !noObservations ? mapFieldErrors(apiError.details, ["area_id", "date_from", "date_to", "title", "source", "comparisons"]) : null;
  const fieldErrors: ReportFormErrors = {
    ...(backendFields?.fieldErrors.area_id ? { area_id: backendFields.fieldErrors.area_id } : {}),
    ...(backendFields?.fieldErrors.date_from ? { date_from: backendFields.fieldErrors.date_from } : {}),
    ...(backendFields?.fieldErrors.date_to ? { date_to: backendFields.fieldErrors.date_to } : {}),
    ...(backendFields?.fieldErrors.title ? { title: backendFields.fieldErrors.title } : {}),
    ...(backendFields?.fieldErrors.comparisons ? { pairs: backendFields.fieldErrors.comparisons } : {}),
    ...errors,
  };

  let failure: JSX.Element | null = null;
  if (create.isError) {
    if (noObservations) {
      failure = (
        <div role="alert" className="space-y-2 rounded-md border border-status-warning bg-status-warning-bg p-3 text-status-warning">
          <p>{REPORT_TEXT.noObservations}</p>
          {effectiveArea && (
            <Link className={linkClass} to={routeTo.area(effectiveArea)} onClick={() => onOpenChange(false)}>
              {REPORT_TEXT.refreshLink}
            </Link>
          )}
        </div>
      );
    } else if (isRetryable(error)) {
      failure = <RegionError error={error} context={REPORT_TEXT.errorContext} onRetry={() => submit()} retrying={pending} />;
    } else {
      const formMessages = backendFields?.formErrors ?? [];
      const message = formMessages.length > 0 ? formMessages.join(" ") : apiError ? errorText(apiError) : describeError(error).body;
      if (!backendFields || formMessages.length > 0 || Object.keys(backendFields.fieldErrors).length === 0) {
        failure = (
          <div role="alert" className="rounded-md border border-status-error bg-status-error-bg p-3 text-status-error">
            <VerbatimText text={message} />
          </div>
        );
      }
    }
  }

  const setPair = (index: number, key: keyof ReportPairInput, value: string) =>
    setPairs((list) => list.map((p, i) => (i === index ? { ...p, [key]: value } : p)));

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent closeDisabled={pending} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{REPORT_TEXT.createTitle}</DialogTitle>
          <DialogDescription>{REPORT_TEXT.createDescription}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} aria-label={REPORT_TEXT.createTitle} className="space-y-4">
          {fixedArea ? (
            <p className="text-sm">
              <span className="text-ink-muted">{REPORT_TEXT.area}: </span>
              <span className="font-medium text-foreground">{fixedArea.name}</span>
            </p>
          ) : (
            <FormField id="report-area" label={REPORT_TEXT.area} error={fieldErrors.area_id}>
              {(control) => (
                <select {...control} className={selectClass} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
                  <option value="">{REPORT_TEXT.chooseArea}</option>
                  {(areas.data?.items ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">{REPORT_TEXT.source}</legend>
            <div className="flex flex-wrap gap-4">
              {SOURCES.map((s) => (
                <label key={s} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
                  <input type="radio" name="report-source" checked={source === s} onChange={() => setSource(s)} className="h-4 w-4 accent-primary" />
                  {SOURCE_LABEL[s]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="report-from" label={REPORT_TEXT.dateFrom} error={fieldErrors.date_from}>
              {(control) => <Input {...control} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />}
            </FormField>
            <FormField id="report-to" label={REPORT_TEXT.dateTo} error={fieldErrors.date_to}>
              {(control) => <Input {...control} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />}
            </FormField>
          </div>
          <FormField id="report-title" label={REPORT_TEXT.title} hint={REPORT_TEXT.titleHint} error={fieldErrors.title}>
            {(control) => <Input {...control} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </FormField>

          <fieldset className="space-y-2" aria-describedby={fieldErrors.pairs ? "report-pairs-error" : "report-pairs-hint"}>
            <legend className="text-sm font-medium text-foreground">{REPORT_TEXT.pairs}</legend>
            <p id="report-pairs-hint" className="text-sm text-ink-muted">
              {REPORT_TEXT.pairsHint}
            </p>
            {pairs.map((pair, index) => (
              <div key={index} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]" data-testid={`pair-${index}`}>
                <FormField id={`pair-${index}-first`} label={`${REPORT_TEXT.pairFirst} ${index + 1}`} error={fieldErrors.pairErrors?.[index]?.first}>
                  {(control) => <Input {...control} type="date" value={pair.first} onChange={(e) => setPair(index, "first", e.target.value)} />}
                </FormField>
                <FormField id={`pair-${index}-second`} label={`${REPORT_TEXT.pairSecond} ${index + 1}`} error={fieldErrors.pairErrors?.[index]?.second}>
                  {(control) => <Input {...control} type="date" value={pair.second} onChange={(e) => setPair(index, "second", e.target.value)} />}
                </FormField>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-11 p-0 sm:h-10 sm:w-10"
                  aria-label={`${REPORT_TEXT.removePair} ${index + 1}`}
                  onClick={() => setPairs((list) => list.filter((_, i) => i !== index))}
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {fieldErrors.pairs && (
              <p id="report-pairs-error" className="text-sm font-medium text-status-error">
                {fieldErrors.pairs}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              className="h-11 sm:h-10"
              disabled={pairs.length >= PAIRS_MAX}
              onClick={() => setPairs((list) => [...list, { first: "", second: "" }])}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              {REPORT_TEXT.addPair}
            </Button>
          </fieldset>

          <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
            <input type="checkbox" checked={includeWeather} onChange={(e) => setIncludeWeather(e.target.checked)} className="h-4 w-4 accent-primary" />
            {REPORT_TEXT.weather}
          </label>

          {pending && (
            <p role="status" aria-busy="true" className="text-sm text-foreground">
              {REPORT_TEXT.submitting}
            </p>
          )}
          {failure}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              {REPORT_TEXT.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {REPORT_TEXT.submit}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
