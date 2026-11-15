import { type FormEvent, useState } from "react";

import { FormField } from "@/components/common/FormField";
import { Pagination } from "@/components/common/Pagination";
import { EmptyState, RegionError, RegionSkeleton } from "@/components/common/RegionState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/core/api/errors";
import type { MapController } from "@/features/map/useMap";
import { bindPreview, usePreviewOverlay } from "@/features/map/usePreviewOverlay";
import { useObservation } from "@/features/observations/hooks";
import { ObservationDetail } from "@/features/observations/ObservationDetail";
import { ObservationsTable, observationRow } from "@/features/observations/ObservationsTable";
import { geometryBounds } from "@/lib/geo";
import { AREA_TEXT, SOURCE_LABEL, TIME_SERIES_TEXT } from "@/lib/messages";
import { SOURCES } from "@/lib/timeseries";
import {
  EMPTY_OBSERVATION_FILTERS,
  validateObservationFilters,
  type ObservationFilterErrors,
  type ObservationFilters,
} from "@/lib/validators";
import type { Area, ObservationListParams } from "@/types/api";

import { HISTORY_PAGE_SIZE, useObservationHistory } from "./hooks";

const selectClass =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";

function SelectedObservation({
  observationId,
  area,
  controller,
  onBack,
}: {
  observationId: string;
  area: Area;
  controller: MapController | null;
  onBack: () => void;
}): JSX.Element {
  const observation = useObservation(observationId);
  const overlay = usePreviewOverlay(controller);
  const bbox = area.geometry ? geometryBounds([area.geometry]) : null;
  if (observation.isError) {
    if (observation.error instanceof ApiError && observation.error.status === 404) {
      return (
        <div role="alert" className="space-y-2 rounded-lg border bg-card p-4 shadow">
          <p className="text-foreground">{AREA_TEXT.observationNotFound}</p>
          <Button type="button" variant="outline" onClick={onBack}>
            {AREA_TEXT.backToHistory}
          </Button>
        </div>
      );
    }
    return (
      <RegionError
        error={observation.error}
        context={AREA_TEXT.observationError}
        onRetry={() => void observation.refetch()}
        retrying={observation.isFetching}
      />
    );
  }
  if (!observation.data) return <RegionSkeleton rows={5} />;
  return <ObservationDetail observation={observation.data} preview={bindPreview(overlay, observation.data, bbox, controller !== null)} />;
}

/**
 * The observation history (Requirement 12.9 to 12.11). Mounted only while its section is
 * open, so nothing is requested before. Filters are validated before any request.
 */
export function ObservationHistory({ area, controller }: { area: Area; controller: MapController | null }): JSX.Element {
  const [form, setForm] = useState<ObservationFilters>(EMPTY_OBSERVATION_FILTERS);
  const [errors, setErrors] = useState<ObservationFilterErrors>({});
  const [filters, setFilters] = useState<ObservationListParams>({});
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const params: ObservationListParams = { ...filters, limit: HISTORY_PAGE_SIZE, offset };
  const history = useObservationHistory(area.id, params, true);
  const set = <K extends keyof ObservationFilters>(key: K, value: ObservationFilters[K]) => setForm((f) => ({ ...f, [key]: value }));

  function apply(event: FormEvent): void {
    event.preventDefault();
    const result = validateObservationFilters(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setFilters(result.params);
    setOffset(0);
    setSelected(null);
  }

  let table: JSX.Element;
  if (history.isError && !history.data) {
    table = <RegionError error={history.error} context={AREA_TEXT.historyError} onRetry={() => void history.refetch()} retrying={history.isFetching} />;
  } else if (!history.data) {
    table = <RegionSkeleton rows={5} />;
  } else if (history.data.items.length === 0) {
    table = <EmptyState noun="observations" message={AREA_TEXT.historyEmpty} />;
  } else {
    table = (
      <div className="space-y-2">
        <ObservationsTable rows={history.data.items.map(observationRow)} onSelect={setSelected} selectedKey={selected} />
        <Pagination
          total={history.data.total}
          limit={history.data.limit}
          offset={history.data.offset}
          disabled={history.isFetching}
          onOffsetChange={setOffset}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form aria-label={AREA_TEXT.historyFilters} noValidate onSubmit={apply} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <FormField id="hist-source" label={TIME_SERIES_TEXT.source}>
            {(control) => (
              <select {...control} className={selectClass} value={form.source} onChange={(e) => set("source", e.target.value as ObservationFilters["source"])}>
                <option value="">{AREA_TEXT.allSources}</option>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABEL[s]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField id="hist-from" label={TIME_SERIES_TEXT.dateFrom} error={errors.date_from}>
            {(control) => <Input {...control} type="date" value={form.date_from} onChange={(e) => set("date_from", e.target.value)} />}
          </FormField>
          <FormField id="hist-to" label={TIME_SERIES_TEXT.dateTo} error={errors.date_to}>
            {(control) => <Input {...control} type="date" value={form.date_to} onChange={(e) => set("date_to", e.target.value)} />}
          </FormField>
          <FormField id="hist-cloud" label={AREA_TEXT.maxCloud} error={errors.max_cloud_coverage}>
            {(control) => <Input {...control} inputMode="decimal" value={form.max_cloud_coverage} onChange={(e) => set("max_cloud_coverage", e.target.value)} />}
          </FormField>
          <FormField id="hist-coverage" label={AREA_TEXT.minDataCoverage} error={errors.min_data_coverage}>
            {(control) => <Input {...control} inputMode="decimal" value={form.min_data_coverage} onChange={(e) => set("min_data_coverage", e.target.value)} />}
          </FormField>
        </div>
        <Button type="submit" variant="outline" className="h-11 sm:h-10">
          {AREA_TEXT.applyFilters}
        </Button>
      </form>
      <div aria-busy={history.isFetching} className="min-w-0">
        {table}
      </div>
      {selected && <SelectedObservation key={selected} observationId={selected} area={area} controller={controller} onBack={() => setSelected(null)} />}
    </div>
  );
}
