import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import { ADMIN_AREA_TEXT, AREA_TEXT, ERROR_TEXT, GEOJSON_CHECK_TEXT } from "@/lib/messages";
import type { Area, AreaCreateRequest, AreaUpdateRequest } from "@/types/api";

import { renderSignedIn } from "../auth/authHarness";
import { tokenRequests } from "../msw/cognito";
import { API, buildArea, envelope, page } from "../msw/contract";
import { server } from "../msw/server";
import { resetMaps } from "../mocks/maplibre";

vi.mock("maplibre-gl", () => import("../mocks/maplibre"));

const ADMIN = { roles: ["admin"], permissions: [] };
const POLYGON = { type: "Polygon", coordinates: [[[-2.2, 5.3], [-2.1, 5.3], [-2.1, 5.4], [-2.2, 5.3]]] } as const;
const FEATURE_TEXT = JSON.stringify({ type: "Feature", properties: {}, geometry: POLYGON });

let listCalls: URLSearchParams[];
let creates: AreaCreateRequest[];
let patches: AreaUpdateRequest[];
let actions: string[];

const existing = (overrides: Partial<Area> = {}) =>
  buildArea({ id: "a1", name: "Prestea", description: "Pilot area.", status: "active", geometry: POLYGON as unknown as Area["geometry"], ...overrides });

function install({
  rows = [existing(), existing({ id: "a2", name: "Old site", status: "archived" })],
  create = () => HttpResponse.json(existing({ id: "a9", name: "New" }), { status: 201 }),
  patch = () => HttpResponse.json(existing()),
  action = () => HttpResponse.json(existing()),
}: {
  rows?: Area[];
  create?: () => Response | Promise<Response>;
  patch?: () => Response;
  action?: (kind: string) => Response;
} = {}): void {
  server.use(
    http.get(`${API}/areas`, ({ request }) => {
      listCalls.push(new URL(request.url).searchParams);
      return HttpResponse.json(page(rows, { limit: 20 }));
    }),
    http.get(`${API}/areas/:id`, ({ params }) => HttpResponse.json(rows.find((r) => r.id === params.id) ?? existing())),
    http.post(`${API}/admin/areas`, async ({ request }) => {
      creates.push((await request.json()) as AreaCreateRequest);
      return create();
    }),
    http.patch(`${API}/admin/areas/:id`, async ({ request }) => {
      patches.push((await request.json()) as AreaUpdateRequest);
      return patch();
    }),
    http.post(`${API}/admin/areas/:id/:kind`, ({ params }) => {
      actions.push(`${String(params.kind)}:${String(params.id)}`);
      return action(String(params.kind));
    }),
  );
}

async function openCreate() {
  const view = await renderSignedIn("/admin/areas", ADMIN);
  await userEvent.click(await screen.findByRole("button", { name: ADMIN_AREA_TEXT.create }));
  const dialog = await screen.findByRole("dialog", { name: ADMIN_AREA_TEXT.createTitle });
  return { ...view, dialog };
}

async function fill(dialog: HTMLElement, { name = "New area", geometry = FEATURE_TEXT }: { name?: string; geometry?: string } = {}) {
  await userEvent.type(within(dialog).getByLabelText(ADMIN_AREA_TEXT.name), name);
  const text = within(dialog).getByLabelText(ADMIN_AREA_TEXT.geometry);
  await userEvent.click(text);
  await userEvent.paste(geometry);
}

const submitCreate = (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole("button", { name: ADMIN_AREA_TEXT.submitCreate }));

beforeEach(() => {
  sessionStorage.clear();
  tokenRequests.length = 0;
  listCalls = [];
  creates = [];
  patches = [];
  actions = [];
  resetMaps();
});

