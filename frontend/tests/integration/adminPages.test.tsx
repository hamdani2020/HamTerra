import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import { ADMIN_TEXT, VALIDATION_TEXT, settingRangeError } from "@/lib/messages";
import type { SettingItem } from "@/types/api";

import { renderSignedIn } from "../auth/authHarness";
import { tokenRequests } from "../msw/cognito";
import {
  API,
  buildAdminUser,
  buildAuditEvent,
  buildIntegrations,
  buildRetrieval,
  buildRoleChange,
  buildSetting,
  envelope,
  page,
} from "../msw/contract";
import { server } from "../msw/server";

const ADMIN = { sub: "sub-admin", username: "admin1", roles: ["admin"], permissions: [] };

beforeEach(() => {
  sessionStorage.clear();
  tokenRequests.length = 0;
});

describe("admin overview (Requirement 16)", () => {
  it("keeps the other cards working when one card fails, and shows zero counts as 0", async () => {
    server.use(
      http.get(`${API}/admin/dashboard`, () => HttpResponse.json(envelope("INTERNAL_ERROR"), { status: 500 })),
      http.get(`${API}/admin/retrievals`, () =>
        HttpResponse.json(page([buildRetrieval({ status: "failed", error: { code: "UPSTREAM_TIMEOUT", message: "No answer in 30 s." } })], { limit: 5 })),
      ),
    );
    const { container } = await renderSignedIn("/admin", ADMIN);
    const counts = await screen.findByRole("region", { name: ADMIN_TEXT.countsTitle });
    expect(await within(counts).findByText(ADMIN_TEXT.countsError)).toBeInTheDocument();
    const integrations = screen.getByRole("region", { name: ADMIN_TEXT.integrationsTitle });
    expect(await within(integrations).findByRole("group", { name: ADMIN_TEXT.agromonitoring })).toBeInTheDocument();
    // failures_24h is 0 in the fixture.
    expect(within(integrations).getAllByText("0").length).toBeGreaterThan(0);
    const failures = screen.getByRole("region", { name: ADMIN_TEXT.failuresTitle });
    expect(await within(failures).findByText("UPSTREAM_TIMEOUT")).toBeInTheDocument();
    expect(within(failures).getByText("No answer in 30 s.")).toBeInTheDocument();
    const activity = screen.getByRole("region", { name: ADMIN_TEXT.activityTitle });
    expect(await within(activity).findByText("area.create")).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(await axe(container)).toHaveNoViolations();
  });

  it("disables the probe control while the probe runs and shows the result", async () => {
    let probes = 0;
    server.use(
      http.get(`${API}/admin/integrations/status`, async ({ request }) => {
        if (new URL(request.url).searchParams.get("probe") !== "true") return HttpResponse.json(buildIntegrations());
        probes += 1;
        await delay(100);
        const body = buildIntegrations();
        body.agromonitoring.probe = { ok: true, latency_ms: 120, outcome: "success" };
        return HttpResponse.json(body);
      }),
    );
    await renderSignedIn("/admin", ADMIN);
    const button = await screen.findByRole("button", { name: ADMIN_TEXT.probe });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(await screen.findByRole("button", { name: ADMIN_TEXT.probing })).toBeDisabled();
    expect(await screen.findByText(ADMIN_TEXT.probeOk)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ADMIN_TEXT.probe })).toBeEnabled();
    expect(probes).toBe(1);
  });

  it("keeps the status values and re-enables the control when the probe fails", async () => {
    server.use(
      http.get(`${API}/admin/integrations/status`, ({ request }) =>
        new URL(request.url).searchParams.get("probe") === "true"
          ? HttpResponse.json(envelope("UPSTREAM_ERROR"), { status: 502 })
          : HttpResponse.json(buildIntegrations()),
      ),
    );
    await renderSignedIn("/admin", ADMIN);
    const button = await screen.findByRole("button", { name: ADMIN_TEXT.probe });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(await screen.findByText(ADMIN_TEXT.probeError)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: ADMIN_TEXT.agromonitoring })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ADMIN_TEXT.probe })).toBeEnabled();
  });
});

