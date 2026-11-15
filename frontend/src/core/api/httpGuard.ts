import type { PublicConfig } from "@/core/config";
import { DisallowedHostError } from "@/core/api/errors";

/**
 * Host allow-list (Requirement 2.5). The browser may contact only the API host, the
 * Cognito domain and the basemap tile host. A refused request is never sent.
 */
export interface HttpGuard {
  /** Build a Backend URL from a path relative to the API base path. */
  apiUrl(path: string, query?: URLSearchParams): URL;
  /** URL for an unversioned path on the API host, such as `/health/live`. */
  apiRootUrl(path: string): URL;
  /** Check an absolute URL against the allow-list and return it parsed. */
  check(url: string | URL): URL;
  /** The API base path, for example `/api/v1`. */
  readonly apiBasePath: string;
}

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function originOf(url: string): string {
  return new URL(url.replace(/[{}]/g, "x")).origin;
}

/** Reject paths that could leave the base path or the host. */
export function assertSafePath(path: string): void {
  if (!path.startsWith("/")) throw new DisallowedHostError("path must start with a single slash");
  if (path.startsWith("//")) throw new DisallowedHostError("protocol-relative path");
  if (path.includes("\\")) throw new DisallowedHostError("backslash in path");
  if (SCHEME.test(path.slice(1))) throw new DisallowedHostError("scheme in path");
  const segments = path.split(/[?#]/, 1)[0]?.split("/") ?? [];
  for (const segment of segments) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new DisallowedHostError("malformed path encoding");
    }
    if (decoded === ".." || decoded === ".") throw new DisallowedHostError("dot segment in path");
    if (decoded.includes("/") || decoded.includes("\\")) {
      throw new DisallowedHostError("encoded separator in path");
    }
  }
}

export function createHttpGuard(config: PublicConfig): HttpGuard {
  const api = new URL(config.apiBaseUrl);
  const apiBasePath = api.pathname.replace(/\/+$/, "");
  const allowed = new Set([api.origin, originOf(config.cognitoDomain), originOf(config.basemapTileUrl)]);

  function check(url: string | URL): URL {
    let parsed: URL;
    try {
      parsed = typeof url === "string" ? new URL(url) : url;
    } catch {
      throw new DisallowedHostError("not an absolute URL");
    }
    if (parsed.username || parsed.password) throw new DisallowedHostError("credentials in URL");
    if (!allowed.has(parsed.origin)) throw new DisallowedHostError(`host ${parsed.host} is not allowed`);
    return parsed;
  }

  function apiUrl(path: string, query?: URLSearchParams): URL {
    assertSafePath(path);
    const url = new URL(`${apiBasePath}${path}`, api.origin);
    if (url.origin !== api.origin || !url.pathname.startsWith(`${apiBasePath}/`)) {
      throw new DisallowedHostError("path leaves the API base");
    }
    if (query && [...query.keys()].length > 0) url.search = query.toString();
    return check(url);
  }

  function apiRootUrl(path: string): URL {
    assertSafePath(path);
    return check(new URL(path, api.origin));
  }

  return { apiUrl, apiRootUrl, check, apiBasePath };
}
