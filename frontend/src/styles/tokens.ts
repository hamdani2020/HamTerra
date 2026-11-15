/**
 * Design tokens (Requirement 21.1, 21.6). The hex values here are the single source of
 * truth; `globals.css` declares the same colours as RGB channels and a unit test checks
 * that both agree. Status colours are for status only.
 */
export const TOKENS = {
  "emerald-700": "#047857", // primary
  "emerald-600": "#059669", // secondary
  "emerald-900": "#064E3B", // dark accent
  "emerald-100": "#D1FAE5", // light accent
  "green-50": "#F0FDF4", // subtle background
  "slate-50": "#F8FAFC", // main background
  surface: "#FFFFFF",
  "slate-900": "#0F172A", // primary text
  "slate-600": "#475569", // secondary text
  "slate-200": "#E2E8F0", // decorative border
  // Not in the token list: the boundary of form controls must reach 3:1 against the
  // surface (Requirement 21.3); Slate 200 is about 1.2:1.
  "slate-500": "#64748B",
  "status-success": "#15803D",
  "status-success-bg": "#DCFCE7",
  "status-warning": "#B45309",
  "status-warning-bg": "#FEF3C7",
  "status-error": "#B91C1C",
  "status-error-bg": "#FEE2E2",
  "status-info": "#1D4ED8",
  "status-info-bg": "#DBEAFE",
  "focus-ring": "#0F172A",
} as const;

export type TokenName = keyof typeof TOKENS;

export type PairKind = "body" | "large" | "boundary";

/** Foreground and background pairs the interface uses, with the contrast they need. */
export const TOKEN_PAIRS: readonly { fg: TokenName; bg: TokenName; kind: PairKind; use: string }[] = [
  { fg: "slate-900", bg: "slate-50", kind: "body", use: "body text on the page" },
  { fg: "slate-900", bg: "surface", kind: "body", use: "body text on cards" },
  { fg: "slate-600", bg: "surface", kind: "body", use: "secondary text on cards" },
  { fg: "slate-600", bg: "slate-50", kind: "body", use: "secondary text on the page" },
  { fg: "surface", bg: "emerald-700", kind: "body", use: "primary button text" },
  { fg: "emerald-700", bg: "surface", kind: "body", use: "links and active navigation" },
  { fg: "emerald-900", bg: "emerald-100", kind: "body", use: "selected and accent states" },
  { fg: "slate-900", bg: "green-50", kind: "body", use: "text on the landing background" },
  { fg: "status-success", bg: "status-success-bg", kind: "body", use: "success status" },
  { fg: "status-warning", bg: "status-warning-bg", kind: "body", use: "warning status" },
  { fg: "status-error", bg: "status-error-bg", kind: "body", use: "error status" },
  { fg: "status-info", bg: "status-info-bg", kind: "body", use: "information status" },
  { fg: "surface", bg: "status-error", kind: "body", use: "destructive button text" },
  { fg: "slate-500", bg: "surface", kind: "boundary", use: "form control border" },
  { fg: "focus-ring", bg: "surface", kind: "boundary", use: "focus ring on light surfaces" },
  { fg: "focus-ring", bg: "emerald-700", kind: "boundary", use: "focus ring beside a primary button" },
  { fg: "emerald-700", bg: "surface", kind: "boundary", use: "selected state outline" },
];

export const REQUIRED_RATIO: Record<PairKind, number> = { body: 4.5, large: 3, boundary: 3 };

/** `#RRGGBB` to the `R G B` channel triple used by the CSS variables. */
export function hexToChannels(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