describe("admin area list (Requirement 14.1, 14.16)", () => {
  it("lists all statuses with create, edit, archive and restore controls", async () => {
    install();
    const { container } = await renderSignedIn("/admin/areas", ADMIN);
    const table = await screen.findByRole("table", { name: AREA_TEXT.tableCaption });
    expect(listCalls[0]?.get("status")).toBe("all");
    expect(within(table).getByRole("button", { name: `${ADMIN_AREA_TEXT.archive}: Prestea` })).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: `${ADMIN_AREA_TEXT.restore}: Old site` })).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: `${ADMIN_AREA_TEXT.edit}: Prestea` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ADMIN_AREA_TEXT.create })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("create (Requirements 14.2 to 14.10)", () => {
  it("creates from pasted GeoJSON, shows the preview and a progress state, and refreshes the list", async () => {
    install({
      create: async () => {
        await delay(100);
        return HttpResponse.json(existing({ id: "a9", name: "New area" }), { status: 201 });
      },
    });
    const { dialog } = await openCreate();
    await fill(dialog);
    expect(await within(dialog).findByTestId("mini-map")).toBeInTheDocument();
    expect(within(dialog).getAllByText(ADMIN_AREA_TEXT.coordinateOrder).length).toBeGreaterThan(0);
    const before = listCalls.length;
    await submitCreate(dialog);
    expect(within(dialog).getByText(ADMIN_AREA_TEXT.saving)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: ADMIN_AREA_TEXT.submitCreate })).toBeDisabled();
    expect(await screen.findByText(ADMIN_AREA_TEXT.saved)).toBeInTheDocument();
    expect(creates).toEqual([{ name: "New area", description: null, geometry: POLYGON }]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(listCalls.length).toBeGreaterThan(before));
  });

  it.each([
    ["invalid JSON", '{"type": "Polygon",', /The text is not valid JSON/],
    ["a Point", JSON.stringify({ type: "Point", coordinates: [-2, 5] }), new RegExp(GEOJSON_CHECK_TEXT.type)],
    ["a latitude out of range", JSON.stringify({ type: "Polygon", coordinates: [[[-2, 95], [-1, 5], [-1, 6], [-2, 95]]] }), new RegExp(GEOJSON_CHECK_TEXT.coordinates)],
    ["two features", JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", geometry: POLYGON }, { type: "Feature", geometry: POLYGON }] }), new RegExp(GEOJSON_CHECK_TEXT.structure)],
  ])("names the failed check for %s, sends nothing and keeps the values", async (_l, geometry, message) => {
    install();
    const { dialog } = await openCreate();
    await fill(dialog, { geometry });
    await submitCreate(dialog);
    expect(within(dialog).getByText(message)).toBeInTheDocument();
    expect(creates).toHaveLength(0);
    expect(within(dialog).getByLabelText(ADMIN_AREA_TEXT.name)).toHaveValue("New area");
    expect(within(dialog).getByLabelText(ADMIN_AREA_TEXT.geometry)).toHaveValue(geometry);
  });

  it("rejects a file over 1 MB or of another type and keeps the geometry text", async () => {
    install();
    const user = userEvent.setup({ applyAccept: false });
    const { dialog } = await openCreate();
    await fill(dialog);
    const input = within(dialog).getByLabelText(ADMIN_AREA_TEXT.file);
    await user.upload(input, new File(["x".repeat(1024 * 1024 + 1)], "big.geojson", { type: "application/geo+json" }));
    expect(await within(dialog).findByText(ADMIN_AREA_TEXT.fileTooLarge)).toBeInTheDocument();
    await user.upload(input, new File(["<kml/>"], "area.kml", { type: "application/xml" }));
    expect(await within(dialog).findByText(ADMIN_AREA_TEXT.fileType)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(ADMIN_AREA_TEXT.geometry)).toHaveValue(FEATURE_TEXT);

    await user.upload(input, new File([JSON.stringify(POLYGON)], "area.json", { type: "application/json" }));
    await waitFor(() => expect(within(dialog).getByLabelText(ADMIN_AREA_TEXT.geometry)).toHaveValue(JSON.stringify(POLYGON)));
    expect(within(dialog).queryByText(ADMIN_AREA_TEXT.fileType)).not.toBeInTheDocument();
  });

  it.each([
    ["GEOMETRY_OUTSIDE_GHANA", 422, "x", ERROR_TEXT.GEOMETRY_OUTSIDE_GHANA],
    ["AREA_OUT_OF_RANGE", 422, "The area must be between 1 and 10000 ha.", "The area must be between 1 and 10000 ha."],
    ["CONFLICT", 409, "x", ADMIN_AREA_TEXT.duplicateName],
    ["UPSTREAM_ERROR", 502, "x", ADMIN_AREA_TEXT.providerFailed],
    ["UPSTREAM_TIMEOUT", 504, "x", ADMIN_AREA_TEXT.providerFailed],
  ])("shows %s, keeps the values and re-enables submit", async (code, status, message, shown) => {
    install({ create: () => HttpResponse.json(envelope(code, message), { status }) });
    const { dialog } = await openCreate();
    await fill(dialog);
    await submitCreate(dialog);
    expect(await within(dialog).findByText(shown)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(ADMIN_AREA_TEXT.name)).toHaveValue("New area");
    expect(within(dialog).getByLabelText(ADMIN_AREA_TEXT.geometry)).toHaveValue(FEATURE_TEXT);
    expect(within(dialog).getByRole("button", { name: ADMIN_AREA_TEXT.submitCreate })).toBeEnabled();
    if (code === "CONFLICT") expect(within(dialog).getByLabelText(ADMIN_AREA_TEXT.name)).toHaveAttribute("aria-invalid", "true");
  });
});