describe("users and roles (Requirement 17)", () => {
  let puts: unknown[];
  beforeEach(() => {
    puts = [];
  });

  function installUsers(put: () => Response | Promise<Response> = () => HttpResponse.json(buildRoleChange())): void {
    const users = [buildAdminUser(), buildAdminUser({ sub: "sub-admin", username: "admin1", email: "admin@example.org", roles: ["admin"] })];
    server.use(
      http.get(`${API}/admin/users`, () => HttpResponse.json(page(users, { limit: 25 }))),
      http.get(`${API}/admin/users/:sub`, ({ params }) => HttpResponse.json(users.find((u) => u.sub === params.sub) ?? users[0])),
      http.put(`${API}/admin/users/:sub/roles`, async ({ request }) => {
        puts.push(await request.json());
        return put();
      }),
    );
  }

  async function openEditor(username = "researcher1") {
    const view = await renderSignedIn("/admin/users", ADMIN);
    const table = await screen.findByRole("table", { name: ADMIN_TEXT.usersCaption });
    await userEvent.click(within(table).getByRole("button", { name: `${ADMIN_TEXT.details}: ${username}` }));
    const details = await screen.findByRole("region", { name: ADMIN_TEXT.userDetails });
    const edit = await within(details).findByRole("button", { name: ADMIN_TEXT.editRoles });
    return { ...view, table, details, edit };
  }

  it("lists users with 'Not available' for a missing email and offers no create, reset or delete control", async () => {
    installUsers();
    const { container } = await renderSignedIn("/admin/users", ADMIN);
    const table = await screen.findByRole("table", { name: ADMIN_TEXT.usersCaption });
    expect(within(table).getByText(ADMIN_TEXT.notAvailableEmail)).toBeInTheDocument();
    expect(within(table).getByText("admin@example.org")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create|reset|delete/i })).toBeNull();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(await axe(container)).toHaveNoViolations();
  });

  it("sends the selected roles, disables confirm while pending and shows the Backend message", async () => {
    installUsers(async () => {
      await delay(100);
      return HttpResponse.json(buildRoleChange());
    });
    const { edit } = await openEditor();
    await userEvent.click(edit);
    const dialog = await screen.findByRole("dialog", { name: ADMIN_TEXT.roleEditorTitle });
    expect(within(dialog).getByRole("checkbox", { name: ADMIN_TEXT.roleResearcher })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: ADMIN_TEXT.roleAdmin }));
    await userEvent.click(within(dialog).getByRole("button", { name: ADMIN_TEXT.confirmRoles }));
    expect(within(dialog).getByRole("button", { name: ADMIN_TEXT.savingRoles })).toBeDisabled();
    expect(await screen.findByText(`${buildRoleChange().message} ${ADMIN_TEXT.afterNextLogin}`)).toBeInTheDocument();
    expect(puts).toEqual([{ roles: ["admin", "researcher"] }]);
  });

  it.each([
    ["LAST_ADMIN", ADMIN_TEXT.lastAdmin],
    ["SELF_ROLE_CHANGE", ADMIN_TEXT.selfChange],
  ])("409 %s shows its reason and leaves the roles unchanged", async (code, text) => {
    installUsers(() => HttpResponse.json(envelope(code), { status: 409 }));
    const { edit, details } = await openEditor();
    await userEvent.click(edit);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: ADMIN_TEXT.roleAdmin }));
    await userEvent.click(within(dialog).getByRole("button", { name: ADMIN_TEXT.confirmRoles }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(within(details).getByText("researcher")).toBeInTheDocument();
  });

  it("501 explains that role changes are not enabled and keeps the list readable", async () => {
    installUsers(() => HttpResponse.json(envelope("COGNITO_ADMIN_NOT_ENABLED"), { status: 501 }));
    const { edit, table } = await openEditor();
    await userEvent.click(edit);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: ADMIN_TEXT.confirmRoles }));
    expect(await screen.findByText(ADMIN_TEXT.notEnabled)).toBeInTheDocument();
    expect(within(table).getByText("researcher1")).toBeInTheDocument();
  });

  it.each([
    [404, "NOT_FOUND", ADMIN_TEXT.userNotFound],
    [502, "UPSTREAM_ERROR", ADMIN_TEXT.serviceUnavailable],
    [504, "UPSTREAM_TIMEOUT", ADMIN_TEXT.serviceUnavailable],
  ])("%i keeps the editor open with the selections", async (status, code, text) => {
    installUsers(() => HttpResponse.json(envelope(code), { status }));
    const { edit } = await openEditor();
    await userEvent.click(edit);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: ADMIN_TEXT.roleAdmin }));
    await userEvent.click(within(dialog).getByRole("button", { name: ADMIN_TEXT.confirmRoles }));
    expect(await within(dialog).findByText(text)).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: ADMIN_TEXT.roleAdmin })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: ADMIN_TEXT.roleResearcher })).toBeChecked();
  });

  it("disables the editor for the signed-in admin and shows the reason", async () => {
    installUsers();
    const { edit, details } = await openEditor("admin1");
    expect(edit).toBeDisabled();
    expect(within(details).getByText(ADMIN_TEXT.ownAccount)).toBeInTheDocument();
    expect(puts).toEqual([]);
  });
});

