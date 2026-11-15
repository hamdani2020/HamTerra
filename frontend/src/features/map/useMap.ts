/**
 * The only module that imports `maplibre-gl` (frontend design, Map), so tests mock one
 * module. It owns the map instance and exposes a small typed controller.
 */
import "maplibre-gl/dist/maplibre-gl.css";

import {
  AttributionControl,
  Map as MapLibreMap,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type GeoJSONSourceSpecification,
  type StyleSpecification,
} from "maplibre-gl";
import { type RefObject, useEffect, useRef, useState } from "react";

import { bboxCorners, featureCollectionBounds, GHANA_BOUNDS, type BBox } from "@/lib/geo";
import { MAP_TEXT } from "@/lib/messages";
import { TOKENS } from "@/styles/tokens";
import type { AreaFeatureCollection } from "@/types/api";
// MapLibre 6 looks for its worker next to its own module file. Vite pre-bundles that module
// in development and does not see the dynamic URL in builds, so the worker URL is set
// explicitly. `?worker&url` makes Vite treat the file as a worker entry: a plain `?url`
// import is served as a page module that imports the Vite client, which cannot run in a
// worker, so the worker never answered and the map never fired `load`.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(workerUrl);

export const BASEMAP_TIMEOUT_MS = 10_000;
export const AREAS_SOURCE = "areas";
export const PREVIEW_SOURCE = "preview";
export const PREVIEW_LAYER = "preview-raster";
export const AREA_LAYERS = ["areas-fill", "areas-halo", "areas-outline"] as const;
const BASEMAP_SOURCE = "basemap";
const BASEMAP_LAYER = "basemap";
const FIT_PADDING = 40;

export interface MapController {
  setAreas(collection: AreaFeatureCollection): void;
  fitToFeatures(): void;
  fitToGhana(): void;
  zoomIn(): void;
  zoomOut(): void;
  setSelected(id: string | null): void;
  showPreview(imageUrl: string, bbox: BBox, opacity: number): void;
  setPreviewOpacity(opacity: number): void;
  removePreview(): void;
  hasPreview(): boolean;
  /** The visible extent, for "Use map extent" on the area list (Requirement 12.4). */
  getBounds(): BBox;
}

export type MapState = { status: "loading" } | { status: "ready"; controller: MapController } | { status: "unsupported" };

export interface UseMapOptions {
  /** Keyless raster tile template, `{z}/{x}/{y}` (Requirement 8.2). */
  basemapTileUrl: string;
  onSelect?: (id: string | null) => void;
  onBasemapFailure?: () => void;
  /** False for the area page's mini map: no pan, zoom or selection. */
  interactive?: boolean;
  /** Keep the drawn frame, so the map appears when the page is printed (report view). */
  printable?: boolean;
}

/** A keyless raster basemap over a plain background that shows if the tiles fail. */
function baseStyle(tileUrl: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      [BASEMAP_SOURCE]: {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        maxzoom: 19,
        attribution: MAP_TEXT.attribution,
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": TOKENS["slate-50"] } },
      { id: BASEMAP_LAYER, type: "raster", source: BASEMAP_SOURCE, paint: { "raster-fade-duration": 0 } },
    ],
  };
}

const selected: ExpressionSpecification = ["boolean", ["feature-state", "selected"], false];

/** The contract type and the GeoJSON type describe the same FeatureCollection. */
const asGeoJson = (collection: AreaFeatureCollection) => collection as unknown as GeoJSONSourceSpecification["data"];

