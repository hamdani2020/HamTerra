import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import { AUTH_FAILURE_TEXT, AUTH_TEXT } from "@/lib/messages";

import { renderApp } from "../auth/authHarness";

beforeEach(() => {
  sessionStorage.clear();
});

describe("accessibility of the public auth pages (Requirement 21.4)", () => {
  it("landing page has no axe violations", async () => {
    const { container } = await renderApp("/");
    expect(screen.getByRole("button", { name: AUTH_TEXT.signIn })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("auth error page has no axe violations", async () => {
    const { container, pathname } = await renderApp("/auth/callback?code=abc&state=x");
    await waitFor(() => expect(pathname()).toBe("/auth/error"));
    expect(screen.getByRole("heading", { name: AUTH_FAILURE_TEXT.state_mismatch.title })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("signed-out page has no axe violations", async () => {
    const { container } = await renderApp("/signed-out");
    expect(await axe(container)).toHaveNoViolations();
  });
});
