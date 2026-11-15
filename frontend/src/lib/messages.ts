/**
 * The single module that maps Backend warning and error codes to display text, and holds
 * every Frontend-authored sentence about evidence (Requirements 20.10, 20.11).
 *
 * Backend `summary_text`, `limitations`, `caveats` and warning messages are not rewritten
 * here; they are rendered unchanged by `VerbatimText`. A Backend message is used only when
 * a code has no authored text, or for `AREA_OUT_OF_RANGE`, whose message states the limit.
 */
import {
  ApiError,
  ApiTimeoutError,
  DisallowedHostError,
  isAbortError,
  NetworkError,
} from "@/core/api/errors";
import type { DisplayError, FieldError } from "@/types/api";
import type { FlagStatus, QualityLevel } from "@/types/display";

export const WARNING_TEXT = {
  INSUFFICIENT_OBSERVATIONS:
    "Fewer than two observations are available, so no summary statistics or trend are shown.",
  IRREGULAR_SAMPLING: "Observations are unevenly spaced; gaps exceed the threshold.",
  WEATHER_UNAVAILABLE: "Weather context could not be retrieved for some or all dates.",
  WEATHER_DISABLED: "Weather context is turned off.",
  LOW_QUALITY_OBSERVATION:
    "At least one of the observations has low quality for the limits applied.",
  SEASONALITY_NOT_CONTROLLED:
    "The interval is not a whole number of years, so seasonal effects are not controlled.",
  DATA_COVERAGE_UNKNOWN: "Data coverage was not reported by the provider.",
  ITEMS_DISCARDED: "Some provider items were incomplete or invalid and were not stored.",
  INVALID_CLOUD_COVERAGE: "Cloud coverage is missing or outside 0 to 100%.",
  WEATHER_INVALID_DATA: "Some weather values were invalid and are not shown.",
  PERCENT_DIFFERENCE_UNDEFINED:
    "The percentage difference is not defined because the earlier mean NDVI is 0.",
  // Sent by the Backend with a partial refresh (backend design, Error Handling).
  UPSTREAM_ERROR:
    "The retrieval is incomplete because the data provider failed for at least one sensor.",
} as const satisfies Record<string, string>;

export const ERROR_TEXT = {
  UNAUTHENTICATED: "Your session has expired. Sign in again.",
  FORBIDDEN: "You do not have permission for this action.",
  VALIDATION_ERROR: "Some values are not valid. Check the highlighted fields.",
  NOT_FOUND: "The requested item was not found.",
  CONFLICT: "The request conflicts with the current state, for example a name already in use.",
  GEOMETRY_OUTSIDE_GHANA: "The polygon is not entirely within Ghana.",
  // Fallback only: the Backend message, which states the limit, is shown when present.
  AREA_OUT_OF_RANGE: "The area is outside the permitted size range.",
  CROSS_SENSOR_COMPARISON: "Observations from different sensors cannot be compared.",
  NO_OBSERVATIONS: "No observations are stored for this area, sensor and period.",
  REFRESH_IN_PROGRESS: "A refresh for this area is already running. Try again later.",
  LAST_ADMIN: "The last administrator cannot lose the admin role.",
  SELF_ROLE_CHANGE: "You cannot change your own roles.",
  COGNITO_ADMIN_NOT_ENABLED: "Role changes are not enabled on this deployment.",
  UPSTREAM_ERROR: "The data provider failed. Previously stored data is unchanged.",
  UPSTREAM_TIMEOUT:
    "The data provider did not respond in time. Previously stored data is unchanged.",
  NOT_IMPLEMENTED: "This feature is not available in this version.",
  PAYLOAD_TOO_LARGE: "The request is too large.",
  SERVICE_UNAVAILABLE: "The service is temporarily unavailable. Try again shortly.",
  INTERNAL_ERROR: "An unexpected error occurred.",
} as const satisfies Record<string, string>;

export type KnownWarningCode = keyof typeof WARNING_TEXT;
export type KnownErrorCode = keyof typeof ERROR_TEXT;

/** Error codes whose Backend message is preferred over the authored text. */
const BACKEND_MESSAGE_FIRST: ReadonlySet<string> = new Set<KnownErrorCode>(["AREA_OUT_OF_RANGE"]);

export const EVIDENCE_TEXT = {
  aggregateNote: "NDVI values are polygon-level aggregates.",
  flagged: "Flagged for investigation",
  notFlagged: "Not flagged",
  spatialUnavailable:
    "Spatial analysis is not available; the values describe the polygon as a whole.",
  previewOrientation: "Low-resolution preview, for orientation only.",
  previewPosition: "The overlay position is approximate and is not used for analysis.",
  trendLabel: "Linear trend (NDVI per 30 days)",
  notAvailable: "Not available",
  notReported: "Not reported",
} as const;

