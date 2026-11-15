import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/core/api/errors";

import { API, API_ORIGIN, envelope } from "../msw/contract";
import { server } from "../msw/server";
import { makeApi } from "./apiHarness";

function fail(method: "get" | "post" | "put" | "patch", url: string, status: number, code: string, details = {}) {
  server.use(http[method](url, () => HttpResponse.json(envelope(code, `Backend ${code}`, details), { status })));
}

async function expectApiError(promise: Promise<unknown>, status: number, code: string): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  const apiError = error as ApiError;
  expect(apiError.status).toBe(status);
  expect(apiError.code).toBe(code);
  expect(apiError.requestId).toBe("req-test-1");
  return apiError;
}

describe("health", () => {
  it("reads liveness and readiness without a token", async () => {
    const { api, auth } = makeApi();
    expect(await api.getHealthLive()).toEqual({ status: "ok" });
    expect((await api.getHealthReady()).status).toBe("ok");
    expect(auth.getAccessToken).not.toHaveBeenCalled();
  });

  it("surfaces an unready Backend as an error", async () => {
    server.use(
      http.get(`${API_ORIGIN}/health/ready`, () =>
        HttpResponse.json({ status: "unavailable", failed: ["database"] }, { status: 503 }),
      ),
    );
    const error = await makeApi().api.getHealthReady().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(503);
    expect((error as ApiError).enveloped).toBe(false);
  });
});

describe("identity", () => {
  it("loads the principal", async () => {
    expect((await makeApi().api.getMe()).roles).toEqual(["researcher"]);
  });

  it("raises 401 after the single renewal fails", async () => {
    fail("get", `${API}/me`, 401, "UNAUTHENTICATED");
    const { api, auth } = makeApi();
    auth.renewResult = false;
    await expectApiError(api.getMe(), 401, "UNAUTHENTICATED");
    expect(auth.endCalls).toBe(1);
  });
});

describe("areas", () => {
  it("lists, maps and reads areas", async () => {
    const { api } = makeApi();
    expect((await api.listAreas({ q: "Prestea" })).total).toBe(1);
    expect((await api.getAreaMap()).type).toBe("FeatureCollection");
    expect((await api.getArea("a9")).id).toBe("a9");
  });

  it("reports a bad bbox and a missing area", async () => {
    fail("get", `${API}/areas`, 422, "VALIDATION_ERROR", { fields: [{ field: "bbox", reason: "bad" }] });
    fail("get", `${API}/areas/:id`, 404, "NOT_FOUND");
    const { api } = makeApi();
    await expectApiError(api.listAreas({ bbox: "1,2,3" }), 422, "VALIDATION_ERROR");
    await expectApiError(api.getArea("missing"), 404, "NOT_FOUND");
  });
});

describe("observations", () => {
  it("lists, reads, previews and refreshes", async () => {
    const { api } = makeApi();
    const list = await api.listObservations("a1", { source: "sentinel-2" });
    expect(list.meta.counts_by_source["sentinel-2"]).toBe(1);
    expect((await api.getObservation("o7")).id).toBe("o7");
    const blob = await api.fetchPreviewBlob("/api/v1/observations/o7/preview");
    expect(blob.size).toBe(4);
    expect((await api.refreshObservations("a1", { date_from: "2026-01-01", date_to: "2026-01-31" })).status).toBe("success");
  });

  it("reports refresh conflicts and provider failures, and refuses foreign preview URLs", async () => {
    fail("post", `${API}/areas/:id/observations/refresh`, 409, "REFRESH_IN_PROGRESS");
    fail("get", `${API}/observations/:id/preview`, 502, "UPSTREAM_ERROR");
    const { api } = makeApi();
    await expectApiError(api.refreshObservations("a1", { date_from: "2026-01-01", date_to: "2026-01-31" }), 409, "REFRESH_IN_PROGRESS");
    await expectApiError(api.fetchPreviewBlob("/api/v1/observations/o7/preview"), 502, "UPSTREAM_ERROR");
    expect(() => api.fetchPreviewBlob("https://evil.example/api/v1/observations/o7/preview")).toThrow(/not allowed/);
    expect(() => api.fetchPreviewBlob("/api/v1/areas/a1")).toThrow(/preview/);
  });
});

describe("analysis", () => {
  it("reads a time series and creates a comparison", async () => {
    const { api } = makeApi();
    expect((await api.getTimeSeries("a1", { source: "sentinel-2" })).limitations).toHaveLength(1);
    const comparison = await api.createComparison("a1", { source: "sentinel-2", date_a: "2026-03-06", date_b: "2026-04-30", include_weather: false });
    expect(comparison.spatial_analysis_available).toBe(false);
  });

  it("reports validation and missing observations", async () => {
    fail("get", `${API}/areas/:id/ndvi/timeseries`, 422, "VALIDATION_ERROR");
    fail("post", `${API}/areas/:id/comparisons`, 404, "NOT_FOUND", { missing_dates: ["2026-03-07"] });
    const { api } = makeApi();
    await expectApiError(api.getTimeSeries("a1", { source: "sentinel-2" }), 422, "VALIDATION_ERROR");
    await expectApiError(api.createComparison("a1", { source: "sentinel-2", date_a: "2026-03-06", date_b: "2026-03-07", include_weather: false }), 404, "NOT_FOUND");
  });
});

