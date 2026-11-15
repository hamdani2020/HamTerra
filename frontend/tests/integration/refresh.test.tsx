import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import { REFRESH_TIMEOUT_MS } from "@/core/api/client";
import { addDays, todayUtc } from "@/lib/dates";
import { ERROR_TEXT, REFRESH_TEXT, WARNING_TEXT } from "@/lib/messages";
import type { RefreshRequest, RefreshResult } from "@/types/api";

import { renderSignedIn } from "../auth/authHarness";
import { tokenRequests } from "../msw/cognito";
import { API, buildArea, buildRefreshResult, envelope, page } from "../msw/contract";
import { server } from "../msw/server";
import { resetMaps } from "../mocks/maplibre";

vi.mock("maplibre-gl", () => import("../mocks/maplibre"));

const REFRESH_ME = { roles: ["researcher"], permissions: ["observations:refresh"] };
let bodies: RefreshRequest[];

function install(respond: (body: RefreshRequest) => Response | Promise<Response>): void {
  server.use(
    http.get(`${API}/areas/:id`, () => HttpResponse.json(buildArea({ id: "a1", name: "Prestea" }))),
    http.get(`${API}/areas/:id/observations`, () => HttpResponse.json({ ...page([], { limit: 20 }), meta: { resolution_class: {} } })),
    http.post(`${API}/areas/:id/observations/refresh`, async ({ request }) => {
      const body = (await request.json()) as RefreshRequest;
      bodies.push(body);
      return respond(body);
    }),
  );
}

const ok = (overrides: Partial<RefreshResult> = {}) => () => HttpResponse.json(buildRefreshResult({ retrieval_id: "ret-42", ...overrides }));

async function openDialog(path = "/areas/a1") {
  const view = await renderSignedIn(path, REFRESH_ME);
  await userEvent.click(await screen.findByRole("button", { name: REFRESH_TEXT.open }));
  const dialog = await screen.findByRole("dialog", { name: REFRESH_TEXT.title });
  // Something cached for the area, to see whether it gets invalidated.
  view.services.queryClient.setQueryData(["timeseries", "a1", { source: "sentinel-2" }], { cached: true });
  view.services.queryClient.setQueryData(["observations", "a1", { dates: true }], ["2026-01-01"]);
  return { ...view, dialog };
}

const invalidated = (view: Awaited<ReturnType<typeof openDialog>>) => ({
  timeseries: view.services.queryClient.getQueryState(["timeseries", "a1", { source: "sentinel-2" }])?.isInvalidated ?? false,
  observations: view.services.queryClient.getQueryState(["observations", "a1", { dates: true }])?.isInvalidated ?? false,
});

