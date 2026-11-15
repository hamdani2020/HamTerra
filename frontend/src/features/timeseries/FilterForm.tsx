import { type FormEvent, useState } from "react";

import { FormField } from "@/components/common/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SOURCE_LABEL, TIME_SERIES_TEXT } from "@/lib/messages";
import { SOURCES, validateTimeSeriesFilters, type FilterErrors, type TimeSeriesFilters } from "@/lib/timeseries";
import type { TimeSeriesParams } from "@/types/api";

export interface FilterFormProps {
  initial: TimeSeriesFilters;
  /** Called only with valid filters (Requirement 10.18). */
  onApply: (filters: TimeSeriesFilters, params: TimeSeriesParams) => void;
  disabled?: boolean;
}

/**
 * Source (radio, so one sensor only), dates, cloud limit and weather toggle (10.1). Invalid
 * values show field errors and send nothing; the entered values stay.
 */
export function FilterForm({ initial, onApply, disabled = false }: FilterFormProps): JSX.Element {
  const [filters, setFilters] = useState(initial);
  const [errors, setErrors] = useState<FilterErrors>({});
  const set = <K extends keyof TimeSeriesFilters>(key: K, value: TimeSeriesFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  function submit(event: FormEvent): void {
    event.preventDefault();
    const result = validateTimeSeriesFilters(filters);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onApply(filters, result.params);
  }

  return (
    <form aria-label={TIME_SERIES_TEXT.filters} noValidate onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-4 shadow">
      <fieldset className="space-y-2" aria-describedby={errors.source ? "ts-source-error" : undefined}>
        <legend className="text-sm font-medium text-foreground">{TIME_SERIES_TEXT.source}</legend>
        <div className="flex flex-wrap gap-4">
          {SOURCES.map((source) => (
            <label key={source} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
              <input
                type="radio"
                name="source"
                value={source}
                checked={filters.source === source}
                onChange={() => set("source", source)}
                className="h-4 w-4 accent-primary"
              />
              {SOURCE_LABEL[source]}
            </label>
          ))}
        </div>
        {errors.source && (
          <p id="ts-source-error" className="text-sm font-medium text-status-error">
            {errors.source}
          </p>
        )}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="ts-from" label={TIME_SERIES_TEXT.dateFrom} error={errors.date_from}>
          {(control) => <Input {...control} type="date" value={filters.date_from} onChange={(e) => set("date_from", e.target.value)} />}
        </FormField>
        <FormField id="ts-to" label={TIME_SERIES_TEXT.dateTo} error={errors.date_to}>
          {(control) => <Input {...control} type="date" value={filters.date_to} onChange={(e) => set("date_to", e.target.value)} />}
        </FormField>
        <FormField id="ts-cloud" label={TIME_SERIES_TEXT.maxCloud} hint={TIME_SERIES_TEXT.maxCloudHint} error={errors.max_cloud_coverage}>
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              value={filters.max_cloud_coverage}
              onChange={(e) => set("max_cloud_coverage", e.target.value)}
            />
          )}
        </FormField>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
        <input
          type="checkbox"
          checked={filters.include_weather}
          onChange={(e) => set("include_weather", e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        {TIME_SERIES_TEXT.weather}
      </label>
      <Button type="submit" className="h-11 sm:h-10" disabled={disabled}>
        {TIME_SERIES_TEXT.apply}
      </Button>
    </form>
  );
}
