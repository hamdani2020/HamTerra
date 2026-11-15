import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { EvidenceNote } from "@/components/common/EvidenceNote";
import { RegionError } from "@/components/common/RegionState";
import { useConfig } from "@/core/ConfigProvider";
import { AreaDetailsPanel } from "@/features/map/AreaDetailsPanel";
import { useAreaMap } from "@/features/map/hooks";
import { MapControls } from "@/features/map/MapControls";
import { MapLegend } from "@/features/map/MapLegend";
import { useMap } from "@/features/map/useMap";
import { usePreviewOverlay } from "@/features/map/usePreviewOverlay";
import { MAP_TEXT, REGION_TEXT } from "@/lib/messages";
import { PAGE_TITLE } from "@/lib/pageTitles";
import { ROUTES } from "@/lib/routes";

const linkClass =
  "inline-flex min-h-11 items-center rounded-md font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-0";

/** The interactive map (Requirement 8) with the preview overlay (Requirement 9). */
export default function MapPage(): JSX.Element {
  const config = useConfig();
  const container = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [basemapFailed, setBasemapFailed] = useState(false);
  const map = useMap(container, {
    basemapTileUrl: config.basemapTileUrl,
    onSelect: setSelectedId,
    onBasemapFailure: () => setBasemapFailed(true),
  });
  const controller = map.status === "ready" ? map.controller : null;
  const areas = useAreaMap();
  const preview = usePreviewOverlay(controller);
  const fitted = useRef(false);

  // Put the areas on the map, and fit the view the first time they arrive (8.1).
  useEffect(() => {
    if (!controller || !areas.data) return;
    controller.setAreas(areas.data);
    if (!fitted.current) {
      controller.fitToFeatures();
      fitted.current = true;
    }
  }, [controller, areas.data]);
  useEffect(() => {
    if (!controller) fitted.current = false;
  }, [controller]);

  const feature = areas.data?.features.find((f) => f.properties.id === selectedId) ?? null;
  useEffect(() => {
    controller?.setSelected(feature ? feature.properties.id : null);
  }, [controller, feature]);

  // Closing the panel or picking another area removes that area's overlay.
  const { remove } = preview;
  useEffect(() => {
    remove();
  }, [selectedId, remove]);

  const listLink = (
    <Link className={linkClass} to={ROUTES.areas}>
      {MAP_TEXT.areaListLink}
    </Link>
  );

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
          {PAGE_TITLE.map}
        </h1>
        <EvidenceNote kind="aggregate" />
        {/* The text alternative to the map (Requirement 8.15). */}
        <p>{listLink}</p>
      </header>

      {map.status === "unsupported" ? (
        <div role="alert" className="space-y-2 rounded-lg border bg-card p-4 shadow">
          <p className="text-foreground">{MAP_TEXT.unsupported}</p>
          {listLink}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-3">
            <div className="relative h-[60vh] min-h-[320px] overflow-hidden rounded-lg border bg-card">
              {/* Sized with h-full/w-full, not absolute inset-0: MapLibre's CSS sets
                  `.maplibregl-map { position: relative }` on this element, which overrides
                  `absolute` and collapsed the map to zero height. */}
              <div ref={container} className="h-full w-full" role="region" aria-label={MAP_TEXT.mapLabel} data-testid="map-container" />
              <MapControls controller={controller} />
              {(map.status === "loading" || areas.isPending) && !areas.isError && (
                <p role="status" aria-busy="true" className="absolute right-3 top-3 z-10 rounded-md bg-card px-3 py-2 text-sm text-ink-muted shadow">
                  {map.status === "loading" ? REGION_TEXT.loading : MAP_TEXT.loadingAreas}
                </p>
              )}
              {/* The data layer's error state, in place of the layer (Requirement 8.12). */}
              {areas.isError && (
                <div className="absolute inset-x-3 top-3 z-20 ml-14">
                  <RegionError
                    error={areas.error}
                    context={MAP_TEXT.areasError}
                    onRetry={() => void areas.refetch()}
                    retrying={areas.isFetching}
                    className="bg-card"
                  />
                </div>
              )}
            </div>
            {basemapFailed && (
              <p role="status" className="rounded-md border border-status-warning bg-status-warning-bg p-3 text-sm text-status-warning">
                {MAP_TEXT.basemapFailed}
              </p>
            )}
            {areas.data && areas.data.features.length === 0 && <p className="text-sm text-ink-muted">{MAP_TEXT.noAreas}</p>}
            <MapLegend overlayOpacity={preview.state.activeId ? preview.state.opacity : null} />
          </div>
          {feature && (
            <AreaDetailsPanel
              key={feature.properties.id}
              feature={feature}
              onClose={() => setSelectedId(null)}
              preview={preview}
              previewAvailable={controller !== null}
            />
          )}
        </div>
      )}
    </div>
  );
}
