import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NOTICE_TEXT, SHELL_TEXT } from "@/lib/messages";

import { renderSignedIn } from "../auth/authHarness";
import { buildIdToken, tokenOk, tokenRequests } from "../msw/cognito";

beforeEach(() => {
  sessionStorage.clear();
  tokenRequests.length = 0;
});

async function sidebarLinks(): Promise<HTMLElement[]> {
  const nav = (await screen.findAllByRole("navigation", { name: SHELL_TEXT.navLabel }))[0];
  if (!nav) throw new Error("no navigation");
  return within(nav).getAllByRole("link");
}

const RESEARCHER = ["Dashboard", "Map", "Areas", "Reports"];
const ADMIN = ["Admin Overview", "Users", "Areas Management", "Retrievals", "Settings", "Activity"];

describe("role-based navigation (Requirements 1.4 to 1.7, 23.4)", () => {
  it("a researcher sees exactly the four researcher items", async () => {
    await renderSignedIn("/dashboard", { roles: ["researcher"] });
    expect((await sidebarLinks()).map((l) => l.textContent)).toEqual(RESEARCHER);
    expect(screen.queryByText(SHELL_TEXT.adminGroup)).not.toBeInTheDocument();
  });

  it("an admin sees the researcher items and the six admin items", async () => {
    await renderSignedIn("/dashboard", { roles: ["admin"] });
    expect((await sidebarLinks()).map((l) => l.textContent)).toEqual([...RESEARCHER, ...ADMIN]);
  });

  it("an admin reaches every admin route", async () => {
    const { services } = await renderSignedIn("/admin", { roles: ["admin"] });
    expect(await screen.findByRole("heading", { level: 1, name: "Admin Overview" })).toBeInTheDocument();
    for (const [path, title] of [
      ["/admin/users", "Users"],
      ["/admin/areas", "Areas Management"],
      ["/admin/retrievals", "Retrievals"],
      ["/admin/settings", "Settings"],
      ["/admin/activity", "Activity"],
    ] as const) {
      await act(async () => {
        await services.router.navigate(path);
      });
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    }
  });

  it("a researcher reaches every researcher route", async () => {
    const { services } = await renderSignedIn("/dashboard");
    for (const [path, title] of [
      ["/map", "Map"],
      ["/areas", "Areas"],
      ["/areas/a1", "Eco-Sentinel Prestea Test"],
      ["/areas/a1/timeseries", "NDVI time series"],
      ["/areas/a1/compare", "Date comparison"],
      ["/reports", "Reports"],
      ["/reports/r1", "Prestea: sentinel-2 NDVI"],
    ] as const) {
      await act(async () => {
        await services.router.navigate(path);
      });
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    }
  });

  it("a researcher opening /admin is sent to /dashboard with a dismissible notice", async () => {
    const { pathname } = await renderSignedIn("/admin/users", { roles: ["researcher"] });
    await waitFor(() => expect(pathname()).toBe("/dashboard"));
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(NOTICE_TEXT.ADMIN_REQUIRED);
    expect(screen.queryByRole("heading", { name: "Users" })).not.toBeInTheDocument();
    await userEvent.click(within(notice).getByRole("button", { name: SHELL_TEXT.dismiss }));
    expect(screen.queryByText(NOTICE_TEXT.ADMIN_REQUIRED)).not.toBeInTheDocument();
  });

  it("the notice stays visible for at least 5 seconds", async () => {
    const { pathname } = await renderSignedIn("/admin", { roles: ["researcher"] });
    await waitFor(() => expect(pathname()).toBe("/dashboard"));
    expect(await screen.findByText(NOTICE_TEXT.ADMIN_REQUIRED)).toBeInTheDocument();
    vi.useFakeTimers();
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });
      expect(screen.getByText(NOTICE_TEXT.ADMIN_REQUIRED)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks only the current item active with aria-current", async () => {
    const user = userEvent.setup();
    await renderSignedIn("/areas/a1", { roles: ["admin"] });
    // The area page heads with the area name (default contract fixture).
    await screen.findByRole("heading", { level: 1, name: "Eco-Sentinel Prestea Test" });
    let links = await sidebarLinks();
    expect(links.filter((l) => l.getAttribute("aria-current") === "page").map((l) => l.textContent)).toEqual(["Areas"]);
    expect(links.find((l) => l.textContent === "Areas")).toHaveClass("bg-primary");

    await user.click(links.find((l) => l.textContent === "Users") as HTMLElement);
    await screen.findByRole("heading", { level: 1, name: "Users" });
    links = await sidebarLinks();
    expect(links.filter((l) => l.getAttribute("aria-current") === "page").map((l) => l.textContent)).toEqual(["Users"]);
    expect(links.find((l) => l.textContent === "Areas")).not.toHaveClass("bg-primary");
  });
});

describe("header (Requirements 4.6, 4.7)", () => {
  it("shows the Principal email when present", async () => {
    await renderSignedIn("/dashboard", { username: "u1", email: "u1@example.org" });
    expect(await screen.findByTestId("principal-email")).toHaveTextContent("u1@example.org");
    // The username (an opaque ID with email sign-in) is not shown next to the email.
    expect(screen.queryByTestId("principal-username")).not.toBeInTheDocument();
  });

  it("falls back to the ID-token email claim for display", async () => {
    await renderSignedIn("/dashboard", { username: "u1", email: null });
    expect(await screen.findByTestId("principal-email")).toHaveTextContent("researcher@example.org");
  });

  it("shows the username only when no email is known", async () => {
    await renderSignedIn(
      "/dashboard",
      { username: "u1", email: null },
      undefined,
      tokenOk({ refresh_token: undefined, id_token: buildIdToken({ sub: "x" }) }),
    );
    expect(await screen.findByTestId("principal-username")).toHaveTextContent("u1");
    expect(screen.queryByTestId("principal-email")).not.toBeInTheDocument();
  });
});