function createController(map: MapLibreMap): MapController & { disposed: boolean } {
  let areas: AreaFeatureCollection = { type: "FeatureCollection", features: [] };
  let selectedId: string | null = null;

  const controller = {
    disposed: false,
    setAreas(collection: AreaFeatureCollection) {
      if (controller.disposed) return;
      areas = collection;
      const source = map.getSource<GeoJSONSource>(AREAS_SOURCE);
      if (source) {
        source.setData(asGeoJson(collection) as Parameters<GeoJSONSource["setData"]>[0]);
        return;
      }
      map.addSource(AREAS_SOURCE, { type: "geojson", data: asGeoJson(collection), promoteId: "id" });
      map.addLayer({
        id: "areas-fill",
        type: "fill",
        source: AREAS_SOURCE,
        paint: { "fill-color": TOKENS["emerald-600"], "fill-opacity": 0.15 },
      });
      // A white halo under the outline keeps it visible over dark basemap features (21.13).
      map.addLayer({
        id: "areas-halo",
        type: "line",
        source: AREAS_SOURCE,
        paint: { "line-color": TOKENS.surface, "line-width": ["case", selected, 6, 4] },
      });
      // Selected outlines are 2 px thicker and darker; no colour encodes a condition (8.16).
      map.addLayer({
        id: "areas-outline",
        type: "line",
        source: AREAS_SOURCE,
        paint: {
          "line-color": ["case", selected, TOKENS["emerald-900"], TOKENS["emerald-700"]],
          "line-width": ["case", selected, 4, 2],
        },
      });
    },
    fitToFeatures() {
      if (controller.disposed) return;
      map.fitBounds(featureCollectionBounds(areas), { padding: FIT_PADDING, maxZoom: 16, duration: 0 });
    },
    fitToGhana() {
      if (controller.disposed) return;
      map.fitBounds(GHANA_BOUNDS, { padding: FIT_PADDING, duration: 0 });
    },
    zoomIn() {
      if (!controller.disposed) map.zoomIn({ duration: 0 });
    },
    zoomOut() {
      if (!controller.disposed) map.zoomOut({ duration: 0 });
    },
    setSelected(id: string | null) {
      if (controller.disposed || !map.getSource(AREAS_SOURCE)) return;
      if (selectedId !== null) map.setFeatureState({ source: AREAS_SOURCE, id: selectedId }, { selected: false });
      selectedId = id;
      if (id !== null) map.setFeatureState({ source: AREAS_SOURCE, id }, { selected: true });
    },
    showPreview(imageUrl: string, bbox: BBox, opacity: number) {
      if (controller.disposed) return;
      // At most one overlay (Requirement 9.12).
      controller.removePreview();
      map.addSource(PREVIEW_SOURCE, { type: "image", url: imageUrl, coordinates: bboxCorners(bbox) });
      // Below the polygons, so the outlines stay visible.
      map.addLayer(
        { id: PREVIEW_LAYER, type: "raster", source: PREVIEW_SOURCE, paint: { "raster-opacity": opacity, "raster-fade-duration": 0 } },
        map.getLayer("areas-fill") ? "areas-fill" : undefined,
      );
    },
    setPreviewOpacity(opacity: number) {
      if (!controller.disposed && map.getLayer(PREVIEW_LAYER)) map.setPaintProperty(PREVIEW_LAYER, "raster-opacity", opacity);
    },
    removePreview() {
      if (controller.disposed) return;
      if (map.getLayer(PREVIEW_LAYER)) map.removeLayer(PREVIEW_LAYER);
      if (map.getSource(PREVIEW_SOURCE)) map.removeSource(PREVIEW_SOURCE);
    },
    hasPreview() {
      return !controller.disposed && map.getSource(PREVIEW_SOURCE) !== undefined;
    },
    getBounds(): BBox {
      const [[west, south], [east, north]] = map.getBounds().toArray() as [[number, number], [number, number]];
      const round = (v: number) => Math.round(v * 1e6) / 1e6;
      // Clamp to the ranges the bounding-box filter accepts.
      return [round(Math.max(-180, west)), round(Math.max(-90, south)), round(Math.min(180, east)), round(Math.min(90, north))];
    },
  };
  return controller;
}

/**
 * Creates the map in `containerRef` once. Returns `unsupported` when WebGL cannot be
 * created (Requirement 8.13). If no basemap tile has loaded 10 s after the first tile
 * request, the basemap layer is hidden and `onBasemapFailure` runs (Requirement 8.3).
 */
export function useMap(containerRef: RefObject<HTMLElement | null>, options: UseMapOptions): MapState {
  const [state, setState] = useState<MapState>({ status: "loading" });
  const callbacks = useRef(options);
  callbacks.current = options;
  const { basemapTileUrl, interactive = true, printable = false } = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container,
        style: baseStyle(basemapTileUrl),
        bounds: GHANA_BOUNDS,
        fitBoundsOptions: { padding: FIT_PADDING },
        attributionControl: false,
        fadeDuration: 0,
        interactive,
        // WebGL clears the canvas after each frame unless told to keep it; printing reads it.
        ...(printable ? { canvasContextAttributes: { preserveDrawingBuffer: true } } : {}),
      });
    } catch {
      setState({ status: "unsupported" });
      return undefined;
    }
    // Attribution stays expanded at every zoom (Requirement 8.4).
    map.addControl(new AttributionControl({ compact: false }), "bottom-right");

    const controller = createController(map);
    let tileLoaded = false;
    let basemapTimer: ReturnType<typeof setTimeout> | undefined;

    map.on("dataloading", (event) => {
      if (event.dataType !== "source" || !("sourceId" in event) || event.sourceId !== BASEMAP_SOURCE) return;
      if (basemapTimer !== undefined || tileLoaded) return;
      basemapTimer = setTimeout(() => {
        if (tileLoaded || controller.disposed) return;
        map.setLayoutProperty(BASEMAP_LAYER, "visibility", "none");
        callbacks.current.onBasemapFailure?.();
      }, BASEMAP_TIMEOUT_MS);
    });
    map.on("data", (event) => {
      if (event.dataType === "source" && "sourceId" in event && event.sourceId === BASEMAP_SOURCE && event.tile) {
        tileLoaded = true;
        clearTimeout(basemapTimer);
      }
    });
    map.on("click", (event) => {
      if (!map.getLayer("areas-fill")) {
        callbacks.current.onSelect?.(null);
        return;
      }
      const [feature] = map.queryRenderedFeatures(event.point, { layers: ["areas-fill"] });
      const id = feature?.properties?.id;
      callbacks.current.onSelect?.(typeof id === "string" ? id : null);
    });
    // Ready as soon as the style is loaded: sources and layers can be added then. The `load`
    // event also waits for every basemap tile of the first view, so one slow or failed tile
    // kept the areas off the map.
    const ready = () => {
      if (!controller.disposed) setState({ status: "ready", controller });
    };
    if (map.isStyleLoaded()) ready();
    else map.once("style.load", ready);

    return () => {
      controller.disposed = true;
      clearTimeout(basemapTimer);
      map.remove();
      setState({ status: "loading" });
    };
  }, [containerRef, basemapTileUrl, interactive, printable]);

  return state;
}
