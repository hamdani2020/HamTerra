/**
 * The only module that calls `fetch` for the Backend (structure steering). It attaches the
 * bearer token, applies the timeout and caller cancellation, renews once on 401 and replays
 * once, and turns every failure into a typed error.
 */
import { ApiTimeoutError, NetworkError, isAbortError, parseError } from "@/core/api/errors";
import type { HttpGuard } from "@/core/api/httpGuard";
import { clampLimit, clampOffset } from "@/lib/pagination";

/** What the client needs from the Auth_Module (task 7). */
export interface AuthProvider {
  getAccessToken(): Promise<string | null>;
  /** Single-flight renewal; true when a new access token is available. */
  renew(): Promise<boolean>;
  endSession(reason: "expired"): void;
}

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH";
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
  /** False for the unversioned health endpoints, which take no token. */
  auth?: boolean;
  /** True for paths outside the API base path (health). */
  root?: boolean;
  responseType?: "json" | "blob";
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const REFRESH_TIMEOUT_MS = 130_000;

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  readonly guard: HttpGuard;
}

export function buildQuery(path: string, query: Record<string, QueryValue> = {}): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(query)) {
    if (raw === undefined || raw === null || raw === "") continue;
    let value = raw;
    if (key === "limit" && typeof raw === "number") value = clampLimit(path, raw);
    if (key === "offset" && typeof raw === "number") value = clampOffset(raw);
    params.set(key, String(value));
  }
  return params;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function createApiClient(
  guard: HttpGuard,
  auth: AuthProvider,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): ApiClient {
  async function send(
    url: URL,
    options: RequestOptions,
    token: string | null,
  ): Promise<Response> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = (): void => controller.abort();
    if (options.signal?.aborted) controller.abort();
    options.signal?.addEventListener("abort", onCallerAbort, { once: true });

    const headers: Record<string, string> = { Accept: options.responseType === "blob" ? "*/*" : "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    try {
      return await fetchImpl(url.toString(), {
        method: options.method ?? "GET",
        headers,
        body,
        signal: controller.signal,
        credentials: "omit",
        redirect: "error",
      });
    } catch (error) {
      if (timedOut) throw new ApiTimeoutError(timeoutMs);
      if (options.signal?.aborted || isAbortError(error)) {
        throw new DOMException("The request was aborted.", "AbortError");
      }
      throw new NetworkError();
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const useAuth = options.auth !== false;
    const query = buildQuery(path, options.query);
    // Built before any token is requested, so a refused URL sends nothing.
    const url = options.root ? guard.apiRootUrl(path) : guard.apiUrl(path, query);

    let replayed = false;
    for (;;) {
      const token = useAuth ? await auth.getAccessToken() : null;
      const response = await send(url, options, token);

      if (response.ok) {
        if (options.responseType === "blob") return (await response.blob()) as T;
        return (await readBody(response)) as T;
      }

      const error = parseError(response.status, await readBody(response));
      if (response.status === 401 && useAuth) {
        if (!replayed && (await auth.renew())) {
          replayed = true;
          continue;
        }
        auth.endSession("expired");
      }
      throw error;
    }
  }

  return { request, guard };
}

