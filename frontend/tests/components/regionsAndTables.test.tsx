import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

import { ChartContainer } from "@/components/common/ChartContainer";
import { DataTable, ResponsiveTable, type Column } from "@/components/common/DataTable";
import { KeyValueList } from "@/components/common/KeyValueList";
import { Legend } from "@/components/common/Legend";
import { Pagination } from "@/components/common/Pagination";
import { RegionState } from "@/components/common/RegionState";
import { ApiError, NetworkError } from "@/core/api/errors";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { REGION_TEXT } from "@/lib/messages";
import { TOKENS } from "@/styles/tokens";

import { createTestQueryClient } from "../renderWithProviders";

interface Row {
  id: string;
  name: string;
  value: number;
}

const columns: Column<Row>[] = [
  { id: "name", header: "Name", cell: (r) => r.name },
  { id: "value", header: "Value", cell: (r) => r.value.toFixed(2), align: "right" },
];
const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Area ${i}`, value: i / 10 }));

/** A controllable query function: each call waits for the test to settle it. */
function controlled<T>() {
  const calls: { resolve: (v: T) => void; reject: (e: unknown) => void }[] = [];
  const fn = vi.fn(
    () =>
      new Promise<T>((resolve, reject) => {
        calls.push({ resolve, reject });
      }),
  );
  return { fn, calls };
}

function Region({ queryFn, label = "Areas", isEmpty }: { queryFn: () => Promise<Row[]>; label?: string; isEmpty?: (d: Row[]) => boolean }): JSX.Element {
  const query = useQuery({ queryKey: [label], queryFn });
  return (
    <RegionState
      query={query}
      label={label}
      {...(isEmpty ? { isEmpty } : {})}
      empty={{ noun: "areas", action: <button type="button">Create area</button> }}
    >
      {(data) => <DataTable caption={label} columns={columns} rows={data} getRowId={(r) => r.id} />}
    </RegionState>
  );
}

function withClient(ui: ReactNode) {
  const client = createTestQueryClient();
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

describe("RegionState (Requirement 6)", () => {
  it("is busy with a skeleton in the first render while pending", () => {
    const { fn } = controlled<Row[]>();
    withClient(<Region queryFn={fn} />);
    const region = screen.getByRole("region", { name: "Areas" });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(within(region).getByTestId("region-skeleton")).toBeInTheDocument();
  });

  it("shows data and stops being busy", async () => {
    const { fn, calls } = controlled<Row[]>();
    withClient(<Region queryFn={fn} />);
    act(() => calls[0]?.resolve(rows(2)));
    const region = screen.getByRole("region", { name: "Areas" });
    expect(await within(region).findByRole("cell", { name: "Area 1" })).toBeInTheDocument();
    expect(region).toHaveAttribute("aria-busy", "false");
  });

  it("shows an empty state naming the item type and the next action", async () => {
    withClient(<Region queryFn={async () => []} isEmpty={(d) => d.length === 0} />);
    expect(await screen.findByText("No areas to show.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create area" })).toBeInTheDocument();
  });

  it("shows the error only in the failed region; retry repeats once, is disabled while pending and the data replaces the error", async () => {
    const user = userEvent.setup();
    const failing = controlled<Row[]>();
    withClient(
      <>
        <Region queryFn={failing.fn} label="Areas" />
        <Region queryFn={async () => rows(1)} label="Reports" />
      </>,
    );
    act(() => failing.calls[0]?.reject(new ApiError(500, "INTERNAL_ERROR", "x", { secret: "detail" }, "req-9", true)));
    const areas = screen.getByRole("region", { name: "Areas" });
    const alert = await within(areas).findByRole("alert");
    expect(alert).toHaveTextContent("req-9");
    expect(alert).not.toHaveTextContent("detail");
    // The other region is unaffected.
    const reports = screen.getByRole("region", { name: "Reports" });
    expect(await within(reports).findByRole("cell", { name: "Area 0" })).toBeInTheDocument();
    expect(within(reports).queryByRole("alert")).not.toBeInTheDocument();

    await user.click(within(areas).getByRole("button", { name: REGION_TEXT.retry }));
    expect(failing.fn).toHaveBeenCalledTimes(2);
    // With no earlier data the region shows the loading state again until the retry settles.
    expect(areas).toHaveAttribute("aria-busy", "true");
    expect(within(areas).getByTestId("region-skeleton")).toBeInTheDocument();
    expect(within(areas).queryByRole("button", { name: REGION_TEXT.retry })).not.toBeInTheDocument();

    act(() => failing.calls[1]?.resolve(rows(3)));
    // One render: once the data is present, the error and the retry control are gone.
    await waitFor(() => expect(within(areas).getByRole("cell", { name: "Area 2" })).toBeInTheDocument());
    expect(within(areas).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(areas).queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(failing.fn).toHaveBeenCalledTimes(2);
  });

  it("offers no retry for a permission error", async () => {
    withClient(<Region queryFn={() => Promise.reject(new ApiError(403, "FORBIDDEN", "x", null, null, true))} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission for this action.");
    expect(screen.queryByRole("button", { name: REGION_TEXT.retry })).not.toBeInTheDocument();
  });

  it("keeps earlier data visible, marked possibly outdated, when a refetch fails; retry is disabled while pending", async () => {
    const user = userEvent.setup();
    let mode: "ok" | "fail" | "hold" = "ok";
    let release: (() => void) | undefined;
    const queryFn = async (): Promise<Row[]> => {
      if (mode === "fail") throw new NetworkError();
      if (mode === "hold") {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return rows(4);
      }
      return rows(2);
    };
    const { client } = withClient(<Region queryFn={queryFn} />);
    expect(await screen.findByRole("cell", { name: "Area 1" })).toBeInTheDocument();

    mode = "fail";
    await act(async () => {
      await client.refetchQueries({ queryKey: ["Areas"] });
    });
    expect(await screen.findByText(REGION_TEXT.outdated)).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Area 1" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Connection problem");

    mode = "hold";
    await user.click(screen.getByRole("button", { name: REGION_TEXT.retry }));
    expect(screen.getByRole("button", { name: REGION_TEXT.retrying })).toBeDisabled();
    expect(screen.getByRole("region", { name: "Areas" })).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(release).toBeTypeOf("function"));
    act(() => release?.());
    expect(await screen.findByRole("cell", { name: "Area 3" })).toBeInTheDocument();
    expect(screen.queryByText(REGION_TEXT.outdated)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("has no axe violations in the error state", async () => {
    const { container } = withClient(<Region queryFn={() => Promise.reject(new NetworkError())} />);
    await screen.findByRole("alert");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("DataTable and Pagination (Requirements 5.14, 6.6)", () => {
  it("renders headers, rows and a caption", async () => {
    const { container } = render(<DataTable caption="Observations" columns={columns} rows={rows(3)} getRowId={(r) => r.id} />);
    const table = screen.getByRole("table", { name: "Observations" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "Value"]);
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByRole("cell", { name: "0.20" })).toHaveClass("text-right");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows total, limit and offset and moves by one page", async () => {
    const user = userEvent.setup();
    const onOffsetChange = vi.fn();
    render(<Pagination total={95} limit={20} offset={20} onOffsetChange={onOffsetChange} />);
    const nav = screen.getByRole("navigation", { name: REGION_TEXT.pagination });
    expect(nav).toHaveTextContent("Showing 21–40 of 95 · Page 2 of 5");
    await user.click(screen.getByRole("button", { name: REGION_TEXT.next }));
    expect(onOffsetChange).toHaveBeenLastCalledWith(40);
    await user.click(screen.getByRole("button", { name: REGION_TEXT.previous }));
    expect(onOffsetChange).toHaveBeenLastCalledWith(0);
  });

  it("disables previous on the first page and next on the last", () => {
    const { rerender } = render(<Pagination total={95} limit={20} offset={0} onOffsetChange={() => undefined} />);
    expect(screen.getByRole("button", { name: REGION_TEXT.previous })).toBeDisabled();
    expect(screen.getByRole("button", { name: REGION_TEXT.next })).toBeEnabled();
    rerender(<Pagination total={95} limit={20} offset={80} onOffsetChange={() => undefined} />);
    expect(screen.getByText(/Showing 81–95 of 95/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: REGION_TEXT.next })).toBeDisabled();
    rerender(<Pagination total={0} limit={20} offset={0} onOffsetChange={() => undefined} />);
    expect(screen.getByText(/Showing 0 of 0 · Page 1 of 1/)).toBeInTheDocument();
  });

  it("ResponsiveTable has a table from 640 px and stacked cards below", () => {
    render(<ResponsiveTable caption="Areas" columns={columns} rows={rows(2)} getRowId={(r) => r.id} />);
    expect(screen.getByTestId("table-layout")).toHaveClass("hidden", "sm:block");
    const cards = screen.getByTestId("card-layout");
    expect(cards).toHaveClass("sm:hidden");
    const items = within(cards).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[1] as HTMLElement).getByText("Area 1")).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText("Value")).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText("0.10")).toBeInTheDocument();
  });
});

describe("ChartContainer and Legend (Requirement 21.7)", () => {
  it("labels the figure and lists every legend entry as text", async () => {
    const { container } = render(
      <ChartContainer
        title="Mean NDVI, Sentinel-2"
        description="One point per observation."
        footer={
          <Legend
            title="Legend"
            items={[
              { label: "Mean NDVI", color: TOKENS["emerald-700"], shape: "line" },
              { label: "Low-quality observation", color: TOKENS["status-warning"], shape: "dot" },
            ]}
          />
        }
      >
        <div>chart</div>
      </ChartContainer>,
    );
    const figure = screen.getByRole("figure", { name: "Mean NDVI, Sentinel-2" });
    expect(figure).toHaveAccessibleDescription("One point per observation.");
    expect(within(figure).getAllByRole("listitem").map((i) => i.textContent)).toEqual(["Mean NDVI", "Low-quality observation"]);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("KeyValueList", () => {
  it("renders scalars and nested values as text only", () => {
    render(<KeyValueList label="Details" entries={{ count: 3, ok: false, nested: { a: [1, 2] }, html: "<b>x</b>", none: null }} />);
    const list = screen.getByLabelText("Details");
    expect(list).toHaveTextContent('{"a":[1,2]}');
    expect(list.querySelector("b")).toBeNull();
    expect(screen.getByText("<b>x</b>")).toBeInTheDocument();
    expect(screen.getByText("false")).toBeInTheDocument();
    expect(screen.getByText("null")).toBeInTheDocument();
  });
});

describe("useDebouncedValue", () => {
  it("updates once after the value stops changing", () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), { initialProps: { v: "a" } });
      rerender({ v: "ab" });
      act(() => void vi.advanceTimersByTime(200));
      rerender({ v: "abc" });
      act(() => void vi.advanceTimersByTime(299));
      expect(result.current).toBe("a");
      act(() => void vi.advanceTimersByTime(1));
      expect(result.current).toBe("abc");
    } finally {
      vi.useRealTimers();
    }
  });
});
