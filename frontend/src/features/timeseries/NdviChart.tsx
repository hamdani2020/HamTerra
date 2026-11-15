import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { cloneElement, type ReactElement } from "react";

import { ChartContainer } from "@/components/common/ChartContainer";
import { usePrintMode } from "@/hooks/usePrintMode";
import { formatCoverage, formatDate, formatInteger, formatNdvi } from "@/lib/format";
import { OBSERVATION_TEXT, QUALITY_LABEL, SOURCE_LABEL, TIME_SERIES_TEXT } from "@/lib/messages";
import { ndviRamp } from "@/lib/ndviRamp";
import { chartSummaryText, ndviDomain, singleSourceSeries, type ChartPoint } from "@/lib/timeseries";
import { TOKENS } from "@/styles/tokens";

import { WeatherCell } from "./WeatherCell";

const DAY_MS = 86_400_000;
/** Fits the content width of A4 and US Letter with 15 mm margins, inside a card. */
export const PRINT_CHART_WIDTH = 600;
export const PRINT_CHART_HEIGHT = 260;
const LINE_COLOUR = TOKENS["slate-600"];
const OUTLINE = TOKENS["slate-900"];

interface Datum extends ChartPoint {
  t: number;
}

/**
 * On screen the chart follows its container. When printing it is drawn at a fixed size that
 * fits the page, because the container is not measured again for the print layout.
 */
function ChartFrame({ printing, children }: { printing: boolean; children: ReactElement }): JSX.Element {
  if (printing) return cloneElement(children, { width: PRINT_CHART_WIDTH, height: PRINT_CHART_HEIGHT } as never);
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={240}>
      {children}
    </ResponsiveContainer>
  );
}

function Marker({ cx, cy, datum }: { cx: number; cy: number; datum: Datum }): JSX.Element {
  const fill = ndviRamp(datum.ndvi_mean);
  // Poor quality: a hollow diamond with a 2 px outline; the others a filled circle (10.8).
  if (datum.quality.level === "poor") {
    return (
      <path
        d={`M ${cx} ${cy - 6} L ${cx + 6} ${cy} L ${cx} ${cy + 6} L ${cx - 6} ${cy} Z`}
        fill="none"
        stroke={OUTLINE}
        strokeWidth={2}
        data-testid="marker-poor"
      />
    );
  }
  return <circle cx={cx} cy={cy} r={5} fill={fill} stroke={TOKENS.surface} strokeWidth={1.5} data-testid="marker" />;
}

/** The tooltip for a hovered or focused point (Requirement 10.7, 10.16). */
export function PointTooltip({ point }: { point: ChartPoint }): JSX.Element {
  return (
    <div className="max-w-xs space-y-1 rounded-md border bg-card p-3 text-sm shadow" data-testid="ndvi-tooltip">
      <p className="font-medium text-foreground">
        {formatDate(point.date)} · {SOURCE_LABEL[point.source]}
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
        <dt className="text-ink-muted">{OBSERVATION_TEXT.mean}</dt>
        <dd className="tabular-nums">{formatNdvi(point.ndvi_mean)}</dd>
        <dt className="text-ink-muted">{OBSERVATION_TEXT.cloud}</dt>
        <dd className="tabular-nums">{formatCoverage(point.cloud_coverage_pct)}</dd>
        <dt className="text-ink-muted">{OBSERVATION_TEXT.dataCoverage}</dt>
        <dd className="tabular-nums">{formatCoverage(point.data_coverage_pct)}</dd>
        <dt className="text-ink-muted">{OBSERVATION_TEXT.quality}</dt>
        <dd>{QUALITY_LABEL[point.quality.level]}</dd>
        <dt className="text-ink-muted">{TIME_SERIES_TEXT.gap}</dt>
        <dd className="tabular-nums">
          {point.gap_days_from_previous === null ? TIME_SERIES_TEXT.notApplicable : formatInteger(point.gap_days_from_previous)}
        </dd>
      </dl>
      {point.weather && <WeatherCell weather={point.weather} />}
    </div>
  );
}

function TooltipContent({ active, payload }: TooltipContentProps<ValueType, NameType>): JSX.Element | null {
  const datum = payload?.[0]?.payload as Datum | undefined;
  return active && datum ? <PointTooltip point={datum} /> : null;
}

