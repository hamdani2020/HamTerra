import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { containsForbiddenTerm } from "@/lib/evidence";
import { ROUTES, routeTo } from "@/lib/routes";

import { renderApp, renderSignedIn } from "../auth/authHarness";
import { resetMaps } from "../mocks/maplibre";

vi.mock("maplibre-gl", () => import("../mocks/maplibre"));
vi.mock("recharts", async (importOriginal) => (await import("../mocks/recharts")).rechartsWithFixedSize(importOriginal));

const ADMIN = { roles: ["admin"], permissions: [] };

/**
 * Every page, rendered with the default contract fixtures. Backend text in those fixtures is
 * free of forbidden terms, so any match comes from Frontend-authored text (Requirements 20.1,
 * 23.8). The source scan in evidence.property.test.ts covers text that is not rendered here.
 */
const SIGNED_IN_PAGES = [
  ROUTES.dashboard,
  ROUTES.map,
  ROUTES.areas,
  routeTo.area("a1"),
  routeTo.areaTimeSeries("a1"),
  routeTo.areaCompare("a1"),
  ROUTES.reports,
  routeTo.report("r1"),
  ROUTES.admin,
  ROUTES.adminUsers,
  ROUTES.adminAreas,
  ROUTES.adminRetrievals,
  ROUTES.adminSettings,
  ROUTES.adminActivity,
  "/no-such-page",
];

beforeEach(() => {
  sessionStorage.clear();
  resetMaps();
});

async function settled(container: HTMLElement): Promise<void> {
  await screen.findByRole("heading", { level: 1 });
  await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
}

describe("rendered text has no forbidden term (Requirement 20.1)", () => {
  it.each(SIGNED_IN_PAGES)("%s", async (path) => {
    const { container } = await renderSignedIn(path, ADMIN);
    await settled(container);
    expect(containsForbiddenTerm(document.body.textContent ?? "")).toBeNull();
    // Accessible names that are not text nodes.
    const labels = [...document.querySelectorAll("[aria-label],[title],[alt],[placeholder]")].map((el) =>
      ["aria-label", "title", "alt", "placeholder"].map((a) => el.getAttribute(a) ?? "").join(" "),
    );
    expect(containsForbiddenTerm(labels.join(" "))).toBeNull();
  });

  it.each([ROUTES.landing, ROUTES.signedOut])("public page %s", async (path) => {
    await renderApp(path);
    await screen.findByRole("heading", { level: 1 });
    expect(containsForbiddenTerm(document.body.textContent ?? "")).toBeNull();
  });
});
