import { useEffect, useRef } from "react";

import { useConfig } from "@/core/ConfigProvider";
import { useMap, type MapController } from "@/features/map/useMap";
import { AREA_TEXT } from "@/lib/messages";
import type { Area, AreaFeatureCollection } from "@/types/api";

export interface AreaMiniMapProps {
  area: Area;
  /** The controller once the map is ready, so the page can draw a preview overlay on it. */
  onReady: (controller: MapController | null) => void;
  /** Keep the drawn frame for printing (report view). */
  printable?: boolean;
}

/**
 * A small non-interactive map of one polygon (Requirement 12.8). It is loaded with a dynamic
 * import, so MapLibre is fetched only when an area page is opened.
 */
export default function AreaMiniMap({ area, onReady, printable = false }: AreaMiniMapProps): JSX.Element {
  const config = useConfig();
  const container = useRef<HTMLDivElement>(null);
  const map = useMap(container, { basemapTileUrl: config.basemapTileUrl, interactive: false, printable });
  const controller = map.status === "ready" ? map.controller : null;

  useEffect(() => {
    if (!controller || !area.geometry) return;
    const collection: AreaFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: area.id,
          geometry: area.geometry,
          properties: { id: area.id, name: area.name, area_ha: area.area_ha, latest_observation_date: area.latest_observation_date },
        },
      ],
    };
    controller.setAreas(collection);
    controller.fitToFeatures();
  }, [controller, area]);

  useEffect(() => {
    onReady(controller);
  }, [controller, onReady]);

  if (map.status === "unsupported") return <></>;
  return (
    // A wrapper sets the size: MapLibre's CSS makes the map element itself position: relative.
    <div className="h-64 overflow-hidden rounded-lg border bg-card" data-print="map">
      <div ref={container} className="h-full w-full" role="region" aria-label={`${AREA_TEXT.mapLabel}: ${area.name}`} data-testid="mini-map" />
    </div>
  );
}
