import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { useId } from "react";

import { EvidenceNote } from "@/components/common/EvidenceNote";
import { FlagBadge } from "@/components/common/FlagBadge";
import { QualityBadge } from "@/components/common/QualityBadge";
import { VerbatimText } from "@/components/common/VerbatimText";
import { WarningBanner } from "@/components/common/WarningBanner";
import { WeatherCell } from "@/features/timeseries/WeatherCell";
import { formatCoverage, formatDate, formatDays, formatNdvi, formatPercentDifference, formatSigned } from "@/lib/format";
import {
  COMPARISON_FLAG_LABEL,
  COMPARISON_TEXT,
  EVIDENCE_TEXT,
  flagDescription,
  OBSERVATION_TEXT,
  SOURCE_LABEL,
  warningText,
} from "@/lib/messages";
import type { ComparisonResult, Observation, WeatherContext } from "@/types/api";

function ObservationSummaryCard({ title, observation }: { title: string; observation: Observation }): JSX.Element {
  const { ndvi, quality } = observation;
  return (
    <article aria-label={title} className="space-y-2 rounded-lg border bg-card p-4 shadow">
      <h3 className="font-semibold text-foreground">{title}</h3>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-muted">{OBSERVATION_TEXT.date}</dt>
        <dd>{formatDate(observation.date)}</dd>
        <dt className="text-ink-muted">{OBSERVATION_TEXT.source}</dt>
        <dd>{SOURCE_LABEL[observation.source]}</dd>
        <dt className="text-ink-muted">{OBSERVATION_TEXT.mean}</dt>
        <dd className="tabular-nums">{formatNdvi(ndvi.mean)}</dd>
        {ndvi.median !== null && (
          <>
            <dt className="text-ink-muted">{OBSERVATION_TEXT.median}</dt>
            <dd className="tabular-nums">{formatNdvi(ndvi.median)}</dd>
          </>
        )}
        <dt className="text-ink-muted">{OBSERVATION_TEXT.cloud}</dt>
        <dd className="tabular-nums">{formatCoverage(quality.cloud_coverage_pct)}</dd>
        <dt className="text-ink-muted">{OBSERVATION_TEXT.dataCoverage}</dt>
        <dd className="tabular-nums">{formatCoverage(quality.data_coverage_pct)}</dd>
        <dt className="text-ink-muted">{OBSERVATION_TEXT.quality}</dt>
        <dd>
          <QualityBadge level={quality.level} />
        </dd>
      </dl>
    </article>
  );
}

/** A neutral sign marker: direction only, never good or bad, never a status colour (11.14). */
function SignIndicator({ value }: { value: number }): JSX.Element {
  const [Icon, label] =
    value > 0 ? [ArrowUp, COMPARISON_TEXT.increase] : value < 0 ? [ArrowDown, COMPARISON_TEXT.decrease] : [Minus, COMPARISON_TEXT.noChange];
  return (
    <span className="inline-flex items-center gap-1 text-sm text-ink-muted">
      <Icon aria-hidden="true" className="h-4 w-4" />
      {label}
    </span>
  );
}

function WeatherBlock({ title, weather }: { title: string; weather: WeatherContext | null }): JSX.Element | null {
  if (!weather) return null;
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-medium text-foreground">{title}</h4>
      <WeatherCell weather={weather} />
    </div>
  );
}

/**
 * A comparison exactly as the Backend returned it (Requirement 11.7 to 11.13): values are
 * formatted for display only, and the flag, quality, warnings and summary are not recomputed.
 */
