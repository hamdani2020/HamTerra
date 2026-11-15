/**
 * The evidence snapshot of the project page: saved API responses for one area, exported by
 * `backend/scripts/export_pitch_snapshot.py`. The page cannot call the API (it is public and
 * the API needs a token), so it renders these responses unchanged. The helpers below only
 * count and locate raw values for display; they compute no quality level, flag or warning.
 */
import type { Area, ComparisonResult, Observation, PublicSettings, Source, TimeSeriesResponse } from "@/types/api";

import raw from "./data/snapshot.json";

export interface PitchPreview {
  file: string;
  url: string;
  observation: Observation;
}

export interface PitchSnapshot {
  exported_at: string;
  period: { from: string; to: string };
  area: Area;
  settings: PublicSettings;
  timeseries: Record<Source, TimeSeriesResponse>;
  comparisons: ComparisonResult[];
  previews: PitchPreview[];
}

const PREVIEW_URLS = import.meta.glob<string>("./data/previews/*.png", { eager: true, query: "?url", import: "default" });

type RawSnapshot = Omit<PitchSnapshot, "previews"> & { previews: Omit<PitchPreview, "url">[] };

/** Attaches the bundled image URL to each preview; a preview without its file is dropped. */
export function loadSnapshot(data: RawSnapshot, urls: Record<string, string>): PitchSnapshot {
  const previews: PitchPreview[] = [];
  for (const p of data.previews) {
    const url = urls[`./data/previews/${p.file}`];
    if (url) previews.push({ ...p, url });
  }
  return { ...data, previews };
}

// The JSON is an API response typed by the contract; JSON imports widen literal types.
export const SNAPSHOT: PitchSnapshot = loadSnapshot(raw as unknown as RawSnapshot, PREVIEW_URLS);

export const SOURCES: readonly Source[] = ["sentinel-2", "landsat-8"];

/** Observations per sensor and in total, from the time series responses. */
export function observationCounts(s: PitchSnapshot): { total: number; bySource: Record<Source, number> } {
  const bySource = { "sentinel-2": s.timeseries["sentinel-2"].points.length, "landsat-8": s.timeseries["landsat-8"].points.length };
  return { total: bySource["sentinel-2"] + bySource["landsat-8"], bySource };
}

/** Observations whose reported cloud coverage is exactly 100 %, a raw provider value. */
export function fullyCloudyCount(s: PitchSnapshot): number {
  return SOURCES.reduce((n, source) => n + s.timeseries[source].points.filter((p) => p.cloud_coverage_pct === 100).length, 0);
}

/** The centre of the polygon's bounding box, longitude then latitude, for a coordinate label. */
export function boundingBoxCentre(area: Area): [number, number] | null {
  const positions: number[][] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number") positions.push(value as number[]);
    else if (Array.isArray(value)) value.forEach(walk);
  };
  walk(area.geometry?.coordinates);
  if (positions.length === 0) return null;
  const lons = positions.map((p) => p[0] as number);
  const lats = positions.map((p) => p[1] as number);
  return [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
}

/** "5.450° N, 1.980° W". */
export function formatCoordinate([lon, lat]: [number, number]): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(3)}° ${ns}, ${Math.abs(lon).toFixed(3)}° ${ew}`;
}

/** The preview of one observation, by source and date. */
export function previewFor(s: PitchSnapshot, source: Source, date: string): PitchPreview | undefined {
  return s.previews.find((p) => p.observation.source === source && p.observation.date === date);
}