describe("retrievals and activity (Requirement 18)", () => {
  it("shows a date error on the retrievals filters and sends no request", async () => {
    const calls: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/admin/retrievals`, ({ request }) => {
        calls.push(new URL(request.url).searchParams);
        return HttpResponse.json(
          page([buildRetrieval({ status: "partial", error: { code: "ITEMS_DISCARDED", message: "2 items discarded." } })], { limit: 25 }),
        );
      }),
    );
    const { container } = await renderSignedIn("/admin/retrievals", ADMIN);
    const table = await screen.findByRole("table", { name: ADMIN_TEXT.retrievalsCaption });
    expect(within(table).getByText(ADMIN_TEXT.items)).toBeInTheDocument();
    expect(within(table).getByText("ITEMS_DISCARDED")).toBeInTheDocument();
    expect(within(table).getByText(/2 items discarded\./)).toBeInTheDocument();
    expect(within(table).getByText("Partial")).toBeInTheDocument();
    expect(calls[0]?.get("limit")).toBe("25");
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(await axe(container)).toHaveNoViolations();

    const before = calls.length;
    await userEvent.type(screen.getByLabelText(ADMIN_TEXT.dateFrom), "2026-05-02");
    await userEvent.type(screen.getByLabelText(ADMIN_TEXT.dateTo), "2026-05-01");
    await userEvent.click(screen.getByRole("button", { name: ADMIN_TEXT.apply }));
    expect(await screen.findByText(VALIDATION_TEXT.fromAfterTo)).toBeInTheDocument();
    expect(screen.getByLabelText(ADMIN_TEXT.dateFrom)).toHaveAttribute("aria-invalid", "true");
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.length).toBe(before);

    await userEvent.clear(screen.getByLabelText(ADMIN_TEXT.pageSize));
    await userEvent.type(screen.getByLabelText(ADMIN_TEXT.pageSize), "101");
    await userEvent.clear(screen.getByLabelText(ADMIN_TEXT.dateTo));
    await userEvent.click(screen.getByRole("button", { name: ADMIN_TEXT.apply }));
    expect(await screen.findByText(ADMIN_TEXT.pageSizeInvalid)).toBeInTheDocument();
    expect(calls.length).toBe(before);

    await userEvent.clear(screen.getByLabelText(ADMIN_TEXT.pageSize));
    await userEvent.type(screen.getByLabelText(ADMIN_TEXT.pageSize), "10");
    await userEvent.click(screen.getByRole("button", { name: ADMIN_TEXT.apply }));
    await waitFor(() => expect(calls.length).toBe(before + 1));
    expect(calls.at(-1)?.get("limit")).toBe("10");
    expect(calls.at(-1)?.get("date_from")).toBe("2026-05-02");
  });

  it("shows an error with retry and no stale rows when the retrievals call fails", async () => {
    let fail = false;
    server.use(
      http.get(`${API}/admin/retrievals`, () =>
        fail ? HttpResponse.json(envelope("INTERNAL_ERROR"), { status: 500 }) : HttpResponse.json(page([buildRetrieval({ kind: "first-run" })], { limit: 25 })),
      ),
    );
    await renderSignedIn("/admin/retrievals", ADMIN);
    expect(await screen.findByRole("table", { name: ADMIN_TEXT.retrievalsCaption })).toBeInTheDocument();
    fail = true;
    await userEvent.type(screen.getByLabelText(ADMIN_TEXT.areaId), "a2");
    await userEvent.click(screen.getByRole("button", { name: ADMIN_TEXT.apply }));
    expect(await screen.findByText(ADMIN_TEXT.retrievalsError)).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: ADMIN_TEXT.retrievalsCaption })).toBeNull();
    expect(screen.queryByText("first-run")).toBeNull();
    expect(screen.getByLabelText(ADMIN_TEXT.areaId)).toHaveValue("a2");
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("shows audit details as read-only key-value text and blocks a reversed date range", async () => {
    const calls: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/admin/activity`, ({ request }) => {
        calls.push(new URL(request.url).searchParams);
        return HttpResponse.json(page([buildAuditEvent({ outcome: "denied", details: { reason: "role", count: 2 } })], { limit: 25 }));
      }),
    );
    const { container } = await renderSignedIn("/admin/activity", ADMIN);
    const table = await screen.findByRole("table", { name: ADMIN_TEXT.activityCaption });
    expect(within(table).getByLabelText(`${ADMIN_TEXT.details}: area.create`)).toBeInTheDocument();
    expect(within(table).getByText("reason")).toBeInTheDocument();
    expect(within(table).getByText("role")).toBeInTheDocument();
    expect(within(table).getByText("Denied")).toBeInTheDocument();
    expect(within(table).queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /edit|delete/i })).toBeNull();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());

    const before = calls.length;
    await userEvent.type(screen.getByLabelText(ADMIN_TEXT.dateFrom), "2026-05-02");
    await userEvent.type(screen.getByLabelText(ADMIN_TEXT.dateTo), "2026-05-01");
    await userEvent.click(screen.getByRole("button", { name: ADMIN_TEXT.apply }));
    expect(await screen.findByText(VALIDATION_TEXT.fromAfterTo)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.length).toBe(before);
  });
});

