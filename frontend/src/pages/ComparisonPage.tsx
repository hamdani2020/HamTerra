import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router";

import { EvidenceNote } from "@/components/common/EvidenceNote";
import { FormField } from "@/components/common/FormField";
import { RegionError } from "@/components/common/RegionState";
import { VerbatimText } from "@/components/common/VerbatimText";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/core/api/errors";
import { ComparisonResultView } from "@/features/comparison/ComparisonResultView";
import { useCreateComparison, useObservationDates, useSettings } from "@/features/comparison/hooks";
import { useArea } from "@/features/map/hooks";
import { useLatestSource } from "@/features/timeseries/hooks";
import {
  buildComparisonRequest,
  prefillInputs,
  THRESHOLD_KEYS,
  thresholdDefaults,
  type FormErrors,
  type ThresholdInputs,
  type ThresholdKey,
} from "@/lib/comparison";
import { formatDate } from "@/lib/format";
import { COMPARISON_TEXT, errorText, mapFieldErrors, SOURCE_LABEL } from "@/lib/messages";
import { PAGE_TITLE } from "@/lib/pageTitles";
import { routeTo } from "@/lib/routes";
import { SOURCES } from "@/lib/timeseries";
import type { ComparisonRequest, Source } from "@/types/api";

const linkClass =
  "inline-flex min-h-11 items-center rounded-md font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-0";

const selectClass =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";

const THRESHOLD_LABEL: Record<ThresholdKey, { label: string; hint: string }> = {
  ndvi_diff: { label: COMPARISON_TEXT.ndviDiff, hint: COMPARISON_TEXT.ndviDiffHint },
  max_cloud: { label: COMPARISON_TEXT.maxCloud, hint: COMPARISON_TEXT.percentHint },
  min_data_coverage: { label: COMPARISON_TEXT.minDataCoverage, hint: COMPARISON_TEXT.percentHint },
};

/** Backend field names mapped to the form's fields (Requirement 11.16). */
const FIELD_OF: Record<string, keyof FormErrors> = {
  date_a: "first",
  date_b: "second",
  "thresholds.ndvi_diff": "ndvi_diff",
  "thresholds.max_cloud": "max_cloud",
  "thresholds.min_data_coverage": "min_data_coverage",
};

/** Errors that belong to the form rather than to a retryable region. */
function knownError(error: unknown): { fields: FormErrors; message: string | null } | null {
  if (!(error instanceof ApiError) || !error.enveloped) return null;
  if (error.code === "CROSS_SENSOR_COMPARISON") return { fields: {}, message: errorText({ code: error.code }) };
  // The Backend message names the date that has no stored observation (11.5).
  if (error.status === 404) return { fields: {}, message: error.message.trim() || errorText({ code: error.code }) };
  if (error.status === 422) {
    const { fieldErrors, formErrors } = mapFieldErrors(error.details, Object.keys(FIELD_OF));
    const fields: FormErrors = {};
    for (const [name, reason] of Object.entries(fieldErrors)) {
      const key = FIELD_OF[name];
      if (key) fields[key] = reason;
    }
    const message = formErrors.length > 0 ? formErrors.join(" ") : Object.keys(fields).length > 0 ? null : errorText(error);
    return { fields, message };
  }
  return null;
}

