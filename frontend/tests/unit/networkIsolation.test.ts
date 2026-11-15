import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server, unhandledRequests } from "../msw/server";

describe("network isolation (Requirement 23.13)", () => {
  it("rejects an unmocked request with an error that names the URL", async () => {
    const url = "https://unmocked.example.test/api/v1/areas?limit=5";
    await expect(fetch(url)).rejects.toThrow();
    expect(unhandledRequests).toHaveLength(1);
    expect(unhandledRequests[0]).toContain("GET");
    expect(unhandledRequests[0]).toContain(url);
    // The shared afterEach would fail this test for the leak; this test expects it.
    unhandledRequests.splice(0);
  });

  it("lets a mocked request through", async () => {
    server.use(http.get("https://mocked.example.test/ping", () => HttpResponse.json({ ok: true })));
    const response = await fetch("https://mocked.example.test/ping");
    expect(await response.json()).toEqual({ ok: true });
    expect(unhandledRequests).toHaveLength(0);
  });
});
