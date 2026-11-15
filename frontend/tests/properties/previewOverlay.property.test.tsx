// Feature: eco-sentinel-frontend, Property 16: Preview overlay lifecycle
import { act, renderHook } from "@testing-library/react";
import fc from "fast-check";
import { useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@/core/api/ApiProvider";
import type { Endpoints } from "@/core/api/endpoints";
import { ApiError } from "@/core/api/errors";
import { PREVIEW_LAYER, PREVIEW_SOURCE, useMap } from "@/features/map/useMap";
import { usePreviewOverlay } from "@/features/map/usePreviewOverlay";
import type { BBox } from "@/lib/geo";

import { buildObservation } from "../msw/contract";
import { maps, resetMaps } from "../mocks/maplibre";
import { propertyConfig } from "./propertyConfig";

vi.mock("maplibre-gl", () => import("../mocks/maplibre"));

const BBOX: BBox = [-2.2, 5.3, -2.1, 5.4];
const observations = Array.from({ length: 4 }, (_, i) =>
  buildObservation({
    id: `o${i}`,
    preview: { url: `/api/v1/observations/o${i}/preview`, width_px: 117, height_px: 117, note: "For orientation only." },
  }),
);

type Op = { kind: "show"; index: number; ok: boolean } | { kind: "remove" };
const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant("show" as const), index: fc.integer({ min: 0, max: 3 }), ok: fc.boolean() }),
  fc.constant({ kind: "remove" as const }),
);

let created: string[] = [];
let revoked: Set<string>;

beforeEach(() => {
  resetMaps();
  created = [];
  revoked = new Set();
  let n = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    n += 1;
    const url = `blob:test-${n}`;
    created.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    revoked.add(url);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function setup(outcomes: Map<string, boolean>) {
  const api = {
    fetchPreviewBlob: vi.fn(async (url: string) => {
      const id = url.split("/")[4] ?? "";
      if (outcomes.get(id) === false) throw new ApiError(404, "NOT_FOUND", "x", null, null, true);
      return new Blob(["png"], { type: "image/png" });
    }),
  } as unknown as Endpoints;
  const wrapper = ({ children }: { children: ReactNode }) => <ApiProvider api={api}>{children}</ApiProvider>;
  return renderHook(
    () => {
      const ref = useRef<HTMLDivElement>(document.createElement("div"));
      const map = useMap(ref, { basemapTileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png" });
      const controller = map.status === "ready" ? map.controller : null;
      return { controller, overlay: usePreviewOverlay(controller) };
    },
    { wrapper },
  );
}

function previewCounts() {
  const map = maps.at(-1);
  if (!map) throw new Error("no map");
  return {
    sources: [...map.sources.keys()].filter((id) => id === PREVIEW_SOURCE).length,
    layers: map.layers.filter((layer) => layer.id === PREVIEW_LAYER).length,
    imageUrl: map.sources.get(PREVIEW_SOURCE)?.url as string | undefined,
  };
}

describe("Property 16: Preview overlay lifecycle", () => {
  it("keeps at most one overlay, removes it fully, and revokes every inactive blob URL", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 12 }), async (ops) => {
        resetMaps();
        created = [];
        revoked = new Set();
        const outcomes = new Map<string, boolean>();
        const view = setup(outcomes);
        // The mocked map emits "load" in a microtask; flushing it makes the controller ready.
        await act(async () => {});
        expect(view.result.current.controller).not.toBeNull();

        for (const step of ops) {
          if (step.kind === "show") {
            const observation = observations[step.index];
            if (!observation) continue;
            outcomes.set(observation.id, step.ok);
            await act(async () => {
              await view.result.current.overlay.show(observation, BBOX);
            });
          } else {
            act(() => view.result.current.overlay.remove());
          }
          const counts = previewCounts();
          expect(counts.sources).toBeLessThanOrEqual(1);
          expect(counts.layers).toBe(counts.sources);
          if (step.kind === "remove") expect(counts.sources).toBe(0);
          // Every blob URL except the one on the map has been revoked.
          for (const url of created) {
            if (url !== counts.imageUrl) expect(revoked.has(url)).toBe(true);
            else expect(revoked.has(url)).toBe(false);
          }
        }

        view.unmount();
        for (const url of created) expect(revoked.has(url)).toBe(true);
      }),
      { ...propertyConfig },
    );
  });
});
