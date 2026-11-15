import { act, render, screen, within } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bootstrap } from "@/bootstrap";
import { loadConfig } from "@/core/config";
import { ConfigErrorPage } from "@/pages/ConfigErrorPage";
import { buildEnv } from "../factories";

async function boot(env: Record<string, string | undefined>): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    bootstrap(root, env);
  });
  return container;
}

function names(list: HTMLElement): string[] {
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

describe("configuration error page (Requirements 2.2, 2.3)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lists missing and blank variables by name and sends no request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await boot(buildEnv({ VITE_COGNITO_DOMAIN: undefined, VITE_COGNITO_CLIENT_ID: "   " }));
    expect(screen.getByRole("heading", { level: 1, name: /not configured/i })).toBeInTheDocument();
    const missing = screen.getByRole("list", { name: /missing or empty/i });
    expect(names(missing)).toEqual(["VITE_COGNITO_DOMAIN", "VITE_COGNITO_CLIENT_ID"]);
    expect(screen.queryByRole("list", { name: /invalid/i })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lists invalid URL variables by name without showing their values", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const container = await boot(
      buildEnv({ VITE_API_BASE_URL: "localhost:8000", VITE_LOGOUT_URI: "javascript:void(0)" }),
    );
    const invalid = screen.getByRole("list", { name: /invalid/i });
    expect(names(invalid)).toEqual(["VITE_API_BASE_URL", "VITE_LOGOUT_URI"]);
    expect(container.textContent).not.toContain("localhost:8000");
    expect(container.textContent).not.toContain("javascript:");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders the application, not the error page, for a valid configuration", async () => {
    await boot(buildEnv());
    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Eco-Sentinel Ghana" })).toBeInTheDocument();
  });

  it("never shows a configured value on the page", () => {
    const env = buildEnv({ VITE_REDIRECT_URI: "" });
    const result = loadConfig(env);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const { container } = render(<ConfigErrorPage missing={result.missing} invalid={result.invalid} />);
    for (const value of Object.values(env)) {
      if (value) expect(container.textContent).not.toContain(value);
    }
  });
});
