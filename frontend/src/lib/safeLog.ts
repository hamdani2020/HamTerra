/**
 * The only console output in the application (Requirement 2.7). Tokens and Authorization
 * values are removed before anything is written; callers never pass response bodies.
 */
const REDACTED_KEYS = /^(authorization|access_token|refresh_token|id_token|code_verifier|token)$/i;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;

export function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.replace(BEARER, "$1 [REDACTED]");
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, v]) => [
      key,
      REDACTED_KEYS.test(key) ? "[REDACTED]" : redactValue(v, depth + 1),
    ]),
  );
}

export function safeLog(level: "info" | "warn" | "error", message: string, context?: unknown): void {
  const text = redactValue(message) as string;
  if (context === undefined) {
    console[level](text);
  } else {
    console[level](text, redactValue(context));
  }
}
