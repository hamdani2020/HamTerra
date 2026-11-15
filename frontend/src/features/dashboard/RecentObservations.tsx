import { QualityBadge } from "@/components/common/QualityBadge";
import { RegionError, RegionState } from "@/components/common/RegionState";
import { ResponsiveTable, type Column } from "@/components/common/DataTable";
import { formatCoverage, formatDate, formatNdvi } from "@/lib/format";
import type { Limited } from "@/lib/limiter";
import type { RecentObservationRow } from "@/lib/merge";
import { DASHBOARD_TEXT, recentPartialText, SOURCE_LABEL } from "@/lib/messages";
import type { Area } from "@/types/api";

import { useRecentObservations } from "./hooks";

const COLUMNS: Column<RecentObservationRow>[] = [
  { id: "area", header: DASHBOARD_TEXT.area, cell: (r) => r.areaName },
  { id: "date", header: DASHBOARD_TEXT.date, cell: (r) => formatDate(r.observation.date) },
  { id: "source", header: DASHBOARD_TEXT.source, cell: (r) => SOURCE_LABEL[r.observation.source] },
  { id: "mean", header: DASHBOARD_TEXT.meanNdvi, cell: (r) => formatNdvi(r.observation.ndvi.mean), align: "right" },
  { id: "cloud", header: DASHBOARD_TEXT.cloud, cell: (r) => formatCoverage(r.observation.quality.cloud_coverage_pct), align: "right" },
  {
    id: "coverage",
    header: DASHBOARD_TEXT.dataCoverage,
    cell: (r) => formatCoverage(r.observation.quality.data_coverage_pct),
    align: "right",
  },
  { id: "quality", header: DASHBOARD_TEXT.quality, cell: (r) => <QualityBadge level={r.observation.quality.level} /> },
];

/** The merged table of Requirement 7.4, at most 10 rows, newest first. */
export function RecentObservations({ areas, limiter }: { areas: readonly Area[]; limiter: Limited }): JSX.Element {
  const recent = useRecentObservations(areas, limiter);
  const query = {
    data: recent.rows,
    error: recent.error,
    isPending: recent.isPending,
    isError: recent.rows === undefined && recent.failed > 0,
    isFetching: recent.isFetching,
    refetch: recent.refetchFailed,
  };
  return (
    <div className="space-y-3">
      <h2 id="recent-title" className="text-lg font-semibold text-foreground">
        {DASHBOARD_TEXT.recentTitle}
      </h2>
      <RegionState
        query={query}
        label={DASHBOARD_TEXT.recentTitle}
        isEmpty={(rows) => rows.length === 0}
        empty={{ noun: DASHBOARD_TEXT.recentEmpty }}
      >
        {(rows) => (
          <div className="space-y-3">
            {recent.failed > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-status-warning">{recentPartialText(recent.failed)}</p>
                <RegionError error={recent.error} onRetry={recent.refetchFailed} retrying={recent.isFetching} />
              </div>
            )}
            <ResponsiveTable
              caption={DASHBOARD_TEXT.recentTitle}
              columns={COLUMNS}
              rows={rows}
              getRowId={(r) => r.observation.id}
            />
          </div>
        )}
      </RegionState>
    </div>
  );
}
