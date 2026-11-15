import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import { AuthCard } from "@/components/common/AuthCard";
import { EvidenceNote } from "@/components/common/EvidenceNote";
import { FlagBadge } from "@/components/common/FlagBadge";
import { FormField } from "@/components/common/FormField";
import { QualityBadge } from "@/components/common/QualityBadge";
import { StatusBadge } from "@/components/common/StatusBadge";
import { WarningBanner } from "@/components/common/WarningBanner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

describe("StatusBadge, QualityBadge and FlagBadge (Requirement 21.5)", () => {
  it("always shows a text label beside colour and icon", () => {
    render(<StatusBadge tone="success" label="Success" />);
    expect(screen.getByText("Success")).toBeInTheDocument();
  });

  it("shows each quality level as text with a decorative icon", () => {
    const { container } = render(
      <>
        <QualityBadge level="good" />
        <QualityBadge level="limited" />
        <QualityBadge level="poor" />
      </>,
    );
    for (const label of ["Good", "Limited", "Poor"]) expect(screen.getByText(label)).toBeInTheDocument();
    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(3);
    icons.forEach((icon) => expect(icon).toHaveAttribute("aria-hidden", "true"));
  });

  it("uses the neutral investigation wording for flags", () => {
    render(
      <>
        <FlagBadge flag="flagged" />
        <FlagBadge flag="not_flagged" />
      </>,
    );
    expect(screen.getByText("Flagged for investigation")).toBeInTheDocument();
    expect(screen.getByText("Not flagged")).toBeInTheDocument();
  });

  it("neutral badges carry no status colour", () => {
    const { container } = render(<StatusBadge tone="neutral" label="Unknown" />);
    expect(container.firstElementChild?.className).not.toMatch(/status-/);
  });
});

describe("WarningBanner", () => {
  it("lists every notice unchanged", async () => {
    const long = "A long Backend notice ".repeat(20).trim();
    const { container } = render(<WarningBanner title="Warnings" messages={["First notice", long]} />);
    const region = screen.getByRole("region", { name: "Warnings" });
    const items = within(region).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual(["First notice", long]);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders nothing when there are no notices", () => {
    const { container } = render(<WarningBanner messages={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("EvidenceNote", () => {
  it("shows the aggregate statement and the Backend weather note unchanged", () => {
    render(
      <>
        <EvidenceNote kind="aggregate" />
        <EvidenceNote kind="weather" note="Context only; correlation does not imply causation." />
      </>,
    );
    expect(screen.getByText("NDVI values are polygon-level aggregates.")).toBeInTheDocument();
    expect(screen.getByText("Context only; correlation does not imply causation.")).toBeInTheDocument();
  });
});

describe("FormField", () => {
  it("links the control to a Backend field error", async () => {
    const { container } = render(
      <FormField id="area-name" label="Name" hint="1 to 100 characters" error="An active monitoring area with this name already exists.">
        {(control) => <Input {...control} defaultValue="Prestea" />}
      </FormField>,
    );
    const input = screen.getByLabelText("Name");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      "1 to 100 characters An active monitoring area with this name already exists.",
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("is not marked invalid without an error", () => {
    render(
      <FormField id="q" label="Search">
        {(control) => <Input {...control} />}
      </FormField>,
    );
    const input = screen.getByLabelText("Search");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(input).not.toHaveAttribute("aria-describedby");
  });
});

describe("Dialog focus management (Requirement 21.9)", () => {
  function Example(): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>Refresh observations</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Refresh observations</DialogTitle>
          <DialogDescription>Choose a date range.</DialogDescription>
          <Input aria-label="From" />
          <Button onClick={() => setOpen(false)}>Confirm</Button>
        </DialogContent>
      </Dialog>
    );
  }

  it("moves focus into the dialog, keeps it there and returns it on close", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Refresh observations" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    for (let i = 0; i < 5; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("returns focus after closing through a button too", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Refresh observations" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(trigger).toHaveFocus();
  });
});

describe("AuthCard", () => {
  it("renders an accessible card with a page heading", async () => {
    const { container } = render(
      <AuthCard title="Sign in">
        <Button>Sign in with Cognito</Button>
      </AuthCard>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
