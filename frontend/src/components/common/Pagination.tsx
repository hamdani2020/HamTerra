import { Button } from "@/components/ui/button";
import { pageText, rangeText, REGION_TEXT } from "@/lib/messages";
import { clampOffset } from "@/lib/pagination";

export interface PaginationProps {
  /** From the Backend page envelope (Requirement 5.14). */
  total: number;
  limit: number;
  offset: number;
  onOffsetChange: (offset: number) => void;
  disabled?: boolean;
  label?: string;
}

/** Previous and next controls with the returned `total`, `limit` and `offset`. */
export function Pagination({ total, limit, offset, onOffsetChange, disabled = false, label = REGION_TEXT.pagination }: PaginationProps): JSX.Element {
  const size = Math.max(1, limit);
  const page = Math.floor(offset / size) + 1;
  const pages = Math.max(1, Math.ceil(total / size));
  const atStart = offset <= 0;
  const atEnd = offset + size >= total;
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3 py-2">
      <p className="text-sm text-ink-muted" aria-live="polite">
        {rangeText(total, size, offset)} · {pageText(page, pages)}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 min-w-11 sm:h-9"
          disabled={disabled || atStart}
          onClick={() => onOffsetChange(clampOffset(offset - size))}
        >
          {REGION_TEXT.previous}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 min-w-11 sm:h-9"
          disabled={disabled || atEnd}
          onClick={() => onOffsetChange(clampOffset(offset + size))}
        >
          {REGION_TEXT.next}
        </Button>
      </div>
    </nav>
  );
}
