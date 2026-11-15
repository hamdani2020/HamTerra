import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STALE_TIME_MS } from "@/core/api/queryClient";
import { PAGE_TITLE } from "@/lib/pageTitles";

import { renderSignedIn } from "../auth/authHarness";
import { API, buildArea, buildMe, page } from "../msw/contract";
import { server } from "../msw/server";

const RESEARCHER = { roles: ["researcher"] };

let listUrls: string[];
let meCalls: number;
/** Requests identical to the first area-list request (other pages list areas with other parameters). */
const listCalls = (): number => listUrls.filter((u) => u === listUrls[0]).length;

function countRequests(list?: (request: Request) => Promise<Response> | Response): void {
  server.use(
    http.get(`${API}/areas`, ({ request }) => {
      listUrls.push(request.url);
      return list ? list(request) : HttpResponse.json(page([buildArea({ name: "Prestea" })]));
    }),
  );
}

const meHandler = http.get(`${API}/me`, () => {
  meCalls += 1;
  return HttpResponse.json(buildMe(RESEARCHER));
});

async function go(name: string, title: string): Promise<void> {
  const [link] = screen.getAllByRole("link", { name });
  await userEvent.click(link as HTMLElement);
  await screen.findByRole("heading", { level: 1, name: title });
}

beforeEach(() => {
  sessionStorage.clear();
  listUrls = [];
  meCalls = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("caching (Requirement 24.2)", () => {
  it("serves an identical GET from the cache within 30 s and requests it again after", async () => {
    // Only the clock is faked, so TanStack Query's staleness check follows setSystemTime.
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-05-01T10:00:00Z").getTime();
    vi.setSystemTime(start);
    countRequests();
    await renderSignedIn("/areas", RESEARCHER, meHandler);
    await screen.findByRole("heading", { level: 1, name: PAGE_TITLE.areas });
    await waitFor(() => expect(listCalls()).toBe(1));

    await go("Reports", PAGE_TITLE.reports);
    vi.setSystemTime(start + STALE_TIME_MS - 1_000);
    await go("Areas", PAGE_TITLE.areas);
    await screen.findAllByText("Prestea");
    expect(listCalls()).toBe(1);

    await go("Reports", PAGE_TITLE.reports);
    vi.setSystemTime(start + STALE_TIME_MS + 1_000);
    await go("Areas", PAGE_TITLE.areas);
    await waitFor(() => expect(listCalls()).toBe(2));
  });

  it("loads GET /me once per Session across navigation", async () => {
    countRequests();
    await renderSignedIn("/areas", RESEARCHER, meHandler);
    await screen.findByRole("heading", { level: 1, name: PAGE_TITLE.areas });
    await go("Reports", PAGE_TITLE.reports);
    await go("Dashboard", PAGE_TITLE.dashboard);
    await go("Areas", PAGE_TITLE.areas);
    expect(meCalls).toBe(1);
  });
});

describe("cancellation (Requirement 24.3)", () => {
  it("aborts the in-flight request when the page is left, without an error state", async () => {
    let aborted = false;
    countRequests(async (request) => {
      request.signal.addEventListener("abort", () => {
        aborted = true;
      });
      await delay("infinite");
      return HttpResponse.json(page([]));
    });
    await renderSignedIn("/areas", RESEARCHER, meHandler);
    await screen.findByRole("heading", { level: 1, name: PAGE_TITLE.areas });
    await waitFor(() => expect(listCalls()).toBe(1));
    await go("Reports", PAGE_TITLE.reports);
    await waitFor(() => expect(aborted).toBe(true));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
