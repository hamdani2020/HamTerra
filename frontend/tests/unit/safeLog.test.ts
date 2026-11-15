import { afterEach, describe, expect, it, vi } from "vitest";

import { redactValue, safeLog } from "@/lib/safeLog";

describe("safeLog (Requirement 2.7)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("removes tokens and Authorization values before writing", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    safeLog("warn", "renewal failed with Bearer abc.def.ghi", {
      Authorization: "Bearer abc.def.ghi",
      nested: { access_token: "t1", refresh_token: "t2", id_token: "t3", keep: "visible" },
      list: ["Bearer xyz"],
    });
    const output = JSON.stringify(spy.mock.calls);
    for (const secret of ["abc.def.ghi", "t1", "t2", "t3", "xyz"]) expect(output).not.toContain(secret);
    expect(output).toContain("visible");
    expect(output).toContain("[REDACTED]");
  });

  it("leaves plain values alone", () => {
    expect(redactValue({ status: 500, code: "INTERNAL_ERROR" })).toEqual({ status: 500, code: "INTERNAL_ERROR" });
  });
});