beforeEach(() => {
  sessionStorage.clear();
  tokenRequests.length = 0;
  bodies = [];
  resetMaps();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("refresh dialog (Requirement 13)", () => {
  it("is offered only with the refresh permission", async () => {
    install(ok());
    await renderSignedIn("/areas/a1", { roles: ["researcher"], permissions: [] });
    await screen.findByRole("heading", { level: 1, name: "Prestea" });
    expect(screen.queryByRole("button", { name: REFRESH_TEXT.open })).not.toBeInTheDocument();
  });

  it("sends both sources by omitting `sources`, shows the counts and retrieval ID, and invalidates the area's data", async () => {
    install(ok({ status: "success", new: 4, updated: 1, skipped: 2 }));
    const view = await openDialog();
    expect(within(view.dialog).getByRole("checkbox", { name: "Sentinel-2" })).toBeChecked();
    expect(within(view.dialog).getByRole("checkbox", { name: "Landsat 8" })).toBeChecked();
    await userEvent.click(within(view.dialog).getByRole("button", { name: REFRESH_TEXT.confirm }));
    const result = await within(view.dialog).findByText(REFRESH_TEXT.successTitle);
    expect(result).toBeInTheDocument();
    expect(bodies).toEqual([{ date_from: addDays(todayUtc(), -29), date_to: todayUtc() }]);
    expect(within(view.dialog).getByTestId("refresh-counts")).toHaveTextContent("New4Updated1Skipped2");
    expect(within(view.dialog).getByText("ret-42")).toBeInTheDocument();
    await waitFor(() => expect(invalidated(view)).toEqual({ timeseries: true, observations: true }));
    expect(await axe(view.dialog)).toHaveNoViolations();
  });

  it("sends only the selected source", async () => {
    install(ok());
    const view = await openDialog();
    await userEvent.click(within(view.dialog).getByRole("checkbox", { name: "Landsat 8" }));
    await userEvent.click(within(view.dialog).getByRole("button", { name: REFRESH_TEXT.confirm }));
    await within(view.dialog).findByText(REFRESH_TEXT.successTitle);
    expect(bodies[0]?.sources).toEqual(["sentinel-2"]);
  });

  it("shows zero counts for an empty result and changes nothing cached", async () => {
    install(ok({ status: "empty", new: 0, updated: 0, skipped: 0 }));
    const view = await openDialog();
    await userEvent.click(within(view.dialog).getByRole("button", { name: REFRESH_TEXT.confirm }));
    expect(await within(view.dialog).findByText(REFRESH_TEXT.emptyTitle)).toBeInTheDocument();
    expect(within(view.dialog).getByTestId("refresh-counts")).toHaveTextContent("New0Updated0Skipped0");
    expect(invalidated(view)).toEqual({ timeseries: false, observations: false });
  });

  it("shows the incomplete warning, each Backend warning and the counts for a partial result, and invalidates", async () => {
    install(ok({ status: "partial", new: 2, updated: 0, skipped: 0, warnings: [{ code: "UPSTREAM_ERROR", message: "x" }, { code: "NEW_CODE", message: "Landsat 8 retrieval failed." }] }));
    const view = await openDialog();
    await userEvent.click(within(view.dialog).getByRole("button", { name: REFRESH_TEXT.confirm }));
    expect(await within(view.dialog).findByText(REFRESH_TEXT.partialTitle)).toBeInTheDocument();
    expect(within(view.dialog).getByText(WARNING_TEXT.UPSTREAM_ERROR)).toBeInTheDocument();
    expect(within(view.dialog).getByText("Landsat 8 retrieval failed.")).toBeInTheDocument();
    await waitFor(() => expect(invalidated(view).timeseries).toBe(true));
  });

  it("explains a 409 and closes with Try again later, changing nothing cached", async () => {
    install(() => HttpResponse.json(envelope("REFRESH_IN_PROGRESS", "x"), { status: 409 }));
    const view = await openDialog();
    await userEvent.click(within(view.dialog).getByRole("button", { name: REFRESH_TEXT.confirm }));
    const alert = await within(view.dialog).findByRole("alert");
    expect(alert).toHaveTextContent(REFRESH_TEXT.inProgress);
    expect(invalidated(view)).toEqual({ timeseries: false, observations: false });
    await userEvent.click(within(alert).getByRole("button", { name: REFRESH_TEXT.tryLater }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it.each([
    [502, "UPSTREAM_ERROR"],
    [504, "UPSTREAM_TIMEOUT"],
  ])("shows the provider message for %s, states nothing changed, and re-enables confirm", async (status, code) => {
    install(() => HttpResponse.json(envelope(code, "x"), { status }));
    const view = await openDialog();
    await userEvent.click(within(view.dialog).getByRole("button", { name: REFRESH_TEXT.confirm }));
    const alert = await within(view.dialog).findByRole("alert");
    expect(alert).toHaveTextContent(ERROR_TEXT[code as "UPSTREAM_ERROR"]);
    expect(alert).toHaveTextContent(REFRESH_TEXT.unchanged);
    expect(within(view.dialog).getByRole("button", { name: REFRESH_TEXT.confirm })).toBeEnabled();
  });

  it("aborts after 130 s with a result-unknown message and re-enables confirm", async () => {
    install(async () => {
      await delay("infinite");
      return HttpResponse.json({});
    });
    const view = await openDialog();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await userEvent.click(within(view.dialog).getByRole("button", { name: REFRESH_TEXT.confirm }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS - 2000);
    });
    expect(within(view.dialog).queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(await within(view.dialog).findByRole("alert")).toHaveTextContent(REFRESH_TEXT.timeout);
    expect(within(view.dialog).getByRole("button", { name: REFRESH_TEXT.confirm })).toBeEnabled();
  });

  it("shows progress and elapsed time, sends no second request, and keeps running when closed with Escape", async () => {
    let release!: () => void;
    install(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return HttpResponse.json(buildRefreshResult({ status: "success" }));
    });
    const view = await openDialog();
    const confirm = within(view.dialog).getByRole("button", { name: REFRESH_TEXT.confirm });
    await userEvent.click(confirm);
    await userEvent.click(confirm);
    expect(confirm).toBeDisabled();
    // Both the corner close button and the footer close button.
    for (const close of within(view.dialog).getAllByRole("button", { name: REFRESH_TEXT.close })) expect(close).toBeDisabled();
    expect(within(view.dialog).getByRole("progressbar", { name: REFRESH_TEXT.progressLabel })).toBeInTheDocument();
    expect(within(view.dialog).getByText(REFRESH_TEXT.pending)).toBeInTheDocument();
    expect(within(view.dialog).getByText(/Elapsed: \d+ s/)).toBeInTheDocument();
    await waitFor(() => expect(bodies).toHaveLength(1));

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText(REFRESH_TEXT.backgroundRunning)).toBeInTheDocument();
    // The rest of the page stays usable while it runs.
    expect(screen.getByRole("link", { name: "NDVI time series" })).toBeInTheDocument();

    await act(async () => release());
    expect(await screen.findByText(REFRESH_TEXT.backgroundDone)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: REFRESH_TEXT.open }));
    expect(await screen.findByText(REFRESH_TEXT.successTitle)).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
  });

  it.each([
    ["a future end date", -1, 1, "date_to", "The end date cannot be in the future."],
    ["a range over 366 days", -400, 0, "date_to", "The range can be at most 366 days."],
    ["a start after the end", -2, -5, "date_from", "The start date must be on or before the end date."],
  ])("refuses %s with a field error, sends nothing and keeps the values", async (_l, fromOffset, toOffset, _f, message) => {
    install(ok());
    const view = await openDialog();
    const from = addDays(todayUtc(), fromOffset);
    const to = addDays(todayUtc(), toOffset);
    const fromInput = within(view.dialog).getByLabelText(REFRESH_TEXT.dateFrom);
    const toInput = within(view.dialog).getByLabelText(REFRESH_TEXT.dateTo);
    await userEvent.clear(fromInput);
    await userEvent.type(fromInput, from);
    await userEvent.clear(toInput);
    await userEvent.type(toInput, to);
    await userEvent.click(within(view.dialog).getByRole("button", { name: REFRESH_TEXT.confirm }));
    expect(await within(view.dialog).findByText(message)).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
    expect(fromInput).toHaveValue(from);
    expect(toInput).toHaveValue(to);
  });

  it("refuses an empty source selection", async () => {
    install(ok());
    const view = await openDialog();
    await userEvent.click(within(view.dialog).getByRole("checkbox", { name: "Sentinel-2" }));
    await userEvent.click(within(view.dialog).getByRole("checkbox", { name: "Landsat 8" }));
    await userEvent.click(within(view.dialog).getByRole("button", { name: REFRESH_TEXT.confirm }));
    expect(await within(view.dialog).findByText(REFRESH_TEXT.noSource)).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });
});
