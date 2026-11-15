import {
  ArrowRight,
  CirclePlay,
  Check,
  CloudOff,
  CodeXml,
  ExternalLink,
  GitBranch,
  ChartLine,
  Microscope,
  MonitorPlay,
  Satellite,
  ScanSearch,
  ShieldCheck,
  Sprout,
  Terminal,
  ThermometerSun,
  Timer,
  X,
} from "lucide-react";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { EvidenceNote } from "@/components/common/EvidenceNote";
import { FlagBadge } from "@/components/common/FlagBadge";
import { QualityBadge } from "@/components/common/QualityBadge";
import { VerbatimText } from "@/components/common/VerbatimText";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SignInButton } from "@/features/auth/SignInButton";
import { ComparisonResultView } from "@/features/comparison/ComparisonResultView";
import { NdviChart } from "@/features/timeseries/NdviChart";
import { formatCoverage, formatDate, formatDateTime, formatDays, formatHectares, formatInteger, formatNdvi, formatSigned } from "@/lib/format";
import { SOURCE_LABEL, warningText } from "@/lib/messages";
import { ROUTES } from "@/lib/routes";
import { chartPoints } from "@/lib/timeseries";
import { cn } from "@/lib/utils";
import type { ComparisonResult, Source } from "@/types/api";

import { PITCH_LINKS, PITCH_SECTIONS, PITCH_TEXT, TEAM_MEMBERS } from "./content";
import { FrameCorners } from "./decor";
import type { PitchAccess } from "./PitchLayout";
import { boundingBoxCentre, formatCoordinate, fullyCloudyCount, observationCounts, previewFor, SNAPSHOT, SOURCES, type PitchPreview } from "./snapshot";
import { cardClass, kickerClass, linkClass, sectionClass, titleClass } from "./styles";
import { Reveal, useInView } from "./useInView";

const AreaMiniMap = lazy(() => import("@/features/areas/AreaMiniMap"));

const pixelated = "[image-rendering:pixelated]";
const CENTRE = boundingBoxCentre(SNAPSHOT.area);
const COUNTS = observationCounts(SNAPSHOT);

function SectionHeading({ id, kicker, title, children }: { id: string; kicker: string; title: string; children?: ReactNode }): JSX.Element {
  return (
    <div className="max-w-3xl">
      <p className={kickerClass}>{kicker}</p>
      <h2 id={`${id}-title`} className={titleClass}>
        {title}
      </h2>
      {children && <div className="mt-4 text-lg leading-relaxed text-ink-muted">{children}</div>}
    </div>
  );
}

function ExternalAnchor({ href, children, className }: { href: string; children: ReactNode; className?: string }): JSX.Element {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(linkClass, className)}>
      {children}
      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
      <span className="sr-only">{PITCH_TEXT.opensInNewTab}</span>
    </a>
  );
}

function PreviewImage({ preview, className }: { preview: PitchPreview; className?: string }): JSX.Element {
  const o = preview.observation;
  return (
    <img
      src={preview.url}
      alt={PITCH_TEXT.previewAlt(SOURCE_LABEL[o.source], formatDate(o.date))}
      width={117}
      height={117}
      loading="lazy"
      className={cn("aspect-square w-full object-cover", pixelated, className)}
    />
  );
}

// Hero ---------------------------------------------------------------------------------

