import { Button } from "@/components/ui/button";
import { VerbatimText } from "@/components/common/VerbatimText";
import { describeError, EVIDENCE_TEXT, MAP_TEXT, previewSizeText } from "@/lib/messages";
import type { Observation } from "@/types/api";

import type { PreviewOverlayState } from "./usePreviewOverlay";

export interface PreviewControlProps {
  observation: Observation;
  state: PreviewOverlayState;
  /** False until the map is ready to draw an overlay. */
  available: boolean;
  onShow: () => void;
  onRemove: () => void;
  onOpacity: (percent: number) => void;
}

/** "Show preview" for one observation, its pending and error states, and the active overlay's notes. */
export function PreviewControl({ observation, state, available, onShow, onRemove, onOpacity }: PreviewControlProps): JSX.Element {
  const { preview } = observation;
  if (!preview.url) return <p className="text-sm text-ink-muted">{MAP_TEXT.noPreview}</p>;

  const pending = state.pendingId === observation.id;
  const active = state.activeId === observation.id;
  const failed = state.errorId === observation.id;
  const sliderId = `preview-opacity-${observation.id}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {active ? (
          <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={onRemove}>
            {MAP_TEXT.removePreview}
          </Button>
        ) : (
          <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={!available || pending} onClick={onShow}>
            {MAP_TEXT.showPreview}
          </Button>
        )}
        {pending && (
          <span role="status" aria-busy="true" className="text-sm text-ink-muted">
            {MAP_TEXT.loadingPreview}
          </span>
        )}
      </div>
      {failed && (
        <p role="alert" className="text-sm text-status-error">
          {describeError(state.error).body}
        </p>
      )}
      {active && (
        <div className="space-y-2 rounded-md border bg-muted p-3 text-sm">
          <VerbatimText text={preview.note} className="text-foreground" />
          <p className="text-ink-muted">
            {MAP_TEXT.previewSize}: {previewSizeText(preview.width_px, preview.height_px)}
          </p>
          <p className="text-ink-muted">{EVIDENCE_TEXT.previewPosition}</p>
          <div className="space-y-1">
            <label htmlFor={sliderId} className="font-medium text-foreground">
              {MAP_TEXT.previewOpacity}: {state.opacity}%
            </label>
            <input
              id={sliderId}
              type="range"
              min={0}
              max={100}
              step={1}
              value={state.opacity}
              onChange={(event) => onOpacity(Number(event.target.value))}
              className="h-11 w-full accent-primary sm:h-6"
            />
          </div>
        </div>
      )}
    </div>
  );
}
