import { QualityBadge } from "@/components/common/QualityBadge";
import { ResponsiveTable, type Column } from "@/components/common/DataTable";
import { formatCoverage, formatDate, formatNdvi } from "@/lib/format";
import { OBSERVATION_TEXT, SOURCE_LABEL } from "@/lib/messages";
import type { Observation, Quality, Source } from "@/types/api";

/** A table row: a stored observation, a time-series point or a report row. */
export interface ObservationRow {
  key: string;
  date: string;
  source: Source;
  ndvi_mean: number;
  cloud_coverage_pct: number | null;
  data_coverage_pct: number | null;
  quality: Quality;
}

export function observationRow(observation: Observation): ObservationRow {
  return {
    key: observation.id,
    date: observation.date,
    source: observation.source,
    ndvi_mean: observation.ndvi.mean,
    cloud_coverage_pct: observation.quality.cloud_coverage_pct,
    data_coverage_pct: observation.quality.data_coverage_pct,
    quality: observation.quality,
  };
}

export interface ObservationsTableProps {
  rows: readonly ObservationRow[];
  caption?: string;
  /** When given, the date opens the observation's details. */
  onSelect?: (key: string) => void;
  selectedKey?: string | null;
}

/**
 * Observations as rows: one sensor per row, cloud and data coverage in separate columns,
 * the Backend quality level as a badge (Requirements 9.1, 9.2, 20.5, 20.6).
 */
export function ObservationsTable({ rows, caption = OBSERVATION_TEXT.tableCaption, onSelect, selectedKey = null }: ObservationsTableProps): JSX.Element {
  const columns: Column<ObservationRow>[] = [
    {
      id: "date",
      header: OBSERVATION_TEXT.date,
      cell: (row) =>
        onSelect ? (
          <button
            type="button"
            aria-pressed={selectedKey === row.key}
            aria-label={`${OBSERVATION_TEXT.select}: ${formatDate(row.date)}, ${SOURCE_LABEL[row.source]}`}
            onClick={() => onSelect(row.key)}
            className="min-h-11 rounded-sm text-left font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
          >
            {formatDate(row.date)}
          </button>
        ) : (
          formatDate(row.date)
        ),
    },
    { id: "source", header: OBSERVATION_TEXT.source, cell: (row) => SOURCE_LABEL[row.source] },
    { id: "mean", header: OBSERVATION_TEXT.mean, cell: (row) => formatNdvi(row.ndvi_mean), align: "right" },
    { id: "cloud", header: OBSERVATION_TEXT.cloud, cell: (row) => formatCoverage(row.cloud_coverage_pct), align: "right" },
    { id: "coverage", header: OBSERVATION_TEXT.dataCoverage, cell: (row) => formatCoverage(row.data_coverage_pct), align: "right" },
    { id: "quality", header: OBSERVATION_TEXT.quality, cell: (row) => <QualityBadge level={row.quality.level} /> },
  ];
  return <ResponsiveTable caption={caption} columns={columns} rows={rows} getRowId={(row) => row.key} />;
}
