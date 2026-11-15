import { X } from "lucide-react";
import { Link } from "react-router";

import { EmptyState, RegionError, RegionSkeleton } from "@/components/common/RegionState";
import { QualityBadge } from "@/components/common/QualityBadge";
import { VerbatimText } from "@/components/common/VerbatimText";
import { Button } from "@/components/ui/button";
import { formatDate, formatHectares, formatNdvi } from "@/lib/format";
import { geometryBounds } from "@/lib/geo";
import { DASHBOARD_TEXT, MAP_TEXT, SOURCE_LABEL } from "@/lib/messages";
import { routeTo } from "@/lib/routes";
import type { AreaFeature } from "@/types/api";

import { useArea, usePanelObservations } from "./hooks";
import { PreviewControl } from "./PreviewControl";
import { bindPreview, type usePreviewOverlay } from "./usePreviewOverlay";

const linkClass =
  "inline-flex min-h-11 items-center rounded-md font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-0";

export interface AreaDetailsPanelProps {
  feature: AreaFeature;
  onClose: () => void;
  preview: ReturnType<typeof usePreviewOverlay>;
  previewAvailable: boolean;
}

/**
 * The selected area (Requirements 8.5 to 8.8, 8.14). Feature properties render at once;
 * the area and its 10 newest observations load into the observations section, and a
 * failure there leaves the rest of the panel and the map unchanged.
 */
export function AreaDetailsPanel({ feature, onClose, preview, previewAvailable }: AreaDetailsPanelProps): JSX.Element {
  const { id, name, area_ha, latest_observation_date } = feature.properties;
  const area = useArea(id);
  const observations = usePanelObservations(id);
  const bbox = geometryBounds([feature.geometry]);

  const failed = area.isError || observations.isError;
  const retry = (): void => {
    if (area.isError) void area.refetch();
    if (observations.isError) void observations.refetch();
  };

  let section: JSX.Element;
  if (failed) {
    section = (
      <RegionError
        error={area.error ?? observations.error}
        context={MAP_TEXT.observationsError}
        onRetry={retry}
        retrying={area.isFetching || observations.isFetching}
      />
    );
  } else if (!observations.data) {
    section = <RegionSkeleton rows={4} />;
  } else if (observations.data.items.length === 0) {
    section = <EmptyState noun="observations" message={MAP_TEXT.noObservations} />;
  } else {
    section = (
      <ul className="space-y-3">
        {observations.data.items.map((observation) => (
          <li key={observation.id} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-foreground">
                {formatDate(observation.date)} · {SOURCE_LABEL[observation.source]}
              </span>
              <QualityBadge level={observation.quality.level} />
            </div>
            <p className="text-sm text-ink-muted">
              {DASHBOARD_TEXT.meanNdvi} <span className="font-medium tabular-nums text-foreground">{formatNdvi(observation.ndvi.mean)}</span>
            </p>
            <PreviewControl observation={observation} {...bindPreview(preview, observation, bbox, previewAvailable)} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section aria-labelledby="panel-title" className="space-y-4 rounded-lg border bg-card p-4 shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-ink-muted">{MAP_TEXT.panelTitle}</p>
          <h2 id="panel-title" className="text-lg font-semibold text-foreground [overflow-wrap:anywhere]">
            {name}
          </h2>
        </div>
        <Button type="button" variant="ghost" className="h-11 w-11 p-0 sm:h-9 sm:w-9" aria-label={MAP_TEXT.closePanel} onClick={onClose}>
          <X aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-muted">{MAP_TEXT.size}</dt>
        <dd className="text-foreground">{formatHectares(area_ha)}</dd>
        <dt className="text-ink-muted">{MAP_TEXT.latestObservation}</dt>
        <dd className="text-foreground">{latest_observation_date ? formatDate(latest_observation_date) : MAP_TEXT.noObservations}</dd>
      </dl>
      {area.data?.description && <VerbatimText text={area.data.description} className="text-sm text-ink-muted" />}
      <nav aria-label={name} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link className={linkClass} to={routeTo.area(id)}>
          {MAP_TEXT.openDetails}
        </Link>
        <Link className={linkClass} to={routeTo.areaTimeSeries(id)}>
          {MAP_TEXT.openTimeSeries}
        </Link>
        <Link className={linkClass} to={routeTo.areaCompare(id)}>
          {MAP_TEXT.openComparison}
        </Link>
      </nav>
      <section aria-labelledby="panel-observations" aria-busy={!failed && !observations.data} className="space-y-2">
        <h3 id="panel-observations" className="font-semibold text-foreground">
          {MAP_TEXT.observationsTitle}
        </h3>
        {section}
      </section>
    </section>
  );
}
