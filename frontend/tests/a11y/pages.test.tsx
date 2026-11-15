import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import { PAGE_TITLE } from "@/lib/pageTitles";
import { ROUTES } from "@/lib/routes";

import { renderSignedIn } from "../auth/authHarness";
import { resetMaps } from "../mocks/maplibre";

vi.mock("maplibre-gl", () => import("../mocks/maplibre"));

beforeEach(() => {
  sessionStorage.clear();
  resetMaps();
});

/**
 * Pages whose axe checks are not part of a feature test (Requirements 21.4, 23.14). The
 * landing, dashboard and auth error pages are in authPages.test.tsx; time series, comparison,
 * observation detail and the admin pages are checked in their own tests.
 */
describe("accessibility of the remaining pages", () => {
  it("map page has no axe violations", async () => {
    const { container } = await renderSignedIn(ROUTES.map, { roles: ["researcher"] });
    await screen.findByRole("heading", { level: 1, name: PAGE_TITLE.map });
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(await axe(container)).toHaveNoViolations();
  });

  it("not-found page has no axe violations", async () => {
    const { container } = await renderSignedIn("/no-such-page", { roles: ["researcher"] });
    await screen.findByRole("heading", { level: 1 });
    expect(await axe(container)).toHaveNoViolations();
  });
});