/** A contact sheet of the Sentinel-2 previews in the snapshot, with the area facts. */
export function HeroVisual(): JSX.Element {
  const tiles = SNAPSHOT.previews.filter((p) => p.observation.source === "sentinel-2").slice(0, 6);
  return (
    <figure className="space-y-4">
      <div className="rounded-lg border border-brand-700 bg-brand-900 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] uppercase tracking-wider text-brand-100">
          <span>
            {SOURCE_LABEL["sentinel-2"]} · NDVI · {SNAPSHOT.area.name}
          </span>
          {CENTRE && <span>{formatCoordinate(CENTRE)}</span>}
        </div>
        <ul className="grid grid-cols-3 gap-2">
          {tiles.map((p) => (
            <li key={p.file} className="relative overflow-hidden rounded-md border border-brand-700">
              <PreviewImage preview={p} />
              <FrameCorners />
              <span className="absolute inset-x-0 bottom-0 flex justify-between bg-brand-900/85 px-1.5 py-0.5 font-mono text-[10px] text-surface sm:text-[11px]">
                <span>{formatDate(p.observation.date)}</span>
                <span>{formatNdvi(p.observation.ndvi.mean)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="text-sm text-brand-100">
        {PITCH_TEXT.previewCredit} {tiles[0] && <VerbatimText as="span" text={tiles[0].observation.preview.note} />}
      </figcaption>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-brand-700 bg-brand-700 text-center sm:grid-cols-4">
        {[
          [PITCH_TEXT.areaObservations, formatInteger(COUNTS.total)],
          [PITCH_TEXT.areaSize, formatHectares(SNAPSHOT.area.area_ha)],
          [PITCH_TEXT.sensorPicker, `${SOURCES.length}`],
          [PITCH_TEXT.areaPeriod, `${formatDate(SNAPSHOT.period.from)} – ${formatDate(SNAPSHOT.period.to)}`],
        ].map(([term, value]) => (
          <div key={term} className="bg-brand-900 px-3 py-3">
            <dt className="text-xs text-brand-100">{term}</dt>
            <dd className="mt-1 font-mono text-sm font-semibold text-surface">{value}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

// Summary, problem, solution, how it works --------------------------------------------------

function Summary(): JSX.Element {
  return (
    <section aria-label={PITCH_TEXT.summaryLabel} className="border-b bg-surface">
      <dl className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {PITCH_TEXT.summary.map((item, i) => (
          <Reveal key={item.term} className="border-l-2 border-brand-600 pl-4">
            <dt className="font-mono text-xs font-semibold uppercase tracking-wider text-brand-700">
              {String(i + 1).padStart(2, "0")} · {item.term}
            </dt>
            <dd className="mt-2 text-foreground">{item.text}</dd>
          </Reveal>
        ))}
      </dl>
    </section>
  );
}

const PROBLEM_ICONS = [Timer, CloudOff, ScanSearch];

function Problem(): JSX.Element {
  const cloudy = fullyCloudyCount(SNAPSHOT);
  return (
    <section id="problem" aria-labelledby="problem-title" className={sectionClass}>
      <SectionHeading id="problem" kicker={PITCH_TEXT.problemKicker} title={PITCH_TEXT.problemTitle} />
      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ul className="grid gap-4 sm:grid-cols-3">
          {PITCH_TEXT.problemCards.map((card, i) => {
            const Icon = PROBLEM_ICONS[i] ?? ScanSearch;
            return (
              <Reveal as="li" key={card.title} className={cardClass}>
                <Icon aria-hidden="true" className="h-6 w-6 text-brand-700" />
                <h3 className="mt-3 font-semibold text-foreground">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{card.text}</p>
              </Reveal>
            );
          })}
        </ul>
        <Reveal className="flex flex-col justify-center rounded-lg bg-brand-900 p-6 text-surface">
          <p className="font-mono text-5xl font-bold">
            {formatInteger(cloudy)}
            <span className="text-2xl text-brand-100"> / {formatInteger(COUNTS.total)}</span>
          </p>
          <p className="mt-3 text-brand-100">
            {PITCH_TEXT.cloudStatLabel}, {formatDate(SNAPSHOT.period.from)} – {formatDate(SNAPSHOT.period.to)}.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function Solution(): JSX.Element {
  return (
    <section id="solution" aria-labelledby="solution-title" className="scroll-mt-20 border-y bg-surface">
      <div className={sectionClass}>
        <SectionHeading id="solution" kicker={PITCH_TEXT.solutionKicker} title={PITCH_TEXT.solutionTitle}>
          <p>{PITCH_TEXT.solutionIntro}</p>
        </SectionHeading>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Reveal className="rounded-lg border border-brand-600 bg-subtle p-6">
            <h3 className="font-semibold text-brand-900">{PITCH_TEXT.doesTitle}</h3>
            <ul className="mt-4 space-y-3">
              {PITCH_TEXT.does.map((item) => (
                <li key={item} className="flex gap-3">
                  <Check aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal className={cn(cardClass, "p-6")}>
            <h3 className="font-semibold text-foreground">{PITCH_TEXT.neverTitle}</h3>
            <ul className="mt-4 space-y-3">
              {PITCH_TEXT.never.map((item) => (
                <li key={item} className="flex gap-3">
                  <X aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

const STEP_ICONS = [Satellite, ChartLine, ThermometerSun, Microscope];

function HowItWorks(): JSX.Element {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className={sectionClass}>
      <SectionHeading id="how-it-works" kicker={PITCH_TEXT.howKicker} title={PITCH_TEXT.howTitle} />
      <ol className="relative mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <span aria-hidden="true" className="absolute left-0 right-0 top-6 hidden h-px bg-brand-600 lg:block" />
        {PITCH_TEXT.steps.map((step, i) => {
          const Icon = STEP_ICONS[i] ?? Satellite;
          return (
            <Reveal as="li" key={step.title} className="relative">
              <span className="relative flex h-12 w-12 items-center justify-center rounded-full border-2 border-brand-600 bg-surface text-brand-700">
                <Icon aria-hidden="true" className="h-5 w-5" />
              </span>
              <p className="mt-4 font-mono text-xs font-semibold text-brand-700">{String(i + 1).padStart(2, "0")}</p>
              <h3 className="mt-1 text-lg font-semibold text-foreground">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{step.text}</p>
            </Reveal>
          );
        })}
      </ol>
    </section>
  );
}

// Evidence ---------------------------------------------------------------------------------

function AreaPanel(): JSX.Element {
  const { ref, inView, supported } = useInView<HTMLDivElement>();
  const area = SNAPSHOT.area;
  return (
    <div className={cn(cardClass, "grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
      <div ref={ref} className="min-h-[240px] overflow-hidden rounded-md border bg-subtle">
        {/* The map loads only when scrolled into view, so the page stays light. */}
        {supported && inView && (
          <Suspense fallback={null}>
            <AreaMiniMap area={area} onReady={() => undefined} />
          </Suspense>
        )}
      </div>
      <div>
        <h3 className="text-lg font-semibold text-foreground">{PITCH_TEXT.areaTitle}</h3>
        <p className="mt-1 font-medium text-foreground">{area.name}</p>
        <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-ink-muted">{PITCH_TEXT.areaSize}</dt>
          <dd className="font-mono">{formatHectares(area.area_ha)}</dd>
          {CENTRE && (
            <>
              <dt className="text-ink-muted">{PITCH_TEXT.areaCentre}</dt>
              <dd className="font-mono">{formatCoordinate(CENTRE)}</dd>
            </>
          )}
          <dt className="text-ink-muted">{PITCH_TEXT.areaRegistered}</dt>
          <dd className="font-mono [overflow-wrap:anywhere]">{area.external_polygon_id ?? "–"}</dd>
          <dt className="text-ink-muted">{PITCH_TEXT.areaPeriod}</dt>
          <dd>
            {formatDate(SNAPSHOT.period.from)} – {formatDate(SNAPSHOT.period.to)}
          </dd>
          {SOURCES.map((s) => (
            <div key={s} className="contents">
              <dt className="text-ink-muted">
                {PITCH_TEXT.areaObservations}, {SOURCE_LABEL[s]}
              </dt>
              <dd className="font-mono">{formatInteger(COUNTS.bySource[s])}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function SeriesPanel(): JSX.Element {
  const [source, setSource] = useState<Source>("sentinel-2");
  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-foreground">{PITCH_TEXT.seriesTitle}</h3>
      </div>
      <Tabs value={source} onValueChange={(v) => setSource(v as Source)} className="mt-4">
        <TabsList aria-label={PITCH_TEXT.sensorPicker}>
          {SOURCES.map((s) => (
            <TabsTrigger key={s} value={s} className="min-h-11 sm:min-h-9">
              {SOURCE_LABEL[s]}
            </TabsTrigger>
          ))}
        </TabsList>
        {SOURCES.map((s) => {
          const series = SNAPSHOT.timeseries[s];
          const summary = series.summary;
          return (
            <TabsContent key={s} value={s} className="mt-4 space-y-4">
              <NdviChart points={chartPoints(series)} titleAs="h3" />
              <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                {[
                  [PITCH_TEXT.summaryCount, formatInteger(summary.count)],
                  [PITCH_TEXT.summaryMean, formatNdvi(summary.mean_of_means)],
                  [PITCH_TEXT.summaryRange, `${formatNdvi(summary.min)} – ${formatNdvi(summary.max)}`],
                  [PITCH_TEXT.summaryTrend, summary.trend_per_30d === null ? formatNdvi(null) : formatSigned(summary.trend_per_30d, 4)],
                ].map(([term, value]) => (
                  <div key={term} className="rounded-md bg-subtle p-3">
                    <dt className="text-ink-muted">{term}</dt>
                    <dd className="mt-1 font-mono font-semibold text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
              {series.warnings.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-status-warning">
                  {series.warnings.map((w) => (
                    <li key={w.code}>{warningText(w)}</li>
                  ))}
                </ul>
              )}
              <div>
                <h4 className="text-sm font-semibold text-foreground">{PITCH_TEXT.limitationsTitle}</h4>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
                  {series.limitations.map((l) => (
                    <li key={l}>
                      <VerbatimText as="span" text={l} />
                    </li>
                  ))}
                </ul>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

function Gallery(): JSX.Element {
  const [selected, setSelected] = useState(0);
  const current = SNAPSHOT.previews[selected];
  const o = current?.observation;
  return (
    <div className={cn(cardClass, "grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]")}>
      <div>
        <h3 className="text-lg font-semibold text-foreground">{PITCH_TEXT.galleryTitle}</h3>
        <p className="mt-1 text-sm text-ink-muted">{PITCH_TEXT.galleryHint}</p>
        <ul className="mt-4 grid grid-cols-4 gap-2">
          {SNAPSHOT.previews.map((p, i) => (
            <li key={p.file}>
              <button
                type="button"
                aria-pressed={i === selected}
                onClick={() => setSelected(i)}
                className={cn(
                  "block w-full overflow-hidden rounded-md border-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  i === selected ? "border-brand-700" : "border-transparent hover:border-brand-600",
                )}
              >
                <PreviewImage preview={p} />
                <span className="block bg-subtle px-1 py-0.5 text-center font-mono text-[11px] text-foreground">
                  {SOURCE_LABEL[p.observation.source]} · {formatDate(p.observation.date)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {current && o && (
        <div aria-live="polite" className="space-y-4">
          <div className="relative overflow-hidden rounded-md border">
            <PreviewImage preview={current} />
          </div>
          <div>
            <p className="font-semibold text-foreground">
              {SOURCE_LABEL[o.source]} · {formatDate(o.date)}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-muted">{PITCH_TEXT.galleryMean}</dt>
              <dd className="font-mono">{formatNdvi(o.ndvi.mean)}</dd>
              <dt className="text-ink-muted">{PITCH_TEXT.galleryCloud}</dt>
              <dd className="font-mono">{formatCoverage(o.quality.cloud_coverage_pct)}</dd>
              <dt className="text-ink-muted">{PITCH_TEXT.galleryData}</dt>
              <dd className="font-mono">{formatCoverage(o.quality.data_coverage_pct)}</dd>
              <dt className="text-ink-muted">{PITCH_TEXT.galleryQuality}</dt>
              <dd>
                <QualityBadge level={o.quality.level} />
              </dd>
            </dl>
            {o.quality.warnings.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-status-warning">
                {o.quality.warnings.map((w) => (
                  <li key={w.code}>{warningText(w)}</li>
                ))}
              </ul>
            )}
            <VerbatimText className="mt-3 text-xs text-ink-muted" text={o.preview.note} />
          </div>
        </div>
      )}
    </div>
  );
}

function ComparisonCase({ result }: { result: ComparisonResult }): JSX.Element {
  const before = previewFor(SNAPSHOT, result.source, result.a.date);
  const after = previewFor(SNAPSHOT, result.source, result.b.date);
  const seen = new Set<string>();
  const notices = [...result.warnings, ...result.quality.warnings].filter((w) => !seen.has(w.code) && seen.add(w.code));
  let note: string | null = null;
  if (result.flag === "flagged" && result.quality.level === "poor") note = PITCH_TEXT.compareFlaggedNote(formatCoverage(result.quality.cloud_coverage_pct));
  if (result.flag === "not_flagged") note = PITCH_TEXT.compareNotFlaggedNote(formatNdvi(result.thresholds_applied.ndvi_diff));
  return (
    <Reveal as="article" className={cn(cardClass, "flex flex-col gap-4")}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-lg font-semibold text-foreground">{PITCH_TEXT.compareCaseTitle(result.interval_days)}</h4>
        <span className="font-mono text-xs text-ink-muted">{SOURCE_LABEL[result.source]}</span>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        {[
          { obs: result.a, preview: before },
          null,
          { obs: result.b, preview: after },
        ].map((side) =>
          side === null ? (
            <ArrowRight key="arrow" aria-hidden="true" className="h-5 w-5 text-brand-700" />
          ) : (
            <figure key={side.obs.date} className="space-y-1">
              <div className="overflow-hidden rounded-md border">{side.preview && <PreviewImage preview={side.preview} />}</div>
              <figcaption className="text-center font-mono text-xs text-foreground">
                {formatDate(side.obs.date)}
                <br />
                NDVI {formatNdvi(side.obs.ndvi.mean)} · {PITCH_TEXT.galleryCloud} {formatCoverage(side.obs.quality.cloud_coverage_pct)}
              </figcaption>
            </figure>
          ),
        )}
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-md bg-subtle p-3">
          <dt className="text-ink-muted">{PITCH_TEXT.compareDiff}</dt>
          <dd className="mt-1 font-mono text-lg font-semibold text-foreground">{formatSigned(result.ndvi_diff, 4)}</dd>
        </div>
        <div className="rounded-md bg-subtle p-3">
          <dt className="text-ink-muted">{PITCH_TEXT.compareInterval}</dt>
          <dd className="mt-1 font-mono text-lg font-semibold text-foreground">{formatDays(result.interval_days)}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <FlagBadge flag={result.flag} />
        <span className="text-sm text-ink-muted">{PITCH_TEXT.compareQuality}</span>
        <QualityBadge level={result.quality.level} />
      </div>
      <VerbatimText className="text-sm text-foreground" text={result.summary_text} />
      {notices.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-status-warning">
          {notices.map((w) => (
            <li key={w.code}>{warningText(w)}</li>
          ))}
        </ul>
      )}
      {note && <p className="rounded-md border-l-4 border-brand-600 bg-subtle p-3 text-sm text-foreground">{note}</p>}
      <details className="mt-auto rounded-md border p-3 text-sm">
        <summary className="cursor-pointer rounded-sm font-medium text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {PITCH_TEXT.compareFull}
        </summary>
        <div className="mt-3">
          <ComparisonResultView result={result} titleAs="h3" title={`${PITCH_TEXT.compareFull}: ${formatDate(result.a.date)} – ${formatDate(result.b.date)}`} />
        </div>
      </details>
    </Reveal>
  );
}

function Evidence(): JSX.Element {
  return (
    <section id="evidence" aria-labelledby="evidence-title" className="scroll-mt-20 border-y bg-surface">
      <div className={sectionClass}>
        <SectionHeading id="evidence" kicker={PITCH_TEXT.evidenceKicker} title={PITCH_TEXT.evidenceTitle}>
          <p>{PITCH_TEXT.evidenceIntro}</p>
          <p className="mt-2 font-mono text-sm">
            {PITCH_TEXT.snapshotNote}: {formatDateTime(SNAPSHOT.exported_at)}
          </p>
        </SectionHeading>
        <EvidenceNote kind="aggregate" className="mt-4" />
        <div className="mt-10 space-y-6">
          <AreaPanel />
          <SeriesPanel />
          <Gallery />
          <div>
            <h3 className="text-xl font-semibold text-foreground">{PITCH_TEXT.compareTitle}</h3>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              {SNAPSHOT.comparisons.map((c) => (
                <ComparisonCase key={`${c.a.date}-${c.b.date}`} result={c} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// Impact, data, demo, team -------------------------------------------------------------------

const IMPACT_ICONS = [Sprout, ShieldCheck, ScanSearch];

function Impact(): JSX.Element {
  return (
    <section id="impact" aria-labelledby="impact-title" className={sectionClass}>
      <SectionHeading id="impact" kicker={PITCH_TEXT.impactKicker} title={PITCH_TEXT.impactTitle} />
      <ul className="mt-10 grid gap-6 md:grid-cols-3">
        {PITCH_TEXT.impact.map((item, i) => {
          const Icon = IMPACT_ICONS[i] ?? Sprout;
          return (
            <Reveal as="li" key={item.title} className={cn(cardClass, "border-t-4 border-t-brand-600")}>
              <Icon aria-hidden="true" className="h-6 w-6 text-brand-700" />
              <h3 className="mt-3 text-lg font-semibold text-foreground">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{item.text}</p>
            </Reveal>
          );
        })}
      </ul>
    </section>
  );
}

function DataAndTechnology(): JSX.Element {
  return (
    <section id="data" aria-labelledby="data-title" className="scroll-mt-20 border-y bg-surface">
      <div className={sectionClass}>
        <SectionHeading id="data" kicker={PITCH_TEXT.dataKicker} title={PITCH_TEXT.dataTitle} />
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PITCH_TEXT.dataSources.map((d) => (
            <Reveal as="li" key={d.name} className={cn(cardClass, "flex flex-col")}>
              <p className="font-mono text-xs uppercase tracking-wider text-brand-700">{d.by}</p>
              <h3 className="mt-1 text-lg font-semibold text-foreground">{d.name}</h3>
              <p className="mt-2 flex-1 text-sm text-ink-muted">{d.text}</p>
              {d.link && (
                <ExternalAnchor href={PITCH_LINKS[d.link]} className="mt-3 text-sm">
                  {PITCH_TEXT.learnMore}
                  <span className="sr-only">: {d.name}</span>
                </ExternalAnchor>
              )}
            </Reveal>
          ))}
        </ul>
        <h3 className="mt-12 text-lg font-semibold text-foreground">{PITCH_TEXT.stackTitle}</h3>
        <ul className="mt-4 flex flex-wrap gap-2">
          {PITCH_TEXT.stack.map((t) => (
            <li key={t} className="rounded-full border border-brand-600 bg-subtle px-3 py-1 text-sm text-brand-900">
              {t}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function DemoCard({ icon: Icon, title, text, children }: { icon: typeof GitBranch; title: string; text: string; children: ReactNode }): JSX.Element {
  return (
    <Reveal as="li" className={cn(cardClass, "flex flex-col")}>
      <Icon aria-hidden="true" className="h-6 w-6 text-brand-700" />
      <h3 className="mt-3 text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 flex-1 text-sm text-ink-muted">{text}</p>
      <div className="mt-4">{children}</div>
    </Reveal>
  );
}

function Demo({ access }: { access: PitchAccess }): JSX.Element {
  return (
    <section id="demo" aria-labelledby="demo-title" className={sectionClass}>
      <SectionHeading id="demo" kicker={PITCH_TEXT.demoKicker} title={PITCH_TEXT.demoTitle} />
      <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <DemoCard icon={MonitorPlay} title={PITCH_TEXT.demoPlatform} text={PITCH_TEXT.demoPlatformText}>
          {access.kind === "sign_in" && <SignInButton label={PITCH_TEXT.demoPlatformButton} returnTo={access.returnTo} />}
          {access.kind === "signed_in" && (
            <Link to={ROUTES.dashboard} className={linkClass}>
              {PITCH_TEXT.ctaDashboard}
            </Link>
          )}
          {access.kind === "sign_in" && <p className="mt-2 text-xs text-ink-muted">{PITCH_TEXT.accountNote}</p>}
        </DemoCard>
        <DemoCard icon={CodeXml} title={PITCH_TEXT.demoSource} text={PITCH_TEXT.demoSourceText}>
          <ExternalAnchor href={PITCH_LINKS.source}>{PITCH_TEXT.demoSourceLink}</ExternalAnchor>
        </DemoCard>
        {PITCH_LINKS.demoVideo && (
          <DemoCard icon={CirclePlay} title={PITCH_TEXT.demoVideo} text={PITCH_TEXT.demoVideoText}>
            <ExternalAnchor href={PITCH_LINKS.demoVideo}>{PITCH_TEXT.demoVideoLink}</ExternalAnchor>
          </DemoCard>
        )}
        <DemoCard icon={Terminal} title={PITCH_TEXT.demoLocal} text={PITCH_TEXT.demoLocalText}>
          <code className="block rounded-md bg-brand-900 px-3 py-2 font-mono text-xs text-surface">docker compose up -d</code>
          <ExternalAnchor href={PITCH_LINKS.readme} className="mt-2 text-sm">
            {PITCH_TEXT.demoLocalLink}
          </ExternalAnchor>
        </DemoCard>
      </ul>
    </section>
  );
}

function Team(): JSX.Element {
  return (
    <section id="team" aria-labelledby="team-title" className="scroll-mt-20 bg-brand-900 text-surface">
      <div className={cn(sectionClass, "grid gap-8 md:grid-cols-[auto_minmax(0,1fr)] md:items-center")}>
        <span aria-hidden="true" className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-brand-100 font-mono text-3xl font-bold">
          HT
        </span>
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-brand-100">{PITCH_TEXT.teamKicker}</p>
          <h2 id="team-title" className="mt-2 text-3xl font-bold">
            {PITCH_TEXT.teamTitle}
          </h2>
          <p className="mt-3 max-w-2xl text-lg text-brand-100">{PITCH_TEXT.teamText}</p>
          {TEAM_MEMBERS.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-4">
              {TEAM_MEMBERS.map((m) => (
                <li key={m.name}>
                  <span className="font-semibold">{m.name}</span> <span className="text-brand-100">· {m.role}</span>
                </li>
              ))}
            </ul>
          )}
          <a
            href={PITCH_LINKS.team}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md font-medium text-surface underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface focus-visible:ring-offset-2 focus-visible:ring-offset-brand-900"
          >
            <GitBranch aria-hidden="true" className="h-4 w-4" />
            {PITCH_TEXT.teamLink}
            <span className="sr-only">{PITCH_TEXT.opensInNewTab}</span>
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer(): JSX.Element {
  return (
    <footer className="border-t bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-ink-muted sm:px-6 md:flex-row md:items-start md:justify-between">
        <p className="max-w-3xl">{PITCH_TEXT.footerData}</p>
        <nav aria-label={PITCH_TEXT.footerAbout}>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {PITCH_SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={linkClass}>
                  {s.label}
                </a>
              </li>
            ))}
            <li>
              <a href="#top" className={linkClass}>
                {PITCH_TEXT.backToTop}
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}

/** Everything below the hero. Lazy: it carries the snapshot, the imagery and the chart. */
export default function PitchSections({ access }: { access: PitchAccess }): JSX.Element {
  return (
    <>
      <Summary />
      <Problem />
      <Solution />
      <HowItWorks />
      <Evidence />
      <Impact />
      <DataAndTechnology />
      <Demo access={access} />
      <Team />
      <Footer />
    </>
  );
}