describe("reports", () => {
  it("creates, lists and reads reports", async () => {
    const { api } = makeApi();
    const report = await api.createReport({ area_id: "a1", source: "sentinel-2", date_from: "2026-01-01", date_to: "2026-04-30", include_weather: false });
    expect(report.caveats.length).toBeGreaterThan(0);
    expect((await api.listReports()).items).toHaveLength(1);
    expect((await api.getReport("r5")).id).toBe("r5");
  });

  it("reports no observations and an unavailable PDF", async () => {
    fail("post", `${API}/reports`, 422, "NO_OBSERVATIONS");
    fail("get", `${API}/reports/:id`, 501, "NOT_IMPLEMENTED");
    const { api } = makeApi();
    await expectApiError(api.createReport({ area_id: "a1", source: "sentinel-2", date_from: "2025-01-01", date_to: "2025-02-01", include_weather: false }), 422, "NO_OBSERVATIONS");
    await expectApiError(api.getReport("r5", "pdf"), 501, "NOT_IMPLEMENTED");
  });
});

describe("settings", () => {
  it("reads public and admin settings and updates one", async () => {
    const { api } = makeApi();
    expect((await api.getSettings()).gap_threshold_days).toBe(30);
    expect((await api.getAdminSettings()).items).toHaveLength(1);
    expect((await api.putAdminSetting("cloud_limit_pct", 15)).value).toBe(15);
  });

  it("reports forbidden and invalid values", async () => {
    fail("get", `${API}/admin/settings`, 403, "FORBIDDEN");
    fail("put", `${API}/admin/settings/:key`, 422, "VALIDATION_ERROR");
    const { api, auth } = makeApi();
    await expectApiError(api.getAdminSettings(), 403, "FORBIDDEN");
    await expectApiError(api.putAdminSetting("cloud_limit_pct", 500), 422, "VALIDATION_ERROR");
    expect(auth.endCalls).toBe(0);
  });
});

describe("admin users", () => {
  it("lists, reads and changes roles", async () => {
    const { api } = makeApi();
    expect((await api.listAdminUsers()).items[0]?.sub).toBe("sub-researcher");
    expect((await api.getAdminUser("x")).sub).toBe("x");
    expect((await api.putUserRoles("x", ["admin"])).effective_after_next_login).toBe(true);
  });

  it("reports last-admin and not-enabled role changes", async () => {
    const { api } = makeApi();
    fail("put", `${API}/admin/users/:sub/roles`, 409, "LAST_ADMIN");
    await expectApiError(api.putUserRoles("x", []), 409, "LAST_ADMIN");
    fail("put", `${API}/admin/users/:sub/roles`, 501, "COGNITO_ADMIN_NOT_ENABLED");
    await expectApiError(api.putUserRoles("x", []), 501, "COGNITO_ADMIN_NOT_ENABLED");
  });
});

describe("admin areas", () => {
  it("creates, edits, archives and restores", async () => {
    const { api } = makeApi();
    expect((await api.createAdminArea({ name: "A", geometry: { type: "Polygon", coordinates: [] } })).status).toBe("active");
    expect((await api.patchAdminArea("a1", { name: "B" })).id).toBeDefined();
    expect((await api.archiveAdminArea("a1")).status).toBe("archived");
    expect((await api.restoreAdminArea("a1")).status).toBe("active");
  });

  it("reports outside-Ghana, duplicate names and provider failure", async () => {
    const { api } = makeApi();
    fail("post", `${API}/admin/areas`, 422, "GEOMETRY_OUTSIDE_GHANA");
    await expectApiError(api.createAdminArea({ name: "A", geometry: { type: "Polygon", coordinates: [] } }), 422, "GEOMETRY_OUTSIDE_GHANA");
    fail("patch", `${API}/admin/areas/:id`, 409, "CONFLICT");
    await expectApiError(api.patchAdminArea("a1", { name: "Taken" }), 409, "CONFLICT");
    fail("post", `${API}/admin/areas`, 502, "UPSTREAM_ERROR");
    await expectApiError(api.createAdminArea({ name: "A", geometry: { type: "Polygon", coordinates: [] } }), 502, "UPSTREAM_ERROR");
  });
});

describe("admin operations", () => {
  it("reads retrievals, integrations, activity and the dashboard", async () => {
    const { api } = makeApi();
    expect((await api.listRetrievals()).limit).toBe(25);
    expect((await api.getIntegrationStatus()).agromonitoring.configured).toBe(true);
    expect((await api.listActivity()).items).toHaveLength(1);
    expect((await api.getAdminDashboard()).areas_active).toBe(1);
  });

  it("reports invalid filters", async () => {
    fail("get", `${API}/admin/retrievals`, 422, "VALIDATION_ERROR");
    fail("get", `${API}/admin/activity`, 422, "VALIDATION_ERROR");
    const { api } = makeApi();
    await expectApiError(api.listRetrievals({ date_from: "2026-02-02", date_to: "2026-02-01" }), 422, "VALIDATION_ERROR");
    await expectApiError(api.listActivity({ date_from: "2026-02-02", date_to: "2026-02-01" }), 422, "VALIDATION_ERROR");
  });
});

describe("request shaping", () => {
  it("sends clamped limits, encoded path segments and no empty query values", async () => {
    const urls: string[] = [];
    const listener = ({ request }: { request: Request }): void => {
      urls.push(request.url);
    };
    server.events.on("request:start", listener);
    const { api } = makeApi();
    await api.listAdminUsers({ limit: 500, offset: -3, q: "" });
    await api.getAdminUser("a b+c");
    server.events.removeListener("request:start", listener);
    expect(urls[0]).toBe(`${API}/admin/users?limit=100&offset=0`);
    expect(urls[1]).toBe(`${API}/admin/users/a%20b%2Bc`);
    // An identifier containing a slash would change the route, so it is refused unsent.
    await expect(api.getAdminUser("a/b")).rejects.toThrow(/encoded separator/);
    expect(urls).toHaveLength(2);
  });
});