describe("settings (Requirement 19)", () => {
  const ITEMS: SettingItem[] = [
    buildSetting(),
    buildSetting({ key: "gap_threshold_days", value: 30, type: "integer", default: 30, min: 1, max: 365 }),
    buildSetting({ key: "weather_enabled", value: true, type: "boolean", default: true, min: null, max: null }),
    buildSetting({ key: "future_key", value: 3, type: "integer", default: 3, min: null, max: null }),
  ];
  let puts: { key: string; body: unknown }[];
  let lists: number;

  function installSettings(put: (key: string) => Response | Promise<Response>): void {
    server.use(
      http.get(`${API}/admin/settings`, () => {
        lists += 1;
        return HttpResponse.json({ items: ITEMS });
      }),
      http.put(`${API}/admin/settings/:key`, async ({ params, request }) => {
        puts.push({ key: String(params.key), body: await request.json() });
        return put(String(params.key));
      }),
    );
  }

  beforeEach(() => {
    puts = [];
    lists = 0;
  });

  const input = (key: string) => screen.getByLabelText(`${ADMIN_TEXT.newValue}: ${key}`);
  const saveButton = (key: string) => screen.getByRole("button", { name: `${ADMIN_TEXT.save}: ${key}` });

  it("shows descriptions for known keys only and blocks save for an invalid value", async () => {
    installSettings(() => HttpResponse.json(ITEMS[0]));
    const { container } = await renderSignedIn("/admin/settings", ADMIN);
    expect(await screen.findByText("cloud_limit_pct")).toBeInTheDocument();
    expect(screen.getByText(/Highest cloud coverage/)).toBeInTheDocument();
    expect(screen.getByText("future_key")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: `${ADMIN_TEXT.newValue}: weather_enabled` })).toBeChecked();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.clear(input("cloud_limit_pct"));
    await userEvent.type(input("cloud_limit_pct"), "150");
    expect(screen.getByText(settingRangeError(0, 100))).toBeInTheDocument();
    expect(saveButton("cloud_limit_pct")).toBeDisabled();
    await userEvent.clear(input("gap_threshold_days"));
    await userEvent.type(input("gap_threshold_days"), "2.5");
    expect(screen.getByText(ADMIN_TEXT.settingNotInteger)).toBeInTheDocument();
    expect(saveButton("gap_threshold_days")).toBeDisabled();
    expect(puts).toEqual([]);
  });

  it("replaces the row on 200 and notes that stored reports are unchanged", async () => {
    installSettings(() => HttpResponse.json({ ...ITEMS[0], value: 35, updated_by: "admin1", updated_at: "2026-05-02T09:00:00Z" }));
    await renderSignedIn("/admin/settings", ADMIN);
    await screen.findByText("cloud_limit_pct");
    await userEvent.clear(input("cloud_limit_pct"));
    await userEvent.type(input("cloud_limit_pct"), "35");
    await userEvent.click(saveButton("cloud_limit_pct"));
    expect(await screen.findByText(ADMIN_TEXT.settingSaved)).toBeInTheDocument();
    expect(puts).toEqual([{ key: "cloud_limit_pct", body: { value: 35 } }]);
    expect(within(input("cloud_limit_pct").closest("li") as HTMLElement).getByText("admin1")).toBeInTheDocument();
  });

  it("shows the Backend message on 422, keeps the stored value and the edit", async () => {
    installSettings(() =>
      HttpResponse.json(envelope("VALIDATION_ERROR", "Invalid request.", { fields: [{ field: "value", reason: "Must be at most 90." }] }), { status: 422 }),
    );
    await renderSignedIn("/admin/settings", ADMIN);
    await screen.findByText("cloud_limit_pct");
    await userEvent.clear(input("cloud_limit_pct"));
    await userEvent.type(input("cloud_limit_pct"), "95");
    await userEvent.click(saveButton("cloud_limit_pct"));
    expect(await screen.findByText("Must be at most 90.")).toBeInTheDocument();
    expect(input("cloud_limit_pct")).toHaveValue(95);
    // The stored value 20 is still displayed.
    expect(screen.getAllByText("20").length).toBeGreaterThan(0);
  });

  it("reloads the list on 404 and reports a failed update on 500", async () => {
    installSettings((key) =>
      key === "future_key" ? HttpResponse.json(envelope("NOT_FOUND"), { status: 404 }) : HttpResponse.json(envelope("INTERNAL_ERROR"), { status: 500 }),
    );
    await renderSignedIn("/admin/settings", ADMIN);
    await screen.findByText("future_key");
    const before = lists;
    await userEvent.clear(input("future_key"));
    await userEvent.type(input("future_key"), "4");
    await userEvent.click(saveButton("future_key"));
    expect(await screen.findByText(ADMIN_TEXT.settingUnknown)).toBeInTheDocument();
    await waitFor(() => expect(lists).toBe(before + 1));

    await userEvent.clear(input("gap_threshold_days"));
    await userEvent.type(input("gap_threshold_days"), "40");
    await userEvent.click(saveButton("gap_threshold_days"));
    expect(await screen.findByText(ADMIN_TEXT.settingFailed)).toBeInTheDocument();
  });
});
