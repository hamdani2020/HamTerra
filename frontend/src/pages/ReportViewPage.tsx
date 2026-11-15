import { Download, Printer } from "lucide-react";
import { lazy, type ReactNode, Suspense } from "react";
import { Link, useParams } from "react-router";

import { EvidenceNote } from "@/components/common/EvidenceNote";
import { RegionError, RegionSkeleton } from "@/components/common/RegionState";
import { VerbatimText } from "@/components/common/VerbatimText";
import { WarningBanner } from "@/components/common/WarningBanner";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/core/api/errors";
import { ComparisonResultView } from "@/features/comparison/ComparisonResultView";
import { ObservationsTable, type ObservationRow } from "@/features/observations/ObservationsTable";
import { useReport } from "@/features/reports/hooks";
import { NdviChart } from "@/features/timeseries/NdviChart";
import { SummaryPanel } from "@/features/timeseries/SummaryPanel";
import { WeatherCell } from "@/features/timeseries/WeatherCell";
import { reportBlob, reportFileName, saveBlob } from "@/lib/download";
import { formatCoverage, formatDate, formatDateTime, formatHectares, formatNdvi } from "@/lib/format";
import { COMPARISON_TEXT, REPORT_TEXT, snapshotText, SOURCE_LABEL, warningText } from "@/lib/messages";
import { PAGE_TITLE } from "@/lib/pageTitles";
import { ROUTES } from "@/lib/routes";
import type { ChartPoint } from "@/lib/timeseries";
import type { Area, Report } from "@/types/api";

const StoredMap = lazy(() => import("@/features/areas/AreaMiniMap"));
const noop = () => undefined;

const linkClass =
  "inline-flex min-h-11 items-center rounded-md font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-0";

/** Stored rows as chart points: one sensor, no gaps or weather (the report stores neither). */
export function reportPoints(report: Report): ChartPoint[] {
  return report.observations.map((o) => ({
    date: o.date,
    source: report.source,
    ndvi_mean: o.ndvi_mean,
    cloud_coverage_pct: o.cloud_coverage_pct,
    data_coverage_pct: o.data_coverage_pct,
    quality: o.quality,
    gap_days_from_previous: null,
    weather: null,
  }));
}

function reportRows(report: Report): ObservationRow[] {
  return report.observations.map((o) => ({ key: o.date, date: o.date, source: report.source, ndvi_mean: o.ndvi_mean, cloud_coverage_pct: o.cloud_coverage_pct, data_coverage_pct: o.data_coverage_pct, quality: o.quality }));
}

/** The stored polygon on the shared mini map; only basemap tiles are requested for it. */
function storedArea(report: Report): Area {
  return {
    id: report.area.id,
    name: report.area.name,
    description: null,
    status: "active",
    area_ha: report.area.area_ha,
    geometry: report.area.geometry,
    external_polygon_id: null,
    latest_observation_date: null,
    created_at: report.created_at,
    updated_at: report.created_at,
  };
}

