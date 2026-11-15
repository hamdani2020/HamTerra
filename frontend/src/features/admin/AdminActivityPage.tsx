import { type FormEvent, useState } from "react";

import { ResponsiveTable, type Column } from "@/components/common/DataTable";
import { FormField } from "@/components/common/FormField";
import { KeyValueList } from "@/components/common/KeyValueList";
import { Pagination } from "@/components/common/Pagination";
import { EmptyState, RegionError, RegionSkeleton } from "@/components/common/RegionState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { ADMIN_TEXT } from "@/lib/messages";
import { PAGE_TITLE } from "@/lib/pageTitles";
import { parsePageSize } from "@/lib/pagination";
import { validateDateRange } from "@/lib/validators";
import type { ActivityListParams, AuditEvent } from "@/types/api";

import { ADMIN_PAGE_SIZE, useActivity } from "./adminHooks";
import { OutcomeBadge } from "./badges";
import { DateFilters, PageSizeField } from "./filters";

const COLUMNS: Column<AuditEvent>[] = [
  { id: "time", header: ADMIN_TEXT.time, cell: (e) => formatDateTime(e.occurred_at) },
  { id: "actor", header: ADMIN_TEXT.actor, cell: (e) => e.actor_sub ?? ADMIN_TEXT.noActor },
  { id: "action", header: ADMIN_TEXT.action, cell: (e) => <code>{e.action}</code> },
  { id: "target-type", header: ADMIN_TEXT.targetType, cell: (e) => e.target_type },
  { id: "target-id", header: ADMIN_TEXT.targetId, cell: (e) => e.target_id ?? ADMIN_TEXT.noError },
  { id: "request-id", header: ADMIN_TEXT.requestId, cell: (e) => e.request_id },
  { id: "outcome", header: ADMIN_TEXT.outcome, cell: (e) => <OutcomeBadge outcome={e.outcome} /> },
  {
    id: "details",
    header: ADMIN_TEXT.details,
    // Read-only key-value text (18.11).
    cell: (e) => (Object.keys(e.details ?? {}).length === 0 ? ADMIN_TEXT.noError : <KeyValueList entries={e.details} label={`${ADMIN_TEXT.details}: ${e.action}`} />),
  },
];

interface Inputs {
  actor: string;
  action: string;
  from: string;
  to: string;
  size: string;
}

/** Audit activity (Requirements 18.3, 18.8 to 18.11). Read-only. */
export function AdminActivityPage(): JSX.Element {
  const [inputs, setInputs] = useState<Inputs>({ actor: "", action: "", from: "", to: "", size: String(ADMIN_PAGE_SIZE) });
  const [errors, setErrors] = useState<{ date_from?: string; date_to?: string; size?: string }>({});
  const [filters, setFilters] = useState<ActivityListParams>({ limit: ADMIN_PAGE_SIZE });
  const [offset, setOffset] = useState(0);
  const list = useActivity({ ...filters, offset });
  const set = <K extends keyof Inputs>(key: K) => (value: Inputs[K]) => setInputs((i) => ({ ...i, [key]: value }));

  function apply(event: FormEvent): void {
    event.preventDefault();
    const dates = validateDateRange(inputs.from, inputs.to, { required: false });
    const limit = parsePageSize(inputs.size);
    const next: typeof errors = dates.ok ? {} : { ...dates.errors };
    if (limit === null) next.size = ADMIN_TEXT.pageSizeInvalid;
    setErrors(next);
    // No request is sent while a filter is invalid (18.9).
    if (!dates.ok || limit === null) return;
    const params: ActivityListParams = { limit };
    if (inputs.actor.trim()) params.actor = inputs.actor.trim();
    if (inputs.action.trim()) params.action = inputs.action.trim();
    if (dates.from) params.date_from = dates.from;
    if (dates.to) params.date_to = dates.to;
    setFilters(params);
    setOffset(0);
  }

  let body: JSX.Element;
  // On failure no rows are shown, so earlier rows never pass for current results (18.3).
  if (list.isError) {
    body = <RegionError error={list.error} context={ADMIN_TEXT.activityListError} onRetry={() => void list.refetch()} retrying={list.isFetching} />;
  } else if (!list.data) {
    body = <RegionSkeleton rows={6} />;
  } else if (list.data.items.length === 0) {
    body = <EmptyState noun="events" message={ADMIN_TEXT.activityListEmpty} />;
  } else {
    body = (
      <div className="space-y-2">
        <ResponsiveTable caption={ADMIN_TEXT.activityCaption} columns={COLUMNS} rows={list.data.items} getRowId={(e) => e.id} />
        <Pagination total={list.data.total} limit={list.data.limit} offset={list.data.offset} disabled={list.isFetching} onOffsetChange={setOffset} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
        {PAGE_TITLE.adminActivity}
      </h1>
      <form noValidate onSubmit={apply} className="grid gap-4 rounded-lg border bg-card p-4 shadow sm:grid-cols-2 lg:grid-cols-3 lg:items-start">
        <FormField id="activity-actor" label={ADMIN_TEXT.actor}>
          {(control) => <Input {...control} value={inputs.actor} onChange={(e) => set("actor")(e.target.value)} />}
        </FormField>
        <FormField id="activity-action" label={ADMIN_TEXT.action}>
          {(control) => <Input {...control} value={inputs.action} onChange={(e) => set("action")(e.target.value)} />}
        </FormField>
        <PageSizeField id="activity-size" value={inputs.size} error={errors.size} onChange={set("size")} />
        <DateFilters idPrefix="activity" from={inputs.from} to={inputs.to} errors={errors} onFrom={set("from")} onTo={set("to")} />
        <div className="flex items-end lg:pt-6">
          <Button type="submit" variant="outline" className="h-11 sm:h-10">
            {ADMIN_TEXT.apply}
          </Button>
        </div>
      </form>
      <section aria-label={ADMIN_TEXT.activityCaption} aria-busy={list.isFetching} className="min-w-0">
        {body}
      </section>
    </div>
  );
}