function ChartLegend({ domain }: { domain: [number, number] }): JSX.Element {
  const steps = 5;
  const values = Array.from({ length: steps }, (_, i) => domain[0] + ((domain[1] - domain[0]) * i) / (steps - 1));
  return (
    <div className="space-y-2 text-sm text-ink-muted" data-testid="ndvi-legend">
      <p className="font-medium text-foreground">{TIME_SERIES_TEXT.legend}</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        <li className="flex items-center gap-2">
          <svg aria-hidden="true" width="14" height="14">
            <circle cx="7" cy="7" r="5" fill={ndviRamp(0.5)} stroke={TOKENS.surface} />
          </svg>
          {TIME_SERIES_TEXT.legendPoint}
        </li>
        <li className="flex items-center gap-2">
          <svg aria-hidden="true" width="14" height="14">
            <path d="M 7 1 L 13 7 L 7 13 L 1 7 Z" fill="none" stroke={OUTLINE} strokeWidth="2" />
          </svg>
          {TIME_SERIES_TEXT.legendPoor}
        </li>
      </ul>
      {/* Discrete steps of the viridis-like ramp, with the displayed minimum and maximum (21.12). */}
      <div className="flex flex-wrap items-center gap-2">
        <span>{TIME_SERIES_TEXT.legendRamp}:</span>
        <span className="tabular-nums">{formatNdvi(domain[0])}</span>
        <span className="flex" aria-hidden="true">
          {values.map((v) => (
            <span key={v} className="h-3 w-6" style={{ backgroundColor: ndviRamp(v) }} />
          ))}
        </span>
        <span className="tabular-nums">{formatNdvi(domain[1])}</span>
      </div>
    </div>
  );
}

/**
 * Mean NDVI against date for one sensor (Requirement 10.5 to 10.8, 10.21, 10.22). A mixed
 * input is refused. Points are joined by straight lines only, and every observation has a
 * marker so gaps stay visible.
 */
export function NdviChart({ points, titleAs = "h2" }: { points: readonly ChartPoint[]; titleAs?: "h2" | "h3" }): JSX.Element {
  const printing = usePrintMode();
  const series = singleSourceSeries(points);
  if (!series) {
    return (
      <p role="alert" className="text-sm text-status-error">
        {TIME_SERIES_TEXT.mixedSources}
      </p>
    );
  }
  const data: Datum[] = series.points.map((p) => ({ ...p, t: Date.parse(`${p.date}T00:00:00Z`) }));
  const domain = ndviDomain(data.map((d) => d.ndvi_mean));
  const first = data[0]?.t ?? 0;
  const last = data.at(-1)?.t ?? 0;
  const xDomain: [number, number] = first === last ? [first - 15 * DAY_MS, last + 15 * DAY_MS] : [first, last];

  return (
    <ChartContainer
      title={`${TIME_SERIES_TEXT.chartTitle}, ${SOURCE_LABEL[series.source]}`}
      description={chartSummaryText(series.points, series.source)}
      heightClass="h-72 min-h-[240px]"
      titleAs={titleAs}
      footer={<ChartLegend domain={domain} />}
    >
      <ChartFrame printing={printing}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={TOKENS["slate-200"]} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={xDomain}
            tickFormatter={(t: number) => formatDate(new Date(t).toISOString().slice(0, 10))}
            stroke={TOKENS["slate-600"]}
          />
          <YAxis domain={domain} tickFormatter={(v: number) => v.toFixed(2)} stroke={TOKENS["slate-600"]} width={48} />
          <Tooltip content={TooltipContent} isAnimationActive={false} />
          <Line
            type="linear"
            dataKey="ndvi_mean"
            stroke={LINE_COLOUR}
            strokeWidth={1.5}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; payload?: Datum; index?: number }) =>
              props.payload && props.cx !== undefined && props.cy !== undefined ? (
                <Marker key={props.index} cx={props.cx} cy={props.cy} datum={props.payload} />
              ) : (
                <g key={props.index} />
              )
            }
            activeDot={{ r: 7, stroke: OUTLINE, strokeWidth: 2 }}
          />
        </ComposedChart>
      </ChartFrame>
    </ChartContainer>
  );
}
