import type { ErrorEnvelope } from "@/types/api";

/** A non-2xx Backend response, parsed from its Error_Envelope when it has one. */
export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> | null,
    readonly requestId: string | null,
    /** False when the body was not a valid Error_Envelope. */
    readonly enveloped: boolean,
  ) {
    super(message);
  }
}

/** The network was unreachable or the response could not be read. */
export class NetworkError extends Error {
  override readonly name = "NetworkError";
  constructor() {
    super("The network request failed.");
  }
}

/** No complete response within the client timeout (30 s, 130 s for refresh). */
export class ApiTimeoutError extends Error {
  override readonly name = "ApiTimeoutError";
  constructor(readonly timeoutMs: number) {
    super(`No response within ${Math.round(timeoutMs / 1000)} seconds.`);
  }
}

/** A request to a host outside the allow-list. Nothing was sent. */
export class DisallowedHostError extends Error {
  override readonly name = "DisallowedHostError";
  constructor(reason: string) {
    super(`Request refused: ${reason}`);
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  if (typeof body !== "object" || body === null) return false;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return false;
  const e = error as Record<string, unknown>;
  const details = e.details;
  const requestId = e.request_id;
  return (
    typeof e.code === "string" &&
    e.code !== "" &&
    typeof e.message === "string" &&
    (details === null || details === undefined || (typeof details === "object" && !Array.isArray(details))) &&
    (requestId === null || requestId === undefined || typeof requestId === "string")
  );
}

/** Turn any non-2xx status and body into an ApiError. Never throws. */
export function parseError(status: number, body: unknown): ApiError {
  if (isErrorEnvelope(body)) {
    const { code, message, details, request_id } = body.error;
    return new ApiError(
      status,
      code,
      message,
      (details as Record<string, unknown> | null | undefined) ?? null,
      request_id ?? null,
      true,
    );
  }
  return new ApiError(status, "UNKNOWN", "", null, null, false);
}