function Section({ id, title, children, print }: { id: string; title: string; children: ReactNode; print?: "show" }): JSX.Element {
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-lg border bg-card p-4 shadow" data-print={print}>
      <h2 id={id} className="text-lg font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ReportBody({ raw, report }: { raw: string; report: Report }): JSX.Element {
  const created = formatDateTime(report.created_at);
  const points = reportPoints(report);
  return (
    <div className="space-y-6" data-print="content">
      <div className="space-y-2">
        <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground [overflow-wrap:anywhere]">
          {report.title}
        </h1>
        {/* The snapshot statement labels the page (Requirement 15.14). */}
        <p className="font-medium text-foreground">{snapshotText(created)}</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">{REPORT_TEXT.createdAt}</dt>
          <dd>{created}</dd>
          <dt className="text-ink-muted">{REPORT_TEXT.author}</dt>
          <dd>{report.created_by.username}</dd>
          <dt className="text-ink-muted">{REPORT_TEXT.area}</dt>
          <dd>{report.area.name}</dd>
          <dt className="text-ink-muted">{REPORT_TEXT.areaSize}</dt>
          <dd>{formatHectares(report.area.area_ha)}</dd>
          <dt className="text-ink-muted">{REPORT_TEXT.period}</dt>
          <dd>
            {formatDate(report.period.from)} – {formatDate(report.period.to)}
          </dd>
          <dt className="text-ink-muted">{REPORT_TEXT.source}</dt>
          <dd>{SOURCE_LABEL[report.source]}</dd>
        </dl>
        <EvidenceNote kind="aggregate" />
        {/* No PDF control (Requirement 15.12). */}
        <div className="flex flex-wrap gap-2" data-print="hide">
          <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={() => saveBlob(reportBlob(raw), reportFileName(report.id))}>
            <Download aria-hidden="true" className="h-4 w-4" />
            {REPORT_TEXT.download}
          </Button>
          <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={() => window.print()}>
            <Printer aria-hidden="true" className="h-4 w-4" />
            {REPORT_TEXT.print}
          </Button>
        </div>
      </div>

      {/* Always on screen and always printed (Requirement 15.10). */}
      <Section id="report-caveats" title={REPORT_TEXT.caveatsSection} print="show">
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground" aria-label={REPORT_TEXT.caveats}>
          {report.caveats.map((text, i) => (
            <VerbatimText key={`c-${i}-${text}`} as="li" text={text} />
          ))}
        </ul>
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground" aria-label={REPORT_TEXT.limitations}>
          {report.limitations.map((text, i) => (
            <VerbatimText key={`l-${i}-${text}`} as="li" text={text} />
          ))}
        </ul>
      </Section>

      <Section id="report-map" title={REPORT_TEXT.mapTitle}>
        <Suspense fallback={<RegionSkeleton rows={3} />}>
          <StoredMap area={storedArea(report)} onReady={noop} />
        </Suspense>
      </Section>

      <Section id="report-observations" title={REPORT_TEXT.observations}>
        {points.length === 0 ? (
          <p className="text-sm text-ink-muted">{REPORT_TEXT.noStoredObservations}</p>
        ) : (
          <>
            <NdviChart points={points} titleAs="h3" />
            <ObservationsTable rows={reportRows(report)} caption={REPORT_TEXT.observations} />
          </>
        )}
      </Section>

      <SummaryPanel summary={report.summary} />
      <WarningBanner title={REPORT_TEXT.notices} messages={report.warnings.map(warningText)} />

      <Section id="report-thresholds" title={REPORT_TEXT.thresholds}>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-sm">
          <dt className="text-ink-muted">{COMPARISON_TEXT.thresholdNdvi}</dt>
          <dd className="text-right tabular-nums">{formatNdvi(report.thresholds_applied.ndvi_diff)}</dd>
          <dt className="text-ink-muted">{COMPARISON_TEXT.thresholdCloud}</dt>
          <dd className="text-right tabular-nums">{formatCoverage(report.thresholds_applied.max_cloud)}</dd>
          <dt className="text-ink-muted">{COMPARISON_TEXT.thresholdCoverage}</dt>
          <dd className="text-right tabular-nums">{formatCoverage(report.thresholds_applied.min_data_coverage)}</dd>
        </dl>
      </Section>

      <Section id="report-comparisons" title={REPORT_TEXT.comparisons}>
        {report.comparisons.length === 0 ? (
          <p className="text-sm text-ink-muted">{REPORT_TEXT.noComparisons}</p>
        ) : (
          <div className="space-y-8">
            {report.comparisons.map((comparison) => (
              <ComparisonResultView
                key={`${comparison.a.date}-${comparison.b.date}`}
                result={comparison}
                titleAs="h3"
                title={`${formatDate(comparison.a.date)} – ${formatDate(comparison.b.date)}`}
              />
            ))}
          </div>
        )}
      </Section>

      {report.weather && (
        <Section id="report-weather" title={REPORT_TEXT.weatherTitle}>
          <WeatherCell weather={report.weather} />
        </Section>
      )}
    </div>
  );
}

/**
 * A stored report (Requirement 15.7 to 15.14). Everything comes from one `format=json`
 * request; the raw text is kept for the download.
 */
export default function ReportViewPage(): JSX.Element {
  const { reportId = "" } = useParams();
  const report = useReport(reportId);
  if (report.isError) {
    // The same state for a missing report and another user's report (15.13).
    if (report.error instanceof ApiError && report.error.status === 404) {
      return (
        <div className="space-y-4">
          <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
            {PAGE_TITLE.report}
          </h1>
          <div role="alert" className="space-y-2 rounded-lg border bg-card p-4 shadow">
            <p className="text-foreground">{REPORT_TEXT.notFound}</p>
            <Link className={linkClass} to={ROUTES.reports}>
              {REPORT_TEXT.toList}
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
          {PAGE_TITLE.report}
        </h1>
        <RegionError error={report.error} context={REPORT_TEXT.loadError} onRetry={() => void report.refetch()} retrying={report.isFetching} />
      </div>
    );
  }
  if (!report.data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
          {PAGE_TITLE.report}
        </h1>
        <RegionSkeleton rows={8} />
      </div>
    );
  }
  return <ReportBody raw={report.data.raw} report={report.data.report} />;
}
