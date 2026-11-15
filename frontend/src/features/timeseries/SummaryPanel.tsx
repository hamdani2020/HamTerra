import { formatDate, formatInteger, formatNdvi, formatSigned } from "@/lib/format";
import { EVIDENCE_TEXT, TIME_SERIES_TEXT } from "@/lib/messages";
import type { TimeSeriesSummary } from "@/types/api";

const na = EVIDENCE_TEXT.notAvailable;

/** The Backend summary as received; "Not available" for each null (Requirement 10.10). */
export function SummaryPanel({ summary }: { summary: TimeSeriesSummary }): JSX.Element {
  const rows: [string, string][] = [
    [TIME_SERIES_TEXT.count, formatInteger(summary.count)],
    [TIME_SERIES_TEXT.firstDate, summary.first_date ? formatDate(summary.first_date) : na],
    [TIME_SERIES_TEXT.lastDate, summary.last_date ? formatDate(summary.last_date) : na],
    [TIME_SERIES_TEXT.min, formatNdvi(summary.min)],
    [TIME_SERIES_TEXT.max, formatNdvi(summary.max)],
    [TIME_SERIES_TEXT.meanOfMeans, formatNdvi(summary.mean_of_means)],
    [EVIDENCE_TEXT.trendLabel, summary.trend_per_30d === null ? na : formatSigned(summary.trend_per_30d, 4)],
  ];
  return (
    <section aria-labelledby="ts-summary" className="space-y-2 rounded-lg border bg-card p-4 shadow">
      <h2 id="ts-summary" className="font-semibold text-foreground">
        {TIME_SERIES_TEXT.summary}
      </h2>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm" data-testid="ts-summary">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="text-right tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