/**
 * Sign-in failure classes (Requirements 3.3, 3.4). Only the class is shown, never the
 * provider's `error_description` or any token.
 */
export const AUTH_FAILURE_TEXT = {
  state_mismatch: {
    title: "Sign-in could not be verified (state mismatch)",
    body: "The sign-in response did not match the request started in this tab. Start sign-in again.",
  },
  access_denied: {
    title: "Sign-in was not completed (access denied)",
    body: "The sign-in service did not grant access. Start sign-in again or contact an administrator.",
  },
  token_exchange_failed: {
    title: "Sign-in failed (token exchange failed)",
    body: "The sign-in service did not accept the sign-in request. Start sign-in again.",
  },
  network_failure: {
    title: "Sign-in failed (network failure)",
    body: "The sign-in service could not be reached or did not respond within 10 seconds. Check the connection and start sign-in again.",
  },
} as const satisfies Record<string, { title: string; body: string }>;

export const AUTH_TEXT = {
  appName: "Eco-Sentinel Ghana",
  landingIntro:
    "Satellite observations, NDVI statistics and weather context for monitoring areas in Ghana. Sign in with your organisation account to continue.",
  signIn: "Sign in",
  signInAgain: "Sign in again",
  redirecting: "Redirecting to sign-in…",
  restoring: "Restoring your session…",
  signInStartFailed: "Sign-in could not be started. Reload the page and try again.",
  sessionEndedTitle: "Session ended",
  sessionExpired: ERROR_TEXT.UNAUTHENTICATED,
  callbackTitle: "Completing sign-in",
  callbackBody: "Checking the sign-in response…",
  signedOutTitle: "You have signed out",
  signedOutBody: "Your session in this tab has ended.",
  authErrorFallbackTitle: "Sign-in was not completed",
  authErrorFallbackBody: "Start sign-in again.",
  backToSignIn: "Back to the sign-in page",
} as const;

/** Notices carried in router state and shown by `NoticeHost` (Requirement 1.7). */
export const NOTICE_TEXT = {
  ADMIN_REQUIRED: "That page requires the admin role. You have been returned to the dashboard.",
} as const satisfies Record<string, string>;

export const SHELL_TEXT = {
  skipLink: "Skip to main content",
  openMenu: "Open navigation menu",
  navLabel: "Main navigation",
  navTitle: "Navigation",
  adminGroup: "Administration",
  signOut: "Sign out",
  signedInAs: "Signed in as",
  dismiss: "Dismiss notice",
  noticeTitle: "Notice",
  loadingAccount: "Loading your account…",
  accountErrorTitle: "Your account could not be loaded",
  retry: "Try again",
  requestId: "Request ID",
  noRoleTitle: "No role assigned",
  noRoleBody:
    "Your account has no assigned role, so no pages are available. An administrator must add your user to the researcher or admin group in Cognito. Sign out, then sign in again after the change.",
  notFoundTitle: "Page not found",
  notFoundBody: "No page exists at this address.",
  toDashboard: "Go to the dashboard",
  toSignIn: "Go to the sign-in page",
  crashTitle: "Something went wrong",
  crashBody: "This page could not be displayed. Reload the page to try again.",
  reload: "Reload",
  placeholder: "This screen is not available yet.",
} as const;

/** "Flagged" is a numeric difference at or above a threshold, never a finding (20.2). */
export function flagDescription(flag: FlagStatus, difference: string, threshold: string): string {
  return flag === "flagged"
    ? `Difference of ${difference} is at or above the investigation threshold of ${threshold}.`
    : `Difference of ${difference} is below the investigation threshold of ${threshold}.`;
}

export const QUALITY_LABEL: Record<QualityLevel, string> = {
  good: "Good",
  limited: "Limited",
  poor: "Poor",
};

export const FLAG_LABEL: Record<FlagStatus, string> = {
  flagged: EVIDENCE_TEXT.flagged,
  not_flagged: EVIDENCE_TEXT.notFlagged,
};

