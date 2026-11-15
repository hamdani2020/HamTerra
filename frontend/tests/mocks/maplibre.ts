/**
 * A recording stand-in for `maplibre-gl` (Requirement 23.12). Tests install it with
 * `vi.mock("maplibre-gl", () => import("../mocks/maplibre"))`. It keeps sources, layers,
 * feature state and camera calls, emits `load` after construction, and enforces the real
 * library's rule that a source cannot be removed while a layer uses it.
 */
type Handler = (event: Record<string, unknown>) => void;

interface LayerRecord {
  id: string;
  type: string;
  source?: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

export const maps: FakeMap[] = [];
export const mapControl = {
  /** Make every constructor call throw, as when the browser has no WebGL. */
  webglUnavailable: false,
  /** Features returned by queryRenderedFeatures for the next click. */
  clickFeatures: [] as { properties: Record<string, unknown> }[],
};

export function resetMaps(): void {
  maps.length = 0;
  mapControl.webglUnavailable = false;
  mapControl.clickFeatures = [];
}

/** The worker URL the map module set, so a test can check it. */
export let workerUrl: string | null = null;
export function setWorkerUrl(value: string): void {
  workerUrl = value;
}

export class AttributionControl {
  constructor(readonly options: Record<string, unknown> = {}) {}
}

export class FakeMap {
  readonly sources = new Map<string, Record<string, unknown> & { data?: unknown }>();
  layers: LayerRecord[] = [];
  readonly featureState = new Map<string, Record<string, unknown>>();
  readonly camera: { method: string; args: unknown[] }[] = [];
  readonly controls: unknown[] = [];
  readonly handlers = new Map<string, Handler[]>();
  removed = false;

  constructor(readonly options: Record<string, unknown>) {
    if (mapControl.webglUnavailable) throw new Error("Failed to initialize WebGL");
    const style = options.style as { layers: LayerRecord[] };
    this.layers = style.layers.map((layer) => ({ ...layer, layout: { ...(layer.layout ?? {}) } }));
    maps.push(this);
    queueMicrotask(() => {
      if (!this.removed) this.emit("load", {});
    });
  }

  on(type: string, handler: Handler): this {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
    return this;
  }

  emit(type: string, event: Record<string, unknown>): void {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }

  /** Simulate a click; `features` are what the click hits. */
  click(features: { properties: Record<string, unknown> }[]): void {
    mapControl.clickFeatures = features;
    this.emit("click", { point: { x: 1, y: 1 } });
  }

  queryRenderedFeatures(): { properties: Record<string, unknown> }[] {
    return mapControl.clickFeatures;
  }

  addControl(control: unknown): this {
    this.controls.push(control);
    return this;
  }

  addSource(id: string, source: Record<string, unknown>): this {
    if (this.sources.has(id)) throw new Error(`There is already a source with ID "${id}".`);
    const record: Record<string, unknown> & { data?: unknown } = { ...source };
    record.setData = (data: unknown) => {
      record.data = data;
    };
    this.sources.set(id, record);
    return this;
  }

  getSource(id: string): unknown {
    return this.sources.get(id);
  }

  removeSource(id: string): this {
    if (this.layers.some((layer) => layer.source === id)) {
      throw new Error(`Source "${id}" cannot be removed while layer is using it.`);
    }
    this.sources.delete(id);
    return this;
  }

  addLayer(layer: LayerRecord, beforeId?: string): this {
    if (this.layers.some((l) => l.id === layer.id)) throw new Error(`Layer "${layer.id}" already exists.`);
    if (layer.source && !this.sources.has(layer.source)) throw new Error(`Source "${layer.source}" not found.`);
    const index = beforeId ? this.layers.findIndex((l) => l.id === beforeId) : -1;
    const record = { ...layer, paint: { ...(layer.paint ?? {}) }, layout: { ...(layer.layout ?? {}) } };
    if (index >= 0) this.layers.splice(index, 0, record);
    else this.layers.push(record);
    return this;
  }

  getLayer(id: string): LayerRecord | undefined {
    return this.layers.find((layer) => layer.id === id);
  }

  removeLayer(id: string): this {
    this.layers = this.layers.filter((layer) => layer.id !== id);
    return this;
  }

  setPaintProperty(id: string, name: string, value: unknown): this {
    const layer = this.getLayer(id);
    if (layer) layer.paint = { ...layer.paint, [name]: value };
    return this;
  }

  setLayoutProperty(id: string, name: string, value: unknown): this {
    const layer = this.getLayer(id);
    if (layer) layer.layout = { ...layer.layout, [name]: value };
    return this;
  }

  setFeatureState(target: { source: string; id: string }, state: Record<string, unknown>): this {
    const key = `${target.source}:${target.id}`;
    this.featureState.set(key, { ...(this.featureState.get(key) ?? {}), ...state });
    return this;
  }

  selectedIds(): string[] {
    return [...this.featureState.entries()].filter(([, s]) => s.selected === true).map(([k]) => k.split(":")[1] ?? "");
  }

  fitBounds(...args: unknown[]): this {
    this.camera.push({ method: "fitBounds", args });
    return this;
  }

  /** The visible extent; tests can set it. */
  bounds: [[number, number], [number, number]] = [[-3.3, 4.7], [1.3, 11.2]];
  getBounds(): { toArray: () => [[number, number], [number, number]] } {
    return { toArray: () => this.bounds };
  }

  zoomIn(...args: unknown[]): this {
    this.camera.push({ method: "zoomIn", args });
    return this;
  }

  zoomOut(...args: unknown[]): this {
    this.camera.push({ method: "zoomOut", args });
    return this;
  }

  remove(): void {
    this.removed = true;
  }
}

export { FakeMap as Map };