/** Two dates of one sensor compared by the Backend (Requirement 11). */
export default function ComparisonPage(): JSX.Element {
  const { areaId = "" } = useParams();
  const area = useArea(areaId);
  const latest = useLatestSource(areaId, true);
  const settings = useSettings();
  const comparison = useCreateComparison(areaId);

  const [chosenSource, setChosenSource] = useState<Source | null>(null);
  const source: Source = chosenSource ?? latest.data ?? "sentinel-2";
  // Wait for the newest sensor before listing dates, so the default cannot switch under a selection.
  const sourceReady = chosenSource !== null || !latest.isPending;
  const dates = useObservationDates(areaId, sourceReady ? source : null);
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [includeWeather, setIncludeWeather] = useState(false);
  const [edited, setEdited] = useState<Partial<ThresholdInputs>>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [lastBody, setLastBody] = useState<ComparisonRequest | null>(null);

  const defaults = thresholdDefaults(settings.data);
  const prefill = prefillInputs(defaults);
  const thresholds: ThresholdInputs = { ...prefill, ...edited };

  function chooseSource(next: Source): void {
    setChosenSource(next);
    // Dates belong to one sensor, so a new sensor starts with no dates selected.
    setFirst("");
    setSecond("");
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    const result = buildComparisonRequest({ source, first, second, include_weather: includeWeather, thresholds }, defaults);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setLastBody(result.body);
    comparison.mutate(result.body);
  }

  const known = knownError(comparison.error);
  const fieldErrors: FormErrors = { ...(known?.fields ?? {}), ...errors };
  const pending = comparison.isPending;

  const dateOptions = (dates.data ?? []).map((d) => (
    <option key={d} value={d}>
      {formatDate(d)}
    </option>
  ));

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
          {PAGE_TITLE.comparison}
        </h1>
        {area.data && (
          <p>
            <Link className={linkClass} to={routeTo.area(areaId)}>
              {area.data.name}
            </Link>
          </p>
        )}
        <EvidenceNote kind="aggregate" />
      </header>

      <form aria-label={COMPARISON_TEXT.form} noValidate onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-4 shadow">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">{COMPARISON_TEXT.source}</legend>
          <div className="flex flex-wrap gap-4">
            {SOURCES.map((s) => (
              <label key={s} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
                <input type="radio" name="source" value={s} checked={source === s} onChange={() => chooseSource(s)} className="h-4 w-4 accent-primary" />
                {SOURCE_LABEL[s]}
              </label>
            ))}
          </div>
        </fieldset>

        {dates.isPending ? (
          <p role="status" aria-busy="true" className="text-sm text-ink-muted">
            {COMPARISON_TEXT.loadingDates}
          </p>
        ) : dates.isError ? (
          <RegionError error={dates.error} context={COMPARISON_TEXT.datesError} onRetry={() => void dates.refetch()} retrying={dates.isFetching} />
        ) : dates.data.length === 0 ? (
          <p className="text-sm text-ink-muted">{COMPARISON_TEXT.noDates}</p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="cmp-first" label={COMPARISON_TEXT.firstDate} error={fieldErrors.first}>
            {(control) => (
              <select {...control} className={selectClass} value={first} onChange={(e) => setFirst(e.target.value)}>
                <option value="">{COMPARISON_TEXT.chooseDate}</option>
                {dateOptions}
              </select>
            )}
          </FormField>
          <FormField id="cmp-second" label={COMPARISON_TEXT.secondDate} error={fieldErrors.second}>
            {(control) => (
              <select {...control} className={selectClass} value={second} onChange={(e) => setSecond(e.target.value)}>
                <option value="">{COMPARISON_TEXT.chooseDate}</option>
                {dateOptions}
              </select>
            )}
          </FormField>
        </div>

        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
          <input type="checkbox" checked={includeWeather} onChange={(e) => setIncludeWeather(e.target.checked)} className="h-4 w-4 accent-primary" />
          {COMPARISON_TEXT.weather}
        </label>

        <details className="rounded-md border p-3" open={THRESHOLD_KEYS.some((k) => fieldErrors[k] !== undefined) || undefined}>
          <summary className="cursor-pointer text-sm font-medium text-foreground">{COMPARISON_TEXT.advanced}</summary>
          <p className="mt-2 text-sm text-ink-muted">{COMPARISON_TEXT.advancedNote}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            {THRESHOLD_KEYS.map((key) => (
              <FormField
                key={key}
                id={`cmp-${key}`}
                label={THRESHOLD_LABEL[key].label}
                hint={defaults[key] === undefined ? COMPARISON_TEXT.settingUnavailable : THRESHOLD_LABEL[key].hint}
                error={fieldErrors[key]}
              >
                {(control) => (
                  <Input {...control} inputMode="decimal" value={thresholds[key]} onChange={(e) => setEdited((x) => ({ ...x, [key]: e.target.value }))} />
                )}
              </FormField>
            ))}
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" className="h-11 sm:h-10" disabled={pending}>
            {pending ? COMPARISON_TEXT.submitting : COMPARISON_TEXT.submit}
          </Button>
          {pending && <span role="status" aria-busy="true" className="sr-only">{COMPARISON_TEXT.submitting}</span>}
        </div>
      </form>

      <div aria-busy={pending} className="min-w-0 space-y-4">
        {known?.message && (
          <div role="alert" className="rounded-md border border-status-error bg-status-error-bg p-4 text-status-error">
            <VerbatimText text={known.message} />
          </div>
        )}
        {comparison.isError && !known && (
          <RegionError
            error={comparison.error}
            context={COMPARISON_TEXT.errorContext}
            onRetry={() => lastBody && comparison.mutate(lastBody)}
            retrying={pending}
          />
        )}
        {comparison.data && <ComparisonResultView result={comparison.data} />}
      </div>
    </div>
  );
}