describe("edit (Requirements 14.11, 14.12)", () => {
  async function openEdit() {
    await renderSignedIn("/admin/areas", ADMIN);
    const table = await screen.findByRole("table", { name: AREA_TEXT.tableCaption });
    await userEvent.click(within(table).getByRole("button", { name: `${ADMIN_AREA_TEXT.edit}: Prestea` }));
    const dialog = await screen.findByRole("dialog", { name: ADMIN_AREA_TEXT.editTitle });
    await within(dialog).findByLabelText(ADMIN_AREA_TEXT.name);
    return dialog;
  }

  it("keeps submit disabled and sends nothing without a change, then sends only the changed name", async () => {
    install();
    const dialog = await openEdit();
    const save = within(dialog).getByRole("button", { name: ADMIN_AREA_TEXT.submitEdit });
    expect(save).toBeDisabled();
    expect(within(dialog).getByText(ADMIN_AREA_TEXT.noChanges)).toBeInTheDocument();
    const name = within(dialog).getByLabelText(ADMIN_AREA_TEXT.name);
    await userEvent.clear(name);
    await userEvent.type(name, "Prestea North");
    await userEvent.click(save);
    await screen.findByText(ADMIN_AREA_TEXT.saved);
    expect(patches).toEqual([{ name: "Prestea North" }]);
  });

  it("asks for confirmation before sending a geometry change", async () => {
    install();
    const dialog = await openEdit();
    const text = within(dialog).getByLabelText(ADMIN_AREA_TEXT.geometry);
    await userEvent.clear(text);
    await userEvent.click(text);
    const moved = { type: "Polygon", coordinates: [[[-2.3, 5.3], [-2.1, 5.3], [-2.1, 5.4], [-2.3, 5.3]]] };
    await userEvent.paste(JSON.stringify(moved));
    await userEvent.click(within(dialog).getByRole("button", { name: ADMIN_AREA_TEXT.submitEdit }));
    const confirm = await screen.findByRole("alertdialog", { name: ADMIN_AREA_TEXT.geometryConfirmTitle });
    expect(confirm).toHaveTextContent(ADMIN_AREA_TEXT.geometryConfirmBody);
    await userEvent.click(within(confirm).getByRole("button", { name: ADMIN_AREA_TEXT.cancel }));
    expect(patches).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole("button", { name: ADMIN_AREA_TEXT.submitEdit }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: ADMIN_AREA_TEXT.geometryConfirm }));
    await screen.findByText(ADMIN_AREA_TEXT.saved);
    expect(patches).toEqual([{ geometry: moved }]);
  });
});

describe("archive and restore (Requirements 14.13 to 14.15)", () => {
  async function act(name: string, kind: "archive" | "restore") {
    const table = await screen.findByRole("table", { name: AREA_TEXT.tableCaption });
    await userEvent.click(within(table).getByRole("button", { name: `${kind === "archive" ? ADMIN_AREA_TEXT.archive : ADMIN_AREA_TEXT.restore}: ${name}` }));
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirm).getByRole("button", { name: kind === "archive" ? ADMIN_AREA_TEXT.archive : ADMIN_AREA_TEXT.restore }));
  }

  it("archives after confirmation", async () => {
    install();
    await renderSignedIn("/admin/areas", ADMIN);
    await act("Prestea", "archive");
    expect(await screen.findByText(ADMIN_AREA_TEXT.archived)).toBeInTheDocument();
    expect(actions).toEqual(["archive:a1"]);
  });

  it("leaves the status unchanged when archiving fails", async () => {
    install({ action: () => HttpResponse.json(envelope("INTERNAL_ERROR", "x"), { status: 500 }) });
    await renderSignedIn("/admin/areas", ADMIN);
    await act("Prestea", "archive");
    expect(await screen.findByRole("alert")).toHaveTextContent(ADMIN_AREA_TEXT.actionFailed);
    const table = screen.getByRole("table", { name: AREA_TEXT.tableCaption });
    const row = within(table).getByRole("link", { name: "Prestea" }).closest("tr") as HTMLElement;
    expect(within(row).getByText(AREA_TEXT.statusActive)).toBeInTheDocument();
  });

  it("explains a restore 409 and leaves the status unchanged", async () => {
    install({ action: () => HttpResponse.json(envelope("CONFLICT", "x"), { status: 409 }) });
    await renderSignedIn("/admin/areas", ADMIN);
    await act("Old site", "restore");
    expect(await screen.findByRole("alert")).toHaveTextContent(ADMIN_AREA_TEXT.restoreConflict);
    const row = within(screen.getByRole("table", { name: AREA_TEXT.tableCaption })).getByRole("link", { name: "Old site" }).closest("tr") as HTMLElement;
    expect(within(row).getByText(AREA_TEXT.statusArchived)).toBeInTheDocument();
    expect(actions).toEqual(["restore:a2"]);
  });
});
