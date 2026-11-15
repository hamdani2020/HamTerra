/**
 * Sequential viridis-like colour ramp for NDVI markers and legends (Requirement 21.12).
 * The stops rise in lightness, so the order stays readable under protanopia, deuteranopia
 * and tritanopia. Emerald is not used for data.
 */
import { relativeLuminance } from "@/lib/contrast";

export const NDVI_STOPS = [
  "#440154",
  "#472D7B",
  "#3B528B",
  "#2C728E",
  "#21908D",
  "#27AD81",
  "#5DC863",
  "#AADC32",
  "#FDE725",
] as const;

function toLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function toSrgb(linear: number): number {
  const v = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

function hexChannels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

const LINEAR_STOPS = NDVI_STOPS.map((hex) => hexChannels(hex).map(toLinear) as [number, number, number]);

// Interpolating in linear light keeps luminance (a linear function of linear channels)
// monotonic between stops. The rounded colours are then checked once and any rounding
// step that would lower luminance is held at the previous colour.
const TABLE_SIZE = 1024;
const TABLE: string[] = (() => {
  const table: string[] = [];
  let previous = -1;
  let previousHex: string = NDVI_STOPS[0];
  for (let i = 0; i < TABLE_SIZE; i += 1) {
    const position = (i / (TABLE_SIZE - 1)) * (NDVI_STOPS.length - 1);
    const lower = Math.min(Math.floor(position), NDVI_STOPS.length - 2);
    const t = position - lower;
    const a = LINEAR_STOPS[lower] ?? [0, 0, 0];
    const b = LINEAR_STOPS[lower + 1] ?? a;
    const mixed = [0, 1, 2].map((k) => toSrgb((a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * t)) as [
      number,
      number,
      number,
    ];
    let hex = toHex(mixed);
    if (i === 0) hex = NDVI_STOPS[0];
    if (i === TABLE_SIZE - 1) hex = NDVI_STOPS[NDVI_STOPS.length - 1] ?? hex;
    const luminance = relativeLuminance(hex);
    if (luminance < previous) {
      hex = previousHex;
    } else {
      previous = luminance;
      previousHex = hex;
    }
    table.push(hex);
  }
  return table;
})();

/**
 * Colour for `value` within `[min, max]` (default -1 to 1). Values outside the range are
 * clamped, so `min` and below give the first stop and `max` and above the last.
 */
export function ndviRamp(value: number, min = -1, max = 1): string {
  if (!(max > min)) throw new Error("ndviRamp needs min < max");
  const span = max - min;
  const clamped = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : value > 0 ? max : min;
  const index = Math.round(((clamped - min) / span) * (TABLE_SIZE - 1));
  return TABLE[index] ?? NDVI_STOPS[0];
}
