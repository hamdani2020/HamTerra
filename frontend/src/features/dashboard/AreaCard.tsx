import { Link } from "react-router";

import { FlagBadge } from "@/components/common/FlagBadge";
import { QualityBadge } from "@/components/common/QualityBadge";
import { RegionError, RegionSkeleton } from "@/components/common/RegionState";
import { VerbatimText } from "@/components/common/VerbatimText";
import { useSessionComparison } from "@/features/comparison/sessionComparisons";
import { formatDate, formatHectares, formatInteger, formatNdvi, formatSigned } from "@/lib/format";
import type { Limited } from "@/lib/limiter";
import { DASHBOARD_TEXT, SOURCE_LABEL, WARNING_TEXT, warningText } from "@/lib/messages";
import { routeTo } from "@/lib/routes";
import type { Area, TimeSeriesResponse } from "@/types/api";

import { useCardObservations, useCardTimeSeries } from "./hooks";

function Summary({ series }: { series: TimeSeriesResponse }): JSX.Element {
  const latest = series.points.at(-1);
  const trend = series.summary.trend_per_30d;
  const warnings = series.warnings.map(warningText);
  // A null trend always carries the insufficient-observations text (Requirement 7.3).
  if (trend === null && !series.warnings.some((w) => w.code === "INSUFFICIENT_OBSERVATIONS")) {
    warnings.unshift(WARNING_TEXT.INSUFFICIENT_OBSERVATIONS);
  }
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-muted">{DASHBOARD_TEXT.latestMean}</dt>
        <dd className="text-right font-medium tabular-nums text-foreground">{formatNdvi(latest?.ndvi_mean)}</dd>
        <dt className="text-ink-muted">{DASHBOARD_TEXT.trend}</dt>
        <dd className="text-right font-medium tabular-nums text-foreground">
          {trend === null ? DASHBOARD_TEXT.notEnoughObservations : formatSigned(trend, 4)}
        </dd>
        <dt className="text-ink-muted">{DASHBOARD_TEXT.points}</dt>
        <dd className="text-right tabular-nums text-foreground">{formatInteger(series.summary.count)}</dd>
        {latest && (
          <>
            <dt className="text-ink-muted">{DASHBOARD_TEXT.quality}</dt>
            <dd className="text-right">
              <QualityBadge level={latest.quality.level} />
            </dd>
          </>
        )}
      </dl>
      {warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-status-warning">
          {warnings.map((text, i) => (
            <VerbatimText key={`${i}-${text}`} as="li" text={text} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One area: name, size and latest date from `GET /areas`, then the NDVI summary of the
 * latest observation's sensor. Failures stay on this card (Requirement 7.8).
 */
export function AreaCard({ area, limiter }: { area: Area; limiter: Limited }): JSX.Element {
  const observations = useCardObservations(area, limiter);
  const source = observations.data?.items[0]?.source;
  const series = useCardTimeSeries(area, source, limiter);
  const comparison = useSessionComparison(area.id);
  const hasObservations = area.latest_observation_date !== null;

  let body: JSX.Element;
  if (!hasObservations) {
    body = <p className="text-sm text-ink-muted">{DASHBOARD_TEXT.noObservationsYet}</p>;
  } else if (observations.isError || series.isError) {
    body = (
      <div className="relative z-10">
        <p className="mb-2 text-sm text-foreground">{DASHBOARD_TEXT.cardError}</p>
        <RegionError
          error={observations.error ?? series.error}
          onRetry={() => void (observations.isError ? observations.refetch() : series.refetch())}
          retrying={observations.isFetching || series.isFetching}
        />
      </div>
    );
  } else if (observations.data && observations.data.items.length === 0) {
    body = <p className="text-sm text-ink-muted">{DASHBOARD_TEXT.noObservationsYet}</p>;
  } else if (series.data) {
    body = <Summary series={series.data} />;
  } else {
    body = <RegionSkeleton rows={3} />;
  }

  const busy = hasObservations && !observations.isError && !series.isError && series.data === undefined && !(observations.data?.items.length === 0);
  return (
    <article aria-labelledby={`area-${area.id}`} aria-busy={busy} className="relative flex flex-col gap-3 rounded-lg border bg-card p-4 shadow">
      <header className="space-y-1">
        <h3 id={`area-${area.id}`} className="font-semibold text-foreground [overflow-wrap:anywhere]">
          {/* The link covers the card, so selecting the card opens the area (Requirement 7.10). */}
          <Link
            to={routeTo.area(area.id)}
            className="rounded-sm after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {area.name}
          </Link>
        </h3>
        <p className="text-sm text-ink-muted">
          {formatHectares(area.area_ha)} · {DASHBOARD_TEXT.latestObservation}: {formatDate(area.latest_observation_date)}
          {source && ` · ${SOURCE_LABEL[source]}`}
        </p>
        {comparison && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            {DASHBOARD_TEXT.sessionComparison}: <FlagBadge flag={comparison.flag} />
          </p>
        )}
      </header>
      {body}
    </article>
  );
}