export function ComparisonResultView({ result, titleAs: Title = "h2" }: { result: ComparisonResult; titleAs?: "h2" | "h3" }): JSX.Element {
  const signed = formatSigned(result.ndvi_diff, 4);
  const threshold = formatNdvi(result.thresholds_applied.ndvi_diff);
  const weather = result.weather;
  const id = useId();
  // The comparison's own warnings and its quality warnings, each code once.
  const seen = new Set<string>();
  const notices = [...result.warnings, ...result.quality.warnings].filter((w) => !seen.has(w.code) && seen.add(w.code)).map(warningText);
  return (
    <section aria-labelledby={`${id}-comparison-result`} className="space-y-4">
      <Title id={`${id}-comparison-result`} className="text-lg font-semibold text-foreground">
        {COMPARISON_TEXT.resultTitle}
      </Title>
      <EvidenceNote kind="aggregate" />
      <div className="grid gap-4 md:grid-cols-2">
        <ObservationSummaryCard title={COMPARISON_TEXT.dateA} observation={result.a} />
        <ObservationSummaryCard title={COMPARISON_TEXT.dateB} observation={result.b} />
      </div>

      <div className="space-y-3 rounded-lg border bg-card p-4 shadow">
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm" data-testid="comparison-values">
          <dt className="text-ink-muted">{COMPARISON_TEXT.difference}</dt>
          <dd className="text-right">
            <span className="text-lg font-semibold tabular-nums text-foreground" data-testid="ndvi-diff">
              {signed}
            </span>{" "}
            <SignIndicator value={result.ndvi_diff} />
          </dd>
          <dt className="text-ink-muted">{COMPARISON_TEXT.percent}</dt>
          <dd className="text-right tabular-nums" data-testid="ndvi-diff-pct">
            {formatPercentDifference(result.ndvi_diff_pct)}
          </dd>
          <dt className="text-ink-muted">{COMPARISON_TEXT.interval}</dt>
          <dd className="text-right tabular-nums" data-testid="interval">
            {formatDays(result.interval_days)}
          </dd>
          <dt className="text-ink-muted">{COMPARISON_TEXT.flag}</dt>
          <dd className="text-right">
            <FlagBadge flag={result.flag} label={COMPARISON_FLAG_LABEL[result.flag]} />
          </dd>
        </dl>
        {/* A numeric difference against a threshold, never a finding (20.2). */}
        <p className="text-sm text-ink-muted">{flagDescription(result.flag, signed, threshold)}</p>
        <div>
          <p className="text-sm font-medium text-foreground">{COMPARISON_TEXT.thresholdsApplied}</p>
          <dl className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-sm">
            <dt className="text-ink-muted">{COMPARISON_TEXT.thresholdNdvi}</dt>
            <dd className="text-right tabular-nums">{threshold}</dd>
            <dt className="text-ink-muted">{COMPARISON_TEXT.thresholdCloud}</dt>
            <dd className="text-right tabular-nums">{formatCoverage(result.thresholds_applied.max_cloud)}</dd>
            <dt className="text-ink-muted">{COMPARISON_TEXT.thresholdCoverage}</dt>
            <dd className="text-right tabular-nums">{formatCoverage(result.thresholds_applied.min_data_coverage)}</dd>
          </dl>
        </div>
      </div>

      <section aria-labelledby={`${id}-comparison-summary`} className="space-y-2 rounded-lg border bg-card p-4 shadow">
        <h3 id={`${id}-comparison-summary`} className="font-semibold text-foreground">
          {COMPARISON_TEXT.summary}
        </h3>
        <VerbatimText text={result.summary_text} className="text-foreground" />
        {!result.spatial_analysis_available && <p className="text-sm text-ink-muted">{EVIDENCE_TEXT.spatialUnavailable}</p>}
      </section>

      <div className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-muted">{COMPARISON_TEXT.quality}:</span>
          <QualityBadge level={result.quality.level} />
        </p>
        <WarningBanner title={COMPARISON_TEXT.notices} messages={notices} />
      </div>

      {weather && (weather.a || weather.b || weather.between) && (
        <section aria-labelledby={`${id}-comparison-weather`} className="space-y-3 rounded-lg border bg-card p-4 shadow">
          <h3 id={`${id}-comparison-weather`} className="font-semibold text-foreground">
            {COMPARISON_TEXT.weatherTitle}
          </h3>
          <div className="grid gap-4 md:grid-cols-3">
            <WeatherBlock title={COMPARISON_TEXT.weatherA} weather={weather.a} />
            <WeatherBlock title={COMPARISON_TEXT.weatherB} weather={weather.b} />
            <WeatherBlock title={COMPARISON_TEXT.weatherBetween} weather={weather.between} />
          </div>
        </section>
      )}

      <section aria-labelledby={`${id}-comparison-limitations`} className="space-y-2 rounded-lg border bg-card p-4 shadow">
        <h3 id={`${id}-comparison-limitations`} className="font-semibold text-foreground">
          {COMPARISON_TEXT.limitations}
        </h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {result.limitations.map((text, i) => (
            <VerbatimText key={`${i}-${text}`} as="li" text={text} />
          ))}
        </ul>
      </section>
    </section>
  );
}
