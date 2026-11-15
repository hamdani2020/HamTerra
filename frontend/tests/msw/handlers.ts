import { http, HttpResponse, type RequestHandler } from "msw";

import {
  API,
  API_ORIGIN,
  buildAdminUser,
  buildArea,
  buildAreaMap,
  buildAuditEvent,
  buildComparison,
  buildDashboard,
  buildIntegrations,
  buildMe,
  buildObservation,
  buildObservationPage,
  buildPublicSettings,
  buildRefreshResult,
  buildReport,
  buildReportSummary,
  buildRetrieval,
  buildRoleChange,
  buildSetting,
  buildTimeSeries,
  page,
} from "./contract";

/**
 * A success handler for every endpoint in the Backend contract, grouped as in the
 * contract table. Tests replace individual handlers with `server.use(...)` for errors.
 */
export const contractHandlers = {
  health: [
    http.get(`${API_ORIGIN}/health/live`, () => HttpResponse.json({ status: "ok" })),
    http.get(`${API_ORIGIN}/health/ready`, () =>
      HttpResponse.json({ status: "ok", checks: { database: "ok", migrations: "ok" } }),
    ),
  ],
  identity: [http.get(`${API}/me`, () => HttpResponse.json(buildMe()))],
  areas: [
    http.get(`${API}/areas`, () => HttpResponse.json(page([buildArea()]))),
    http.get(`${API}/areas/map`, () => HttpResponse.json(buildAreaMap())),
    http.get(`${API}/areas/:areaId`, ({ params }) =>
      HttpResponse.json(buildArea({ id: String(params.areaId) })),
    ),
  ],
  observations: [
    http.get(`${API}/areas/:areaId/observations`, () => HttpResponse.json(buildObservationPage())),
    http.get(`${API}/observations/:id`, ({ params }) =>
      HttpResponse.json(buildObservation({ id: String(params.id) })),
    ),
    http.get(`${API}/observations/:id/preview`, () =>
      HttpResponse.arrayBuffer(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer, {
        headers: { "Content-Type": "image/png" },
      }),
    ),
    http.post(`${API}/areas/:areaId/observations/refresh`, () => HttpResponse.json(buildRefreshResult())),
  ],
  analysis: [
    http.get(`${API}/areas/:areaId/ndvi/timeseries`, () => HttpResponse.json(buildTimeSeries())),
    http.post(`${API}/areas/:areaId/comparisons`, () => HttpResponse.json(buildComparison())),
  ],
  reports: [
    http.post(`${API}/reports`, () => HttpResponse.json(buildReport(), { status: 201 })),
    http.get(`${API}/reports`, () => HttpResponse.json(page([buildReportSummary()]))),
    http.get(`${API}/reports/:id`, ({ params }) => HttpResponse.json(buildReport({ id: String(params.id) }))),
  ],
  settings: [
    http.get(`${API}/settings`, () => HttpResponse.json(buildPublicSettings())),
    http.get(`${API}/admin/settings`, () => HttpResponse.json({ items: [buildSetting()] })),
    http.put(`${API}/admin/settings/:key`, async ({ params, request }) => {
      const body = (await request.json()) as { value: number };
      return HttpResponse.json(buildSetting({ key: String(params.key), value: body.value }));
    }),
  ],
  adminUsers: [
    http.get(`${API}/admin/users`, () => HttpResponse.json(page([buildAdminUser()]))),
    http.get(`${API}/admin/users/:sub`, ({ params }) => HttpResponse.json(buildAdminUser({ sub: String(params.sub) }))),
    http.put(`${API}/admin/users/:sub/roles`, () => HttpResponse.json(buildRoleChange())),
  ],
  adminAreas: [
    http.post(`${API}/admin/areas`, () => HttpResponse.json(buildArea(), { status: 201 })),
    http.patch(`${API}/admin/areas/:areaId`, () => HttpResponse.json(buildArea())),
    http.post(`${API}/admin/areas/:areaId/archive`, () => HttpResponse.json(buildArea({ status: "archived" }))),
    http.post(`${API}/admin/areas/:areaId/restore`, () => HttpResponse.json(buildArea())),
  ],
  adminOps: [
    http.get(`${API}/admin/retrievals`, () => HttpResponse.json(page([buildRetrieval()], { limit: 25 }))),
    http.get(`${API}/admin/integrations/status`, () => HttpResponse.json(buildIntegrations())),
    http.get(`${API}/admin/activity`, () => HttpResponse.json(page([buildAuditEvent()], { limit: 25 }))),
    http.get(`${API}/admin/dashboard`, () => HttpResponse.json(buildDashboard())),
  ],
} satisfies Record<string, RequestHandler[]>;

/** Installed by default; unknown requests still fail (tests/setup.ts). */
export const handlers: RequestHandler[] = Object.values(contractHandlers).flat();
