import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FOCUS_DEADLINE_MS } from "@/components/layout/RouteAnnouncer";
import { SHELL_TEXT } from "@/lib/messages";

import { renderSignedIn } from "../auth/authHarness";

/**
 * jsdom does not lay out CSS, so these tests stub the viewport width, check the Tailwind
 * class contract that switches between drawer and sidebar, and check the drawer and the
 * content area by behaviour (frontend design, Testing Strategy; Requirement 23.9).
 */
function setViewport(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  setViewport(1024);
});

describe.each([360, 768, 1280])("layout at %i px (Requirements 1.2, 1.3, 6.5, 6.6)", (width) => {
  it("has no horizontal page overflow and a reachable content area", async () => {
    setViewport(width);
    await renderSignedIn("/dashboard", { roles: ["admin"] });
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);

    const main = screen.getByRole("main");
    expect(main).toHaveClass("min-w-0");
    expect(main.parentElement).toHaveClass("min-w-0");

    // Persistent sidebar from 640 px only; the menu button only below 640 px.
    const aside = screen.getByRole("complementary");
    expect(aside).toHaveClass("hidden", "sm:block");
    expect(screen.getByRole("button", { name: SHELL_TEXT.openMenu })).toHaveClass("sm:hidden");

    // Skip link is the first focusable element and moves focus to the content area.
    await userEvent.tab();
    expect(document.activeElement).toHaveTextContent(SHELL_TEXT.skipLink);
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(main);
  });
});

describe("mobile drawer (Requirement 1.3)", () => {
  it("opens the navigation in a drawer and closes it after choosing an item", async () => {
    setViewport(360);
    const { pathname } = await renderSignedIn("/dashboard");
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    await userEvent.click(screen.getByRole("button", { name: SHELL_TEXT.openMenu }));
    const drawer = await screen.findByRole("dialog");
    await userEvent.click(within(drawer).getByRole("link", { name: "Reports" }));
    await waitFor(() => expect(pathname()).toBe("/reports"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("route announcer (Requirement 1.11)", () => {
  it("sets the document title and focuses the page heading within 500 ms", async () => {
    const { services } = await renderSignedIn("/dashboard");
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    expect(document.title).toBe("Dashboard - Eco-Sentinel");

    const started = Date.now();
    await act(async () => {
      await services.router.navigate("/reports");
    });
    const heading = await screen.findByRole("heading", { level: 1, name: "Reports" });
    await waitFor(() => expect(document.activeElement).toBe(heading), { timeout: FOCUS_DEADLINE_MS });
    expect(Date.now() - started).toBeLessThan(FOCUS_DEADLINE_MS);
    expect(document.title).toBe("Reports - Eco-Sentinel");
  });
});
