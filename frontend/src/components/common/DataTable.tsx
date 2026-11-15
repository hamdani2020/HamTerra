import type { ReactNode } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
}

export interface DataTableProps<T> {
  /** Table caption; visually hidden unless `showCaption`. */
  caption: string;
  showCaption?: boolean;
  columns: readonly Column<T>[];
  rows: readonly T[];
  getRowId: (row: T) => string;
  className?: string;
}

/**
 * A plain semantic table. It scrolls inside its own container when it is wider than the
 * viewport, so the page never scrolls sideways (Requirements 6.5, 6.6).
 */
export function DataTable<T>({ caption, showCaption = false, columns, rows, getRowId, className }: DataTableProps<T>): JSX.Element {
  return (
    <Table className={className}>
      <caption className={cn("mb-2 text-left text-sm text-ink-muted", !showCaption && "sr-only")} style={{ captionSide: "top" }}>
        {caption}
      </caption>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.id} scope="col" className={cn(column.align === "right" && "text-right", column.className)}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={getRowId(row)}>
            {columns.map((column) => (
              <TableCell key={column.id} className={cn("[overflow-wrap:anywhere]", column.align === "right" && "text-right tabular-nums", column.className)}>
                {column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * The table from 640 px; stacked cards below (Requirement 6.6). Both layouts are in the
 * document and the Tailwind `sm` breakpoint shows one of them.
 */
export function ResponsiveTable<T>(props: DataTableProps<T>): JSX.Element {
  const { caption, columns, rows, getRowId } = props;
  const [first, ...rest] = columns;
  return (
    <>
      <div className="hidden sm:block" data-testid="table-layout">
        <DataTable {...props} />
      </div>
      <ul aria-label={caption} className="space-y-3 sm:hidden" data-testid="card-layout">
        {rows.map((row) => (
          <li key={getRowId(row)} className="rounded-md border bg-card p-3 shadow">
            {first && <div className="mb-2 font-medium text-foreground [overflow-wrap:anywhere]">{first.cell(row)}</div>}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              {rest.map((column) => (
                <div key={column.id} className="contents">
                  <dt className="text-ink-muted">{column.header}</dt>
                  <dd className="text-foreground [overflow-wrap:anywhere]">{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