export interface CodedMessage {
  code: string;
  message?: string | null | undefined;
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function hasKey<T extends object>(table: T, key: string): key is Extract<keyof T, string> {
  return Object.prototype.hasOwnProperty.call(table, key);
}

/** Authored text for a known code, else the Backend message, else a generic notice. */
export function warningText(warning: CodedMessage): string {
  if (hasKey(WARNING_TEXT, warning.code)) return WARNING_TEXT[warning.code];
  if (nonEmpty(warning.message)) return warning.message;
  return `Unrecognised notice (${warning.code})`;
}

/** As `warningText`, over the error codes; `AREA_OUT_OF_RANGE` prefers the Backend message. */
export function errorText(error: CodedMessage): string {
  if (BACKEND_MESSAGE_FIRST.has(error.code) && nonEmpty(error.message)) return error.message;
  if (hasKey(ERROR_TEXT, error.code)) return ERROR_TEXT[error.code];
  if (nonEmpty(error.message)) return error.message;
  return `Unrecognised error (${error.code})`;
}

/** Every Frontend-authored string in this module, for the forbidden-term check. */
export function authoredTextCatalogue(): string[] {
  return [
    ...Object.values(WARNING_TEXT),
    ...Object.values(ERROR_TEXT),
    ...Object.values(EVIDENCE_TEXT),
    ...Object.values(AUTH_FAILURE_TEXT).flatMap((t) => [t.title, t.body]),
    ...Object.values(AUTH_TEXT),
    ...Object.values(NOTICE_TEXT),
    ...Object.values(SHELL_TEXT),
    ...Object.values(QUALITY_LABEL),
    ...Object.values(FLAG_LABEL),
    flagDescription("flagged", "+0.1739", "0.1"),
    flagDescription("not_flagged", "+0.0500", "0.1"),
    warningText({ code: "SOME_NEW_CODE" }),
    errorText({ code: "SOME_NEW_CODE" }),
  ];
}

// --- Error display ------------------------------------------------------------------


const GENERIC_BODY = "An unexpected error occurred. Try again later.";

const TITLE: Record<DisplayError["kind"], string> = {
  unauthenticated: "Session expired",
  forbidden: "Permission required",
  validation: "Check the entered values",
  not_found: "Not found",
  conflict: "The request was not completed",
  too_large: "The submitted content is too large",
  not_implemented: "Not available in this version",
  unavailable: "A data provider or service is temporarily unavailable",
  internal: "Something went wrong",
  network: "Connection problem",
  timeout: "No response",
  unknown: "Something went wrong",
};

function kindForStatus(status: number): DisplayError["kind"] {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 413) return "too_large";
  if (status === 422 || status === 400) return "validation";
  if (status === 501) return "not_implemented";
  if (status === 502 || status === 503 || status === 504) return "unavailable";
  if (status === 500) return "internal";
  return "unknown";
}

/**
 * Turn any thrown value into display text. Total: never throws and always returns a
 * non-empty title and body. `details` is never used, so raw upstream text cannot appear
 * (Requirements 5.2, 5.7, 5.11, 5.12).
 */
export function describeError(error: unknown): DisplayError {
  try {
    if (error instanceof ApiError) {
      const kind = kindForStatus(error.status);
      const body = error.enveloped
        ? errorText({ code: error.code, message: error.message })
        : GENERIC_BODY;
      const display: DisplayError = {
        kind,
        title: TITLE[kind],
        body: body.trim() === "" ? GENERIC_BODY : body,
        retry: kind === "unavailable" || kind === "internal" || kind === "unknown",
      };
      if (error.requestId) display.requestId = error.requestId;
      return display;
    }
    if (error instanceof ApiTimeoutError) {
      return {
        kind: "timeout",
        title: TITLE.timeout,
        body: "The server did not respond in time. Check your connection and try again.",
        retry: true,
      };
    }
    if (error instanceof NetworkError) {
      return {
        kind: "network",
        title: TITLE.network,
        body: "The server could not be reached. Check your connection and try again.",
        retry: true,
      };
    }
    if (error instanceof DisallowedHostError) {
      return { kind: "unknown", title: TITLE.unknown, body: GENERIC_BODY, retry: false };
    }
    if (isAbortError(error)) {
      return { kind: "unknown", title: "Request cancelled", body: "The request was cancelled.", retry: true };
    }
  } catch {
    // Fall through to the generic description.
  }
  return { kind: "unknown", title: TITLE.unknown, body: GENERIC_BODY, retry: true };
}

/** Split `details.fields` into errors for displayed fields and form-level messages (5.5). */
export function mapFieldErrors(
  details: Record<string, unknown> | null | undefined,
  knownFields: readonly string[],
): { fieldErrors: Record<string, string>; formErrors: string[] } {
  const fieldErrors: Record<string, string> = {};
  const formErrors: string[] = [];
  const raw = details?.fields;
  if (!Array.isArray(raw)) return { fieldErrors, formErrors };
  for (const entry of raw as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { field, reason } = entry as Partial<FieldError>;
    if (typeof field !== "string" || typeof reason !== "string" || reason.trim() === "") continue;
    if (knownFields.includes(field)) {
      fieldErrors[field] = fieldErrors[field] ? `${fieldErrors[field]} ${reason}` : reason;
    } else {
      formErrors.push(`${field}: ${reason}`);
    }
  }
  return { fieldErrors, formErrors };
}
