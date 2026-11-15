import { delay, http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, ApiTimeoutError, NetworkError } from "@/core/api/errors";
import { describeError, mapFieldErrors } from "@/lib/messages";

import { API, envelope } from "../msw/contract";
import { server } from "../msw/server";
import { makeApi } from "./apiHarness";

function countRequests(): { tokens: (string | null)[]; stop: () => void } {
  const tokens: (string | null)[] = [];
  const listener = ({ request }: { request: Request }): void => {
    tokens.push(request.headers.get("Authorization"));
  };
  server.events.on("request:start", listener);
  return { tokens, stop: () => server.events.removeListener("request:start", listener) };
}

describe("401: one renewal and one replay (Requirement 5.3)", () => {
  it("replays once with the renewed token and succeeds", async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/me`, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json(envelope("UNAUTHENTICATED"), { status: 401 })
          : HttpResponse.json({ sub: "s", username: "u", email: null, roles: [], permissions: [] });
      }),
    );
    const { api, auth } = makeApi();
    const counter = countRequests();
    expect((await api.getMe()).sub).toBe("s");
    counter.stop();
    expect(auth.renewCalls).toBe(1);
    expect(counter.tokens).toEqual(["Bearer access-token-1", "Bearer renewed-1"]);
    expect(auth.endCalls).toBe(0);
  });

  it("ends the session when the replay is also 401", async () => {
    server.use(http.get(`${API}/me`, () => HttpResponse.json(envelope("UNAUTHENTICATED"), { status: 401 })));
    const { api, auth } = makeApi();
    const counter = countRequests();
    await expect(api.getMe()).rejects.toBeInstanceOf(ApiError);
    counter.stop();
    expect(counter.tokens).toHaveLength(2);
    expect(auth.renewCalls).toBe(1);
    expect(auth.endCalls).toBe(1);
  });

  it("ends the session without a replay when renewal fails", async () => {
    server.use(http.get(`${API}/me`, () => HttpResponse.json(envelope("UNAUTHENTICATED"), { status: 401 })));
    const { api, auth } = makeApi();
    auth.renewResult = false;
    const counter = countRequests();
    await expect(api.getMe()).rejects.toBeInstanceOf(ApiError);
    counter.stop();
    expect(counter.tokens).toHaveLength(1);
    expect(auth.endCalls).toBe(1);
  });
});

describe("other statuses", () => {
  it("403: no retry, session kept, permission message", async () => {
    server.use(http.get(`${API}/admin/dashboard`, () => HttpResponse.json(envelope("FORBIDDEN"), { status: 403 })));
    const { api, auth } = makeApi();
    const counter = countRequests();
    const error = await api.getAdminDashboard().catch((e: unknown) => e);
    counter.stop();
    expect(counter.tokens).toHaveLength(1);
    expect(auth.renewCalls + auth.endCalls).toBe(0);
    expect(describeError(error)).toMatchObject({ kind: "forbidden", body: "You do not have permission for this action.", retry: false });
  });

  it("422: field errors go to matching fields, the rest to the form", async () => {
    const fields = [
      { field: "name", reason: "must not be blank" },
      { field: "thresholds.ndvi_diff", reason: "must be at most 2.00" },
    ];
    server.use(http.post(`${API}/admin/areas`, () => HttpResponse.json(envelope("VALIDATION_ERROR", "The request is not valid.", { fields }), { status: 422 })));
    const error = (await makeApi().api.createAdminArea({ name: "", geometry: { type: "Polygon", coordinates: [] } }).catch((e: unknown) => e)) as ApiError;
    expect(mapFieldErrors(error.details, ["name", "geometry"])).toEqual({
      fieldErrors: { name: "must not be blank" },
      formErrors: ["thresholds.ndvi_diff: must be at most 2.00"],
    });
    expect(describeError(error).kind).toBe("validation");
  });

  it.each([
    [502, "UPSTREAM_ERROR"],
    [503, "SERVICE_UNAVAILABLE"],
    [504, "UPSTREAM_TIMEOUT"],
  ])("%s: temporarily unavailable with a manual retry and no automatic one", async (status, code) => {
    server.use(http.get(`${API}/areas`, () => HttpResponse.json(envelope(code), { status })));
    const counter = countRequests();
    const error = await makeApi().api.listAreas().catch((e: unknown) => e);
    counter.stop();
    expect(counter.tokens).toHaveLength(1);
    expect(describeError(error)).toMatchObject({
      kind: "unavailable",
      title: "A data provider or service is temporarily unavailable",
      retry: true,
    });
  });

  it("500: generic message with the request id", async () => {
    server.use(http.get(`${API}/areas`, () => HttpResponse.json(envelope("INTERNAL_ERROR", "x", {}, "req-abc-123"), { status: 500 })));
    const display = describeError(await makeApi().api.listAreas().catch((e: unknown) => e));
    expect(display).toMatchObject({ kind: "internal", body: "An unexpected error occurred.", requestId: "req-abc-123" });
  });

  it("413 and 501: too large and not available", async () => {
    server.use(
      http.post(`${API}/admin/areas`, () => HttpResponse.json(envelope("PAYLOAD_TOO_LARGE"), { status: 413 })),
      http.get(`${API}/reports/:id`, () => HttpResponse.json(envelope("NOT_IMPLEMENTED"), { status: 501 })),
    );
    const { api } = makeApi();
    expect(describeError(await api.createAdminArea({ name: "A", geometry: { type: "Polygon", coordinates: [] } }).catch((e: unknown) => e)).title).toBe("The submitted content is too large");
    expect(describeError(await api.getReport("r", "pdf").catch((e: unknown) => e)).title).toBe("Not available in this version");
  });

  it("unknown code: the Backend message; non-envelope body: a generic message", async () => {
    server.use(http.get(`${API}/areas`, () => HttpResponse.json(envelope("BRAND_NEW_CODE", "A new Backend message."), { status: 400 })));
    const { api } = makeApi();
    expect(describeError(await api.listAreas().catch((e: unknown) => e)).body).toBe("A new Backend message.");
    server.use(http.get(`${API}/areas`, () => new HttpResponse("<html>Bad gateway</html>", { status: 502 })));
    const display = describeError(await api.listAreas().catch((e: unknown) => e));
    expect(display.body).not.toContain("html");
    expect(display.requestId).toBeUndefined();
  });

  it("network failure", async () => {
    server.use(http.get(`${API}/areas`, () => HttpResponse.error()));
    const error = await makeApi().api.listAreas().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(describeError(error)).toMatchObject({ kind: "network", retry: true });
  });
});

describe("timeouts and cancellation (Requirement 5.13)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts a refresh after 130 s and other calls after 30 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    server.use(
      http.post(`${API}/areas/:id/observations/refresh`, async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
      http.get(`${API}/areas`, async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    const { api } = makeApi();
    let refreshError: unknown = null;
    const refresh = api
      .refreshObservations("a1", { date_from: "2026-01-01", date_to: "2026-01-31" })
      .catch((e: unknown) => {
        refreshError = e;
      });
    let listError: unknown = null;
    const list = api.listAreas().catch((e: unknown) => {
      listError = e;
    });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(listError).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await list;
    expect(listError).toBeInstanceOf(ApiTimeoutError);

    await vi.advanceTimersByTimeAsync(129_999 - 30_000);
    expect(refreshError).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await refresh;
    expect(refreshError).toBeInstanceOf(ApiTimeoutError);
    expect((refreshError as ApiTimeoutError).timeoutMs).toBe(130_000);
    expect(describeError(refreshError).kind).toBe("timeout");
  });

  it("treats a caller abort as a cancellation, not a timeout", async () => {
    server.use(
      http.get(`${API}/areas`, async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    const controller = new AbortController();
    const pending = makeApi().api.listAreas({}, { signal: controller.signal });
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
  });
});
