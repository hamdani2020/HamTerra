import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { ResponsiveTable, type Column } from "@/components/common/DataTable";
import { FormField } from "@/components/common/FormField";
import { Pagination } from "@/components/common/Pagination";
import { EmptyState, RegionError, RegionSkeleton } from "@/components/common/RegionState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrentPrincipal } from "@/core/auth/principal";
import { useDemo } from "@/core/demo/DemoContext";
import { CreateReportDialog } from "@/features/reports/CreateReportDialog";
import { REPORT_PAGE_SIZE, useReportAreas, useReportList } from "@/features/reports/hooks";
import { formatDate, formatDateTime } from "@/lib/format";
import { REPORT_TEXT, SOURCE_LABEL } from "@/lib/messages";
import { isAdmin } from "@/lib/navigation";
import { PAGE_TITLE } from "@/lib/pageTitles";
import { readState, routeTo } from "@/lib/routes";
import type { ReportListParams, ReportSummary } from "@/types/api";

const linkClass =
  "inline-flex min-h-11 items-center rounded-md font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-0";
const selectClass =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";

const COLUMNS: Column<ReportSummary>[] = [
  {
    id: "title",
    header: REPORT_TEXT.columnTitle,
    cell: (r) => (
      <Link className={linkClass} to={routeTo.report(r.id)}>
        {r.title}
      </Link>
    ),
  },
  { id: "area", header: REPORT_TEXT.columnArea, cell: (r) => r.area_name },
  { id: "period", header: REPORT_TEXT.columnPeriod, cell: (r) => `${formatDate(r.period.from)} – ${formatDate(r.period.to)}` },
  { id: "source", header: REPORT_TEXT.columnSource, cell: (r) => SOURCE_LABEL[r.source] },
  { id: "created", header: REPORT_TEXT.columnCreated, cell: (r) => formatDateTime(r.created_at) },
  { id: "creator", header: REPORT_TEXT.columnCreator, cell: (r) => r.created_by.username },
];

/**
 * The report list (Requirement 15.6) with the "Create report" dialog (15.1). Opened from an
 * area page, the dialog starts open with that area fixed.
 */
export default function ReportListPage(): JSX.Element {
  const { roles } = useCurrentPrincipal();
  const admin = isAdmin(roles);
  // The demo is read-only, so it offers no report creation.
  const canCreate = !useDemo().active;
  const location = useLocation();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [areaFilter, setAreaFilter] = useState("");
  const [creatorInput, setCreatorInput] = useState("");
  const [creator, setCreator] = useState("");
  const params: ReportListParams = { limit: REPORT_PAGE_SIZE, offset };
  if (areaFilter) params.area_id = areaFilter;
  if (admin && creator) params.created_by = creator;
  const list = useReportList(params);
  const areas = useReportAreas(true);

  const fromArea = readState(location.state, "createForArea");
  const fromAreaName = readState(location.state, "areaName");
  const [dialog, setDialog] = useState<{ open: boolean; fixed?: { id: string; name: string } | undefined }>(() =>
    fromArea ? { open: true, fixed: { id: fromArea, name: fromAreaName ?? fromArea } } : { open: false },
  );
  // Clear the router state, so going back to this page does not reopen the dialog.
  useEffect(() => {
    if (fromArea) void navigate(location.pathname, { replace: true, state: null });
  }, [fromArea, location.pathname, navigate]);

  function applyCreator(event: FormEvent): void {
    event.preventDefault();
    setCreator(creatorInput.trim());
    setOffset(0);
  }

  let body: JSX.Element;
  if (list.isError && !list.data) {
    body = <RegionError error={list.error} context={REPORT_TEXT.listError} onRetry={() => void list.refetch()} retrying={list.isFetching} />;
  } else if (!list.data) {
    body = <RegionSkeleton rows={6} />;
  } else if (list.data.items.length === 0) {
    body = <EmptyState noun="reports" message={REPORT_TEXT.empty} />;
  } else {
    body = (
      <div className="space-y-2">
        {list.isError && <RegionError error={list.error} context={REPORT_TEXT.listError} onRetry={() => void list.refetch()} retrying={list.isFetching} />}
        {/* Newest first, in the order the Backend returns. */}
        <ResponsiveTable caption={REPORT_TEXT.listCaption} columns={COLUMNS} rows={list.data.items} getRowId={(r) => r.id} />
        <Pagination total={list.data.total} limit={list.data.limit} offset={list.data.offset} disabled={list.isFetching} onOffsetChange={setOffset} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
          {PAGE_TITLE.reports}
        </h1>
        {canCreate && (
          <Button type="button" className="h-11 sm:h-10" onClick={() => setDialog({ open: true })}>
            {REPORT_TEXT.create}
          </Button>
        )}
      </div>

      <div className="grid gap-4 rounded-lg border bg-card p-4 shadow sm:grid-cols-2">
        <FormField id="report-filter-area" label={REPORT_TEXT.filterArea}>
          {(control) => (
            <select
              {...control}
              className={selectClass}
              value={areaFilter}
              onChange={(e) => {
                setAreaFilter(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">{REPORT_TEXT.allAreas}</option>
              {(areas.data?.items ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
        {admin && (
          <form noValidate onSubmit={applyCreator} className="flex items-end gap-2">
            <FormField id="report-filter-creator" label={REPORT_TEXT.filterCreator} className="flex-1">
              {(control) => <Input {...control} value={creatorInput} onChange={(e) => setCreatorInput(e.target.value)} />}
            </FormField>
            <Button type="submit" variant="outline" className="h-11 sm:h-10">
              {REPORT_TEXT.applyFilters}
            </Button>
          </form>
        )}
      </div>

      <section aria-label={REPORT_TEXT.listCaption} aria-busy={list.isFetching} className="min-w-0">
        {body}
      </section>

      {canCreate && (
      <CreateReportDialog
        key={dialog.fixed?.id ?? "any"}
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        fixedArea={dialog.fixed}
      />
      )}
    </div>
  );
}
