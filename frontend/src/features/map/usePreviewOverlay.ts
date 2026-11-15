import { useCallback, useEffect, useRef, useState } from "react";

import { useApi } from "@/core/api/ApiProvider";
import { isAbortError } from "@/core/api/errors";
import type { BBox } from "@/lib/geo";
import type { Observation } from "@/types/api";

import type { MapController } from "./useMap";

export const DEFAULT_OPACITY_PERCENT = 70;

export interface PreviewOverlayState {
  /** The observation whose preview is on the map. */
  activeId: string | null;
  active: Observation | null;
  pendingId: string | null;
  errorId: string | null;
  error: unknown;
  opacity: number;
}

const initial: PreviewOverlayState = {
  activeId: null,
  active: null,
  pendingId: null,
  errorId: null,
  error: null,
  opacity: DEFAULT_OPACITY_PERCENT,
};

/**
 * The preview overlay (Requirement 9.6 to 9.14). The image is fetched through the API
 * client with the bearer token and shown from a blob URL. At most one overlay exists; a
 * replacement, a removal or unmounting removes the layer and source, then revokes the URL.
 */
export function usePreviewOverlay(controller: MapController | null) {
  const api = useApi();
  const [state, setState] = useState<PreviewOverlayState>(initial);
  const blobUrl = useRef<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const opacity = useRef(DEFAULT_OPACITY_PERCENT);

  const release = useCallback((map: MapController | null) => {
    map?.removePreview();
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = null;
  }, []);

  // A new or removed map has no overlay: release the old image (and on unmount).
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
      release(controller);
      setState((s) => ({ ...initial, opacity: s.opacity }));
    },
    [controller, release],
  );

  const show = useCallback(
    async (observation: Observation, bbox: BBox) => {
      const url = observation.preview.url;
      if (!controller || !url) return;
      pending.current?.abort();
      const abort = new AbortController();
      pending.current = abort;
      setState((s) => ({ ...s, pendingId: observation.id, errorId: null, error: null }));
      try {
        const blob = await api.fetchPreviewBlob(url, { signal: abort.signal });
        if (abort.signal.aborted) return;
        // Replace: the previous layer, source and blob URL go first (9.12, 9.14).
        release(controller);
        const next = URL.createObjectURL(blob);
        blobUrl.current = next;
        controller.showPreview(next, bbox, opacity.current / 100);
        setState((s) => ({ ...s, activeId: observation.id, active: observation, pendingId: null }));
      } catch (error) {
        if (abort.signal.aborted || isAbortError(error)) return;
        // The map is left unchanged and the control stays available (9.11).
        setState((s) => ({ ...s, pendingId: null, errorId: observation.id, error }));
      } finally {
        if (pending.current === abort) pending.current = null;
      }
    },
    [api, controller, release],
  );

  const remove = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    release(controller);
    setState((s) => ({ ...initial, opacity: s.opacity }));
  }, [controller, release]);

  const setOpacity = useCallback(
    (percent: number) => {
      const value = Math.min(100, Math.max(0, Math.round(percent)));
      opacity.current = value;
      controller?.setPreviewOpacity(value / 100);
      setState((s) => ({ ...s, opacity: value }));
    },
    [controller],
  );

  return { state, show, remove, setOpacity };
}

/** Connects one observation's preview control to the overlay hook. */
export function bindPreview(
  overlay: ReturnType<typeof usePreviewOverlay>,
  observation: Observation,
  bbox: BBox | null,
  mapReady: boolean,
) {
  return {
    state: overlay.state,
    available: mapReady && bbox !== null,
    onShow: () => {
      if (bbox) void overlay.show(observation, bbox);
    },
    onRemove: overlay.remove,
    onOpacity: overlay.setOpacity,
  };
}
