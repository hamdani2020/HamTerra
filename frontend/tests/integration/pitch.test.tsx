import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import { PITCH_SECTIONS, PITCH_TEXT } from "@/features/pitch/content";
import { boundingBoxCentre, formatCoordinate, fullyCloudyCount, observationCounts, SNAPSHOT } from "@/features/pitch/snapshot";
import { containsForbiddenTerm } from "@/lib/evidence";
import { formatDate } from "@/lib/format";
import { AUTH_TEXT, EVIDENCE_TEXT, SOURCE_LABEL, TIME_SERIES_TEXT } from "@/lib/messages";
import { ROUTES } from "@/lib/routes";

import { renderApp, renderSignedIn } from "../auth/authHarness";
import { resetMaps } from "../mocks/maplibre";

vi.mock("maplibre-gl", () => import("../mocks/maplibre"));
vi.mock("recharts", async (importOriginal) => (await import("../mocks/recharts")).rechartsWithFixedSize(importOriginal));

beforeEach(() => {
  sessionStorage.clear();
  resetMaps();
});

async function renderPitch(path: string = ROUTES.landing) {
  const view = await renderApp(path);
  // The sections are a lazy chunk; the team section is the last one.
  await screen.findByRole("heading", { level: 2, name: PITCH_TEXT.teamTitle });
  return view;
}

describe("evidence snapshot helpers", () => {
  it("counts observations and fully cloudy scenes from the saved responses", () => {
    expect(observationCounts(SNAPSHOT)).toEqual({ total: 42, bySource: { "sentinel-2": 27, "landsat-8": 15 } });
    expect(fullyCloudyCount(SNAPSHOT)).toBe(17);
  });

  it("labels the polygon centre in degrees with hemispheres", () => {
    const centre = boundingBoxCentre(SNAPSHOT.area);
    expect(centre).not.toBeNull();
    expect(formatCoordinate(centre as [number, number])).toBe("5.450° N, 1.980° W");
  });

  it("bundles every preview image the snapshot lists", () => {
    expect(SNAPSHOT.previews.length).toBe(8);
    expect(SNAPSHOT.previews.every((p) => p.url.length > 0)).toBe(true);
  });
});

describe("project page (/)", () => {
  it("shows the pitch with one sign-in control in the header and every section", async () => {
    const { container } = await renderPitch();
    expect(screen.getByRole("heading", { level: 1, name: PITCH_TEXT.headline })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: AUTH_TEXT.signIn })).toHaveLength(1);
    expect(screen.getByRole("button", { name: PITCH_TEXT.ctaPlatform })).toBeInTheDocument();
    for (const section of PITCH_SECTIONS) {
      expect(container.querySelector(`#${section.id}`), section.id).not.toBeNull();
    }
    const nav = screen.getByRole("navigation", { name: PITCH_TEXT.navLabel });
    expect(within(nav).getAllByRole("link")).toHaveLength(PITCH_SECTIONS.length);
  });

  it("shows the saved Backend output unchanged, with the aggregate note", async () => {
    await renderPitch();
    for (const comparison of SNAPSHOT.comparisons) {
      expect(screen.getAllByText(comparison.summary_text).length).toBeGreaterThan(0);
    }
    for (const limitation of SNAPSHOT.timeseries["sentinel-2"].limitations) {
      expect(screen.getAllByText(limitation).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText(EVIDENCE_TEXT.aggregateNote).length).toBeGreaterThan(0);
    expect(screen.getByText(SNAPSHOT.area.name)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(PITCH_TEXT.cloudStatLabel))).toBeInTheDocument();
  });

  it("charts one sensor at a time and switches on the sensor tab", async () => {
    await renderPitch();
    expect(screen.getByRole("heading", { name: `${TIME_SERIES_TEXT.chartTitle}, ${SOURCE_LABEL["sentinel-2"]}` })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: SOURCE_LABEL["landsat-8"] }));
    expect(await screen.findByRole("heading", { name: `${TIME_SERIES_TEXT.chartTitle}, ${SOURCE_LABEL["landsat-8"]}` })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: `${TIME_SERIES_TEXT.chartTitle}, ${SOURCE_LABEL["sentinel-2"]}` })).toBeNull();
  });

  it("shows the values of the selected preview", async () => {
    await renderPitch();
    const landsat = SNAPSHOT.previews.find((p) => p.observation.source === "landsat-8");
    expect(landsat).toBeDefined();
    const label = `${SOURCE_LABEL["landsat-8"]} · ${formatDate(landsat?.observation.date)}`;
    const target = screen.getAllByRole("button", { pressed: false }).find((b) => b.textContent?.includes(label));
    expect(target).toBeDefined();
    await userEvent.click(target as HTMLElement);
    expect(target).toHaveAttribute("aria-pressed", "true");
    // The detail panel follows the selection.
    expect(screen.getAllByText(label).length).toBeGreaterThan(1);
  });

  it("has no forbidden term and no axe violation once the sections load", async () => {
    const { container } = await renderPitch();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(containsForbiddenTerm(document.body.textContent ?? "")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("project page (/about)", () => {
  it("stays on the page for a signed-in user and links to the dashboard", async () => {
    const { pathname } = await renderSignedIn(ROUTES.about, { roles: ["researcher"] });
    await screen.findByRole("heading", { level: 2, name: PITCH_TEXT.teamTitle });
    expect(pathname()).toBe(ROUTES.about);
    expect(screen.getAllByRole("link", { name: PITCH_TEXT.ctaDashboard }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: AUTH_TEXT.signIn })).toBeNull();
  });

  it("offers sign-in when signed out", async () => {
    await renderPitch(ROUTES.about);
    expect(screen.getByRole("button", { name: AUTH_TEXT.signIn })).toBeInTheDocument();
  });
});
