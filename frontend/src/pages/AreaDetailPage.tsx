import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { EvidenceNote } from "@/components/common/EvidenceNote";
import { RegionError, RegionSkeleton } from "@/components/common/RegionState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { VerbatimText } from "@/components/common/VerbatimText";
import { ApiError } from "@/core/api/errors";
import { useCurrentPrincipal } from "@/core/auth/principal";
import { Button } from "@/components/ui/button";
import { useRefreshObservations } from "@/features/areas/hooks";
import { ObservationHistory } from "@/features/areas/ObservationHistory";
import { RefreshDialog } from "@/features/areas/RefreshDialog";
import { useArea } from "@/features/map/hooks";
import type { MapController } from "@/features/map/useMap";
import { formatDate, formatDateTime, formatHectares } from "@/lib/format";
import { AREA_TEXT, REFRESH_TEXT } from "@/lib/messages";
import { hasPermission, PERMISSION } from "@/lib/permissions";
import { PAGE_TITLE } from "@/lib/pageTitles";
import { ROUTES, routeTo, type ReportListState } from "@/lib/routes";

// MapLibre is fetched only when an area page opens (frontend design, Performance).
const AreaMiniMap = lazy(() => import("@/features/areas/AreaMiniMap"));

const linkClass =
  "inline-flex min-h-11 items-center rounded-md font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-0";

/** One monitoring area with its observation history (Requirement 12.8 to 12.14). */
export default function AreaDetailPage(): JSX.Element {
  const { areaId = "" } = useParams();
  const area = useArea(areaId);
  const [controller, setController] = useState<MapController | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const onMapReady = useCallback((c: MapController | null) => setController(c), []);
  const { permissions } = useCurrentPrincipal();
  const canRefresh = hasPermission(permissions, PERMISSION.refreshObservations);
  const refresh = useRefreshObservations(areaId);
  const [refreshOpen, setRefreshOpen] = useState(false);
  // A result that arrived while the dialog was closed is announced until it is opened.
  const [resultSeen, setResultSeen] = useState(true);
  const openRefresh = (open: boolean) => {
    setRefreshOpen(open);
    if (open) setResultSeen(true);
  };
  const settled = refresh.isSuccess || refresh.isError;
  useEffect(() => {
    if (settled && !refreshOpen) setResultSeen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a request settles
  }, [settled, refresh.submittedAt]);

  if (area.isError) {
    if (area.error instanceof ApiError && area.error.status === 404) {
      return (
        <div className="space-y-4">
          <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
            {PAGE_TITLE.area}
          </h1>
          <div role="alert" className="space-y-2 rounded-lg border bg-card p-4 shadow">
            <p className="text-foreground">{AREA_TEXT.notFound}</p>
            <Link className={linkClass} to={ROUTES.areas}>
              {AREA_TEXT.toList}
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
          {PAGE_TITLE.area}
        </h1>
        <RegionError error={area.error} onRetry={() => void area.refetch()} retrying={area.isFetching} />
      </div>
    );
  }
  if (!area.data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
          {PAGE_TITLE.area}
        </h1>
        <RegionSkeleton rows={6} />
      </div>
    );
  }

  const a = area.data;
  const archived = a.status === "archived";
  const reportState: ReportListState = { createForArea: a.id, areaName: a.name };
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground [overflow-wrap:anywhere]">
            {a.name}
          </h1>
          <StatusBadge tone={archived ? "neutral" : "success"} label={archived ? AREA_TEXT.statusArchived : AREA_TEXT.statusActive} />
        </div>
        <EvidenceNote kind="aggregate" />
        {/* Kept for archived areas too (Requirement 12.12). */}
        {canRefresh && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={() => openRefresh(true)}>
              {REFRESH_TEXT.open}
            </Button>
            {!refreshOpen && refresh.isPending && (
              <p role="status" className="text-sm text-ink-muted">
                {REFRESH_TEXT.backgroundRunning}
              </p>
            )}
            {!refreshOpen && !resultSeen && settled && (
              <p role="status" className="text-sm text-ink-muted">
                {REFRESH_TEXT.backgroundDone}
              </p>
            )}
          </div>
        )}
        <nav aria-label={a.name} className="flex flex-wrap gap-x-4 gap-y-1">
          <Link className={linkClass} to={routeTo.areaTimeSeries(a.id)}>
            {AREA_TEXT.timeSeries}
          </Link>
          <Link className={linkClass} to={routeTo.areaCompare(a.id)}>
            {AREA_TEXT.compare}
          </Link>
          <Link className={linkClass} to={ROUTES.reports} state={reportState}>
            {AREA_TEXT.createReport}
          </Link>
        </nav>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] content-start gap-x-4 gap-y-2 rounded-lg border bg-card p-4 text-sm shadow">
          <dt className="text-ink-muted">{AREA_TEXT.description}</dt>
          <dd>{a.description ? <VerbatimText as="span" text={a.description} /> : <span className="text-ink-muted">{AREA_TEXT.noDescription}</span>}</dd>
          <dt className="text-ink-muted">{AREA_TEXT.status}</dt>
          <dd>{archived ? AREA_TEXT.statusArchived : AREA_TEXT.statusActive}</dd>
          <dt className="text-ink-muted">{AREA_TEXT.size}</dt>
          <dd>{formatHectares(a.area_ha)}</dd>
          <dt className="text-ink-muted">{AREA_TEXT.latest}</dt>
          <dd>{a.latest_observation_date ? formatDate(a.latest_observation_date) : AREA_TEXT.noObservations}</dd>
          <dt className="text-ink-muted">{AREA_TEXT.created}</dt>
          <dd>{formatDateTime(a.created_at)}</dd>
          <dt className="text-ink-muted">{AREA_TEXT.updated}</dt>
          <dd>{formatDateTime(a.updated_at)}</dd>
        </dl>
        <Suspense fallback={<RegionSkeleton rows={4} />}>
          <AreaMiniMap area={a} onReady={onMapReady} />
        </Suspense>
      </div>

      {canRefresh && <RefreshDialog open={refreshOpen} onOpenChange={openRefresh} mutation={refresh} />}

      <details
        className="rounded-lg border bg-card p-4 shadow"
        open={historyOpen}
        onToggle={(event) => setHistoryOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-lg font-semibold text-foreground">{AREA_TEXT.history}</summary>
        {/* Rendered only while open, so the history is requested only then (12.9). */}
        {historyOpen && (
          <div className="mt-4">
            <ObservationHistory area={a} controller={controller} />
          </div>
        )}
      </details>
    </div>
  );
}
