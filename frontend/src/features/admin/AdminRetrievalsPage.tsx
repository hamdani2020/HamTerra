import { type FormEvent, useState } from "react";

import { ResponsiveTable, type Column } from "@/components/common/DataTable";
import { FormField } from "@/components/common/FormField";
import { Pagination } from "@/components/common/Pagination";
import { EmptyState, RegionError, RegionSkeleton } from "@/components/common/RegionState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatDateTime, formatInteger } from "@/lib/format";
import { ADMIN_TEXT, RETRIEVAL_STATUS_LABEL } from "@/lib/messages";
import { PAGE_TITLE } from "@/lib/pageTitles";
import { parsePageSize } from "@/lib/pagination";
import { validateDateRange } from "@/lib/validators";
import type { RetrievalListParams, RetrievalProvider, RetrievalRecord, RetrievalStatus } from "@/types/api";

import { ADMIN_PAGE_SIZE, useRetrievals } from "./adminHooks";
import { RetrievalStatusBadge } from "./badges";
import { DateFilters, PageSizeField, selectClass } from "./filters";

const PROVIDERS: readonly RetrievalProvider[] = ["agromonitoring", "weather"];
const PROVIDER_LABEL: Record<RetrievalProvider, string> = { agromonitoring: ADMIN_TEXT.agromonitoring, weather: ADMIN_TEXT.weather };
const STATUSES = Object.keys(RETRIEVAL_STATUS_LABEL) as RetrievalStatus[];

function rangeCell(r: RetrievalRecord): string {
  const range = r.requested_range;
  if (!range || (range.from === null && range.to === null)) return ADMIN_TEXT.noError;
  return `${range.from ? formatDate(range.from) : "…"} – ${range.to ? formatDate(range.to) : "…"}`;
}

const COLUMNS: Column<RetrievalRecord>[] = [
  { id: "started", header: ADMIN_TEXT.started, cell: (r) => formatDateTime(r.started_at) },
  { id: "provider", header: ADMIN_TEXT.provider, cell: (r) => PROVIDER_LABEL[r.provider] ?? r.provider },
  { id: "kind", header: ADMIN_TEXT.kind, cell: (r) => r.kind },
  { id: "area", header: ADMIN_TEXT.area, cell: (r) => r.area_id ?? ADMIN_TEXT.noArea },
  { id: "range", header: ADMIN_TEXT.range, cell: rangeCell },
  { id: "status", header: ADMIN_TEXT.status, cell: (r) => <RetrievalStatusBadge status={r.status} /> },
  { id: "items", header: ADMIN_TEXT.items, align: "right", cell: (r) => formatInteger(r.item_count) },
  { id: "duration", header: ADMIN_TEXT.duration, align: "right", cell: (r) => (r.duration_ms === null ? ADMIN_TEXT.noError : formatInteger(r.duration_ms)) },
  {
    id: "error",
    header: ADMIN_TEXT.error,
    // `error.code` and `error.message` as received, nothing else (18.7).
    cell: (r) =>
      r.error ? (
        <span>
          {r.error.code !== null && <code>{r.error.code}</code>} {r.error.message ?? ""}
        </span>
      ) : (
        ADMIN_TEXT.noError
      ),
  },
];

interface Inputs {
  provider: "" | RetrievalProvider;
  areaId: string;
  status: "" | RetrievalStatus;
  from: string;
  to: string;
  size: string;
}

/** Retrieval history (Requirements 18.1 to 18.7, 18.10). Read-only. */
export function AdminRetrievalsPage(): JSX.Element {
  const [inputs, setInputs] = useState<Inputs>({ provider: "", areaId: "", status: "", from: "", to: "", size: String(ADMIN_PAGE_SIZE) });
  const [errors, setErrors] = useState<{ date_from?: string; date_to?: string; size?: string }>({});
  const [filters, setFilters] = useState<RetrievalListParams>({ limit: ADMIN_PAGE_SIZE });
  const [offset, setOffset] = useState(0);
  const list = useRetrievals({ ...filters, offset });
  const set = <K extends keyof Inputs>(key: K) => (value: Inputs[K]) => setInputs((i) => ({ ...i, [key]: value }));

  function apply(event: FormEvent): void {
    event.preventDefault();
    const dates = validateDateRange(inputs.from, inputs.to, { required: false });
    const limit = parsePageSize(inputs.size);
    const next: typeof errors = dates.ok ? {} : { ...dates.errors };
    if (limit === null) next.size = ADMIN_TEXT.pageSizeInvalid;
    setErrors(next);
    // No request is sent while a filter is invalid (18.6).
    if (!dates.ok || limit === null) return;
    const params: RetrievalListParams = { limit };
    if (inputs.provider) params.provider = inputs.provider;
    if (inputs.areaId.trim()) params.area_id = inputs.areaId.trim();
    if (inputs.status) params.status = inputs.status;
    if (dates.from) params.date_from = dates.from;
    if (dates.to) params.date_to = dates.to;
    setFilters(params);
    setOffset(0);
  }

  let body: JSX.Element;
  // On failure no rows are shown, so earlier rows never pass for current results (18.3).
  if (list.isError) {
    body = <RegionError error={list.error} context={ADMIN_TEXT.retrievalsError} onRetry={() => void list.refetch()} retrying={list.isFetching} />;
  } else if (!list.data) {
    body = <RegionSkeleton rows={6} />;
  } else if (list.data.items.length === 0) {
    body = <EmptyState noun="retrievals" message={ADMIN_TEXT.retrievalsEmpty} />;
  } else {
    body = (
      <div className="space-y-2">
        <ResponsiveTable caption={ADMIN_TEXT.retrievalsCaption} columns={COLUMNS} rows={list.data.items} getRowId={(r) => r.id} />
        <Pagination total={list.data.total} limit={list.data.limit} offset={list.data.offset} disabled={list.isFetching} onOffsetChange={setOffset} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
        {PAGE_TITLE.adminRetrievals}
      </h1>
      <form noValidate onSubmit={apply} className="grid gap-4 rounded-lg border bg-card p-4 shadow sm:grid-cols-2 lg:grid-cols-4 lg:items-start">
        <FormField id="retrievals-provider" label={ADMIN_TEXT.provider}>
          {(control) => (
            <select {...control} className={selectClass} value={inputs.provider} onChange={(e) => set("provider")(e.target.value as Inputs["provider"])}>
              <option value="">{ADMIN_TEXT.anyProvider}</option>
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField id="retrievals-area" label={ADMIN_TEXT.areaId}>
          {(control) => <Input {...control} value={inputs.areaId} onChange={(e) => set("areaId")(e.target.value)} />}
        </FormField>
        <FormField id="retrievals-status" label={ADMIN_TEXT.status}>
          {(control) => (
            <select {...control} className={selectClass} value={inputs.status} onChange={(e) => set("status")(e.target.value as Inputs["status"])}>
              <option value="">{ADMIN_TEXT.anyStatus}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {RETRIEVAL_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <DateFilters idPrefix="retrievals" from={inputs.from} to={inputs.to} errors={errors} onFrom={set("from")} onTo={set("to")} />
        <PageSizeField id="retrievals-size" value={inputs.size} error={errors.size} onChange={set("size")} />
        <div className="flex items-end sm:col-span-2 lg:col-span-1 lg:pt-6">
          <Button type="submit" variant="outline" className="h-11 sm:h-10">
            {ADMIN_TEXT.apply}
          </Button>
        </div>
      </form>
      <section aria-label={ADMIN_TEXT.retrievalsCaption} aria-busy={list.isFetching} className="min-w-0">
        {body}
      </section>
    </div>
  );
}
