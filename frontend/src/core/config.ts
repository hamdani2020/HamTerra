/**
 * Public configuration (Requirements 2.1 to 2.3). Only these `VITE_` values are read.
 * They are public by nature: they ship in the browser bundle and contain no secret.
 */
export interface PublicConfig {
  cognitoDomain: string;
  cognitoClientId: string;
  cognitoRegion: string;
  redirectUri: string;
  logoutUri: string;
  apiBaseUrl: string;
  basemapTileUrl: string;
}

export type ConfigResult =
  | { ok: true; config: PublicConfig }
  | { ok: false; missing: string[]; invalid: string[] };

export const DEFAULT_BASEMAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

interface VarSpec {
  name: string;
  key: keyof PublicConfig;
  required: boolean;
  url: boolean;
}

/** In display order. The basemap URL is optional and falls back to OpenStreetMap. */
export const CONFIG_VARS: readonly VarSpec[] = [
  { name: "VITE_API_BASE_URL", key: "apiBaseUrl", required: true, url: true },
  { name: "VITE_COGNITO_DOMAIN", key: "cognitoDomain", required: true, url: true },
  { name: "VITE_COGNITO_CLIENT_ID", key: "cognitoClientId", required: true, url: false },
  { name: "VITE_COGNITO_REGION", key: "cognitoRegion", required: true, url: false },
  { name: "VITE_REDIRECT_URI", key: "redirectUri", required: true, url: true },
  { name: "VITE_LOGOUT_URI", key: "logoutUri", required: true, url: true },
  { name: "VITE_BASEMAP_TILE_URL", key: "basemapTileUrl", required: false, url: true },
];

/** An absolute `http:` or `https:` URL with a host. Other schemes are rejected. */
export function isAbsoluteHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
}

/** Validate the environment. A failure lists variable names only, never their values. */
export function loadConfig(env: Record<string, unknown>): ConfigResult {
  const missing: string[] = [];
  const invalid: string[] = [];
  const values: Partial<Record<keyof PublicConfig, string>> = {};

  for (const spec of CONFIG_VARS) {
    const raw = env[spec.name];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value === "") {
      if (spec.required) missing.push(spec.name);
      continue;
    }
    if (spec.url && !isAbsoluteHttpUrl(value)) {
      invalid.push(spec.name);
      continue;
    }
    values[spec.key] = value;
  }

  if (missing.length > 0 || invalid.length > 0) return { ok: false, missing, invalid };
  return {
    ok: true,
    config: {
      apiBaseUrl: values.apiBaseUrl ?? "",
      cognitoDomain: values.cognitoDomain ?? "",
      cognitoClientId: values.cognitoClientId ?? "",
      cognitoRegion: values.cognitoRegion ?? "",
      redirectUri: values.redirectUri ?? "",
      logoutUri: values.logoutUri ?? "",
      basemapTileUrl: values.basemapTileUrl ?? DEFAULT_BASEMAP_TILE_URL,
    },
  };
}
