import { Link, useParams, useSearchParams } from "react-router";

import { EmptyState, RegionError, RegionSkeleton } from "@/components/common/RegionState";
import { EvidenceNote } from "@/components/common/EvidenceNote";
import { VerbatimText } from "@/components/common/VerbatimText";
import { WarningBanner } from "@/components/common/WarningBanner";
import { ApiError } from "@/core/api/errors";
import { useCurrentPrincipal } from "@/core/auth/principal";
import { useArea } from "@/features/map/hooks";
import { FilterForm } from "@/features/timeseries/FilterForm";
import { useLatestSource, useTimeSeries } from "@/features/timeseries/hooks";
import { NdviChart } from "@/features/timeseries/NdviChart";
import { PointsTable } from "@/features/timeseries/PointsTable";
import { SummaryPanel } from "@/features/timeseries/SummaryPanel";
import { excludedByCloudText, resolutionText, TIME_SERIES_TEXT } from "@/lib/messages";
import { PAGE_TITLE } from "@/lib/pageTitles";
import { hasPermission, PERMISSION } from "@/lib/permissions";
import { ROUTES, routeTo } from "@/lib/routes";
import { chartPoints, filtersFromSearch, filtersToSearch, seriesNotices, validateTimeSeriesFilters } from "@/lib/timeseries";
import type { TimeSeriesResponse } from "@/types/api";

const linkClass =
  "inline-flex min-h-11 items-center rounded-md font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-0";

const isNotFound = (error: unknown): boolean => error instanceof ApiError && error.status === 404;

function Results({ response, areaId, showWeather }: { response: TimeSeriesResponse; areaId: string; showWeather: boolean }): JSX.Element {
  const { permissions } = useCurrentPrincipal();
  const points = chartPoints(response);
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        {resolutionText(response.meta.resolution_class)}
        {response.meta.excluded_by_cloud > 0 && ` · ${excludedByCloudText(response.meta.excluded_by_cloud)}`}
      </p>
      {/* Weather warnings appear here as notices, never as an error state (10.17). */}
      <WarningBanner title={TIME_SERIES_TEXT.notices} messages={seriesNotices(response)} />
      {points.length === 0 ? (
        <EmptyState
          noun="observations"
          message={TIME_SERIES_TEXT.empty}
          {...(hasPermission(permissions, PERMISSION.refreshObservations)
            ? {
                action: (
                  <Link className={linkClass} to={routeTo.area(areaId)}>
                    {TIME_SERIES_TEXT.refresh}
                  </Link>
                ),
              }
            : {})}
        />
      ) : (
        <>
          <NdviChart points={points} />
          <PointsTable points={points} showWeather={showWeather} />
        </>
      )}
      <SummaryPanel summary={response.summary} />
      <section aria-labelledby="ts-limitations" className="space-y-2 rounded-lg border bg-card p-4 shadow">
        <h2 id="ts-limitations" className="font-semibold text-foreground">
          {TIME_SERIES_TEXT.limitations}
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {response.limitations.map((text, i) => (
            <VerbatimText key={`${i}-${text}`} as="li" text={text} />
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The NDVI time series for one area and one sensor (Requirement 10). */
export default function TimeSeriesPage(): JSX.Element {
  const { areaId = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const applied = filtersFromSearch(search);
  const area = useArea(areaId);
  const latest = useLatestSource(areaId, applied.source === null);

  // The URL's source, else the newest observation's sensor, else none (10.3, 10.4).
  const preselected = applied.source ?? latest.data ?? null;
  const effective = preselected ? { ...applied, source: preselected } : null;
  const validated = effective ? validateTimeSeriesFilters(effective) : null;
  const params = validated?.ok ? validated.params : null;
  const series = useTimeSeries(areaId, params);

  const notFound = isNotFound(area.error) || isNotFound(series.error) || isNotFound(latest.error);
  const waitingForSource = applied.source === null && latest.isPending;

  let results: JSX.Element;
  if (notFound) {
    results = (
      <div role="alert" className="space-y-2 rounded-lg border bg-card p-4 shadow">
        <p className="text-foreground">{TIME_SERIES_TEXT.notFound}</p>
        <Link className={linkClass} to={ROUTES.areas}>
          {TIME_SERIES_TEXT.toAreas}
        </Link>
      </div>
    );
  } else if (waitingForSource) {
    results = <RegionSkeleton rows={4} />;
  } else if (!params) {
    results = <p className="rounded-md border bg-card p-4 text-foreground">{TIME_SERIES_TEXT.chooseSource}</p>;
  } else if (series.isError) {
    // No chart for a failed request; the filters stay as entered (10.20).
    results = (
      <RegionError
        error={series.error}
        context={TIME_SERIES_TEXT.errorContext}
        onRetry={() => void series.refetch()}
        retrying={series.isFetching}
      />
    );
  } else if (series.data) {
    results = <Results response={series.data} areaId={areaId} showWeather={params.include_weather === true} />;
  } else {
    results = (
      <div>
        <p className="sr-only">{TIME_SERIES_TEXT.loading}</p>
        <RegionSkeleton rows={6} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
          {PAGE_TITLE.timeSeries}
        </h1>
        {area.data && (
          <p className="text-ink-muted">
            <Link className={linkClass} to={routeTo.area(areaId)}>
              {area.data.name}
            </Link>
          </p>
        )}
        <EvidenceNote kind="aggregate" />
      </header>
      <FilterForm
        key={effective?.source ?? "none"}
        initial={effective ?? applied}
        onApply={(filters) => setSearch(filtersToSearch(filters))}
      />
      <section aria-label={TIME_SERIES_TEXT.chartTitle} aria-busy={waitingForSource || (params !== null && series.isPending)} className="min-w-0">
        {results}
      </section>
    </div>
  );
}
