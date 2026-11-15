import { QualityBadge } from "@/components/common/QualityBadge";
import { ResponsiveTable, type Column } from "@/components/common/DataTable";
import { formatCoverage, formatDate, formatInteger, formatNdvi } from "@/lib/format";
import { OBSERVATION_TEXT, SOURCE_LABEL, TIME_SERIES_TEXT } from "@/lib/messages";
import type { ChartPoint } from "@/lib/timeseries";

import { WeatherCell } from "./WeatherCell";

/** The chart's points as a table, so the data is available without the chart (10.9). */
export function PointsTable({ points, showWeather }: { points: readonly ChartPoint[]; showWeather: boolean }): JSX.Element {
  const columns: Column<ChartPoint>[] = [
    { id: "date", header: OBSERVATION_TEXT.date, cell: (p) => formatDate(p.date) },
    { id: "source", header: OBSERVATION_TEXT.source, cell: (p) => SOURCE_LABEL[p.source] },
    { id: "mean", header: OBSERVATION_TEXT.mean, cell: (p) => formatNdvi(p.ndvi_mean), align: "right" },
    { id: "cloud", header: OBSERVATION_TEXT.cloud, cell: (p) => formatCoverage(p.cloud_coverage_pct), align: "right" },
    { id: "coverage", header: OBSERVATION_TEXT.dataCoverage, cell: (p) => formatCoverage(p.data_coverage_pct), align: "right" },
    { id: "quality", header: OBSERVATION_TEXT.quality, cell: (p) => <QualityBadge level={p.quality.level} /> },
    {
      id: "gap",
      header: TIME_SERIES_TEXT.gap,
      cell: (p) => (p.gap_days_from_previous === null ? TIME_SERIES_TEXT.notApplicable : formatInteger(p.gap_days_from_previous)),
      align: "right",
    },
  ];
  if (showWeather) {
    columns.push({
      id: "weather",
      header: TIME_SERIES_TEXT.weatherColumn,
      cell: (p) => (p.weather ? <WeatherCell weather={p.weather} /> : <span className="text-ink-muted">{TIME_SERIES_TEXT.notApplicable}</span>),
    });
  }
  return <ResponsiveTable caption={TIME_SERIES_TEXT.pointsTable} showCaption columns={columns} rows={points} getRowId={(p) => p.date} />;
}
