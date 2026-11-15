import { History } from "lucide-react";

import { EvidenceNote } from "@/components/common/EvidenceNote";
import { QualityBadge } from "@/components/common/QualityBadge";
import { StatusBadge } from "@/components/common/StatusBadge";
import { VerbatimText } from "@/components/common/VerbatimText";
import { PreviewControl } from "@/features/map/PreviewControl";
import type { PreviewOverlayState } from "@/features/map/usePreviewOverlay";
import { formatCoverage, formatDate, formatNdvi } from "@/lib/format";
import { OBSERVATION_TEXT, SOURCE_LABEL, WARNING_TEXT, warningText } from "@/lib/messages";
import type { NdviStats, Observation } from "@/types/api";

/** What the detail needs to drive the map's preview overlay. */
export interface PreviewBinding {
  state: PreviewOverlayState;
  available: boolean;
  onShow: () => void;
  onRemove: () => void;
  onOpacity: (percent: number) => void;
}

const IDLE: PreviewOverlayState = { activeId: null, active: null, pendingId: null, errorId: null, error: null, opacity: 70 };

const OPTIONAL_STATS: readonly { key: Exclude<keyof NdviStats, "mean">; label: string }[] = [
  { key: "min", label: OBSERVATION_TEXT.min },
  { key: "max", label: OBSERVATION_TEXT.max },
  { key: "std", label: OBSERVATION_TEXT.std },
  { key: "median", label: OBSERVATION_TEXT.median },
];

/** The quality notes to list: the Backend warnings, plus the unknown-coverage text when missing (9.3). */
export function qualityNotes(observation: Observation): string[] {
  const notes = observation.quality.warnings.map(warningText);
  const hasCoverageWarning = observation.quality.warnings.some((w) => w.code === "DATA_COVERAGE_UNKNOWN");
  if (observation.quality.data_coverage_pct === null && !hasCoverageWarning) notes.push(WARNING_TEXT.DATA_COVERAGE_UNKNOWN);
  return notes;
}

/**
 * One observation (Requirement 9.1 to 9.5, 9.9). Values are shown as received: the
 * quality level and warnings come from the Backend, statistics that are null are left
 * out, and cloud and data coverage are separate values.
 */
export function ObservationDetail({ observation, preview = null }: { observation: Observation; preview?: PreviewBinding | null }): JSX.Element {
  const { ndvi, quality } = observation;
  const notes = qualityNotes(observation);
  const titleId = `observation-${observation.id}`;
  return (
    <article aria-labelledby={titleId} className="space-y-4 rounded-lg border bg-card p-4 shadow">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={titleId} className="font-semibold text-foreground">
          {formatDate(observation.date)} · {SOURCE_LABEL[observation.source]}
        </h3>
        <QualityBadge level={quality.level} />
      </header>

      {observation.geometry_status === "stale_geometry" && (
        <div className="space-y-1">
          <StatusBadge tone="warning" icon={History} label={OBSERVATION_TEXT.staleBadge} />
          <p className="text-sm text-ink-muted">{OBSERVATION_TEXT.staleText}</p>
        </div>
      )}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-muted">{OBSERVATION_TEXT.date}</dt>
        <dd className="text-foreground">{formatDate(observation.date)}</dd>
        <dt className="text-ink-muted">{OBSERVATION_TEXT.source}</dt>
        <dd className="text-foreground">{SOURCE_LABEL[observation.source]}</dd>
        <dt className="text-ink-muted">{OBSERVATION_TEXT.mean}</dt>
        <dd className="font-medium tabular-nums text-foreground">{formatNdvi(ndvi.mean)}</dd>
        {OPTIONAL_STATS.filter(({ key }) => ndvi[key] !== null).map(({ key, label }) => (
          <div key={key} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="tabular-nums text-foreground">{formatNdvi(ndvi[key])}</dd>
          </div>
        ))}
        {/* Two separate values; a missing data coverage is never derived from cloud (20.6). */}
        <dt className="text-ink-muted">{OBSERVATION_TEXT.cloud}</dt>
        <dd className="tabular-nums text-foreground">{formatCoverage(quality.cloud_coverage_pct)}</dd>
        <dt className="text-ink-muted">{OBSERVATION_TEXT.dataCoverage}</dt>
        <dd className="tabular-nums text-foreground">{formatCoverage(quality.data_coverage_pct)}</dd>
        <dt className="text-ink-muted">{OBSERVATION_TEXT.quality}</dt>
        <dd>
          <QualityBadge level={quality.level} />
        </dd>
      </dl>

      {notes.length > 0 && (
        <section aria-label={OBSERVATION_TEXT.qualityWarnings} className="text-sm">
          <p className="font-medium text-foreground">{OBSERVATION_TEXT.qualityWarnings}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-status-warning">
            {notes.map((text, i) => (
              <VerbatimText key={`${i}-${text}`} as="li" text={text} />
            ))}
          </ul>
        </section>
      )}

      <section aria-label={OBSERVATION_TEXT.preview} className="space-y-2">
        <PreviewControl
          observation={observation}
          state={preview?.state ?? IDLE}
          available={preview?.available ?? false}
          onShow={preview?.onShow ?? (() => undefined)}
          onRemove={preview?.onRemove ?? (() => undefined)}
          onOpacity={preview?.onOpacity ?? (() => undefined)}
        />
      </section>

      <EvidenceNote kind="aggregate" />
    </article>
  );
}
