import { screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import fc from "fast-check";
import { http, HttpResponse } from "msw";
import { useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import { App } from "@/App";
import { buildPublicConfig, builder, testId } from "../factories";
import { server } from "../msw/server";
import { propertyConfig } from "../properties/propertyConfig";
import { renderWithProviders, useTestAuth } from "../renderWithProviders";

function Probe(): JSX.Element {
  const auth = useTestAuth();
  const location = useLocation();
  const query = useQuery({
    queryKey: ["probe"],
    queryFn: async () => (await fetch("https://api.test/probe")).json() as Promise<{ v: number }>,
  });
  return (
    <p>
      {location.pathname} {auth.roles.join(",")} {query.data?.v ?? "loading"}
    </p>
  );
}

describe("test helpers", () => {
  it("renderWithProviders supplies router, query client and auth stub", async () => {
    server.use(http.get("https://api.test/probe", () => HttpResponse.json({ v: 7 })));
    renderWithProviders(<Probe />, { route: "/areas", auth: { roles: ["admin"] } });
    expect(await screen.findByText("/areas admin 7")).toBeInTheDocument();
  });

  it("builders return fresh copies with overrides", () => {
    const make = builder(() => ({ id: testId(), tags: ["a"] }));
    const a = make();
    const b = make({ tags: ["b"] });
    a.tags.push("x");
    expect(b.tags).toEqual(["b"]);
    expect(make().tags).toEqual(["a"]);
    expect(a.id).not.toEqual(b.id);
  });

  it("property config runs at least 100 cases", () => {
    let runs = 0;
    fc.assert(
      fc.property(fc.integer(), () => {
        runs += 1;
      }),
      propertyConfig,
    );
    expect(runs).toBeGreaterThanOrEqual(100);
  });

  it("axe matchers are installed", async () => {
    const { container } = renderWithProviders(<App config={buildPublicConfig()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
