import { type FormEvent, useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router";

import { ResponsiveTable } from "@/components/common/DataTable";
import { FormField } from "@/components/common/FormField";
import { Pagination } from "@/components/common/Pagination";
import { EmptyState, RegionError, RegionSkeleton } from "@/components/common/RegionState";
import { VerbatimText } from "@/components/common/VerbatimText";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/core/api/errors";
import { AREA_COLUMNS } from "@/features/areas/columns";
import { AREA_PAGE_SIZE, useAreaList } from "@/features/areas/hooks";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { bboxInputs, EMPTY_BBOX, formatBbox, parseBbox, validateBbox, type BboxErrors, type BboxInputs } from "@/lib/bbox";
import { AREA_TEXT } from "@/lib/messages";
import { PAGE_TITLE } from "@/lib/pageTitles";
import type { AreaListParams, AreaStatusFilter } from "@/types/api";

export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_MAX_LENGTH = 100;

const STATUS_OPTIONS: readonly { value: AreaStatusFilter; label: string }[] = [
  { value: "active", label: AREA_TEXT.statusActive },
  { value: "archived", label: AREA_TEXT.statusArchived },
  { value: "all", label: AREA_TEXT.statusAll },
];

const selectClass =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10";

function isStatus(value: string | null): value is AreaStatusFilter {
  return value === "active" || value === "archived" || value === "all";
}

const BBOX_FIELDS: readonly { key: keyof BboxInputs; label: string }[] = [
  { key: "minLon", label: AREA_TEXT.minLon },
  { key: "minLat", label: AREA_TEXT.minLat },
  { key: "maxLon", label: AREA_TEXT.maxLon },
  { key: "maxLat", label: AREA_TEXT.maxLat },
];

function extentFrom(state: unknown): [number, number, number, number] | null {
  if (typeof state !== "object" || state === null) return null;
  const extent = (state as { extent?: unknown }).extent;
  return Array.isArray(extent) && extent.length === 4 && extent.every((n) => typeof n === "number")
    ? (extent as [number, number, number, number])
    : null;
}


/** The monitoring area list (Requirement 12.1 to 12.7). Filters live in the URL. */
export default function AreaListPage(): JSX.Element {
  const [search, setSearch] = useSearchParams();
  const location = useLocation();
  const status: AreaStatusFilter = isStatus(search.get("status")) ? (search.get("status") as AreaStatusFilter) : "active";
  const q = search.get("q") ?? "";
  const bbox = parseBbox(search.get("bbox"));
  const page = Math.max(1, Number.parseInt(search.get("page") ?? "1", 10) || 1);
  const mapExtent = extentFrom(location.state);

  const [text, setText] = useState(q);
  const debounced = useDebouncedValue(text, SEARCH_DEBOUNCE_MS);
  const [box, setBox] = useState<BboxInputs>(bboxInputs(bbox));
  const [boxErrors, setBoxErrors] = useState<BboxErrors>({});

  /** Change some filters; any filter change goes back to the first page. */
  function update(changes: Record<string, string | null>, keepPage = false): void {
    setSearch(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        if (!keepPage) next.delete("page");
        return next;
      },
      { replace: false, state: location.state },
    );
  }

  // The search text is sent once typing has paused for 300 ms (Requirement 12.2).
  useEffect(() => {
    const value = debounced.trim().slice(0, SEARCH_MAX_LENGTH);
    if (value !== q) update({ q: value });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the debounced text settles
  }, [debounced]);

  const params: AreaListParams = { status, limit: AREA_PAGE_SIZE, offset: (page - 1) * AREA_PAGE_SIZE };
  if (q) params.q = q;
  if (bbox) params.bbox = formatBbox(bbox);
  const list = useAreaList(params);

  function applyBox(event?: FormEvent): void {
    event?.preventDefault();
    const result = validateBbox(box);
    if (!result.ok) {
      setBoxErrors(result.errors);
      return;
    }
    setBoxErrors({});
    update({ bbox: formatBbox(result.box) });
  }

  function clearBox(): void {
    setBox(EMPTY_BBOX);
    setBoxErrors({});
    update({ bbox: null });
  }

  function resetFilters(): void {
    setText("");
    setBox(EMPTY_BBOX);
    setBoxErrors({});
    setSearch(new URLSearchParams(), { state: location.state });
  }

  // A 422 shows the Backend message; the entered filters stay (Requirement 12.6).
  const validationMessage =
    list.error instanceof ApiError && list.error.status === 422 && list.error.enveloped ? list.error.message : null;

  let body: JSX.Element;
  if (validationMessage) {
    body = (
      <div role="alert" className="rounded-md border border-status-error bg-status-error-bg p-4 text-status-error">
        <VerbatimText text={validationMessage} />
      </div>
    );
  } else if (list.isError && !list.data) {
    body = <RegionError error={list.error} context={AREA_TEXT.listError} onRetry={() => void list.refetch()} retrying={list.isFetching} />;
  } else if (!list.data) {
    body = <RegionSkeleton rows={6} />;
  } else if (list.data.items.length === 0) {
    body = (
      <EmptyState
        noun="areas"
        message={AREA_TEXT.empty}
        action={
          <Button type="button" variant="outline" onClick={resetFilters}>
            {AREA_TEXT.resetFilters}
          </Button>
        }
      />
    );
  } else {
    body = (
      <div className="space-y-2">
        {list.isError && (
          <RegionError error={list.error} context={AREA_TEXT.listError} onRetry={() => void list.refetch()} retrying={list.isFetching} />
        )}
        <ResponsiveTable caption={AREA_TEXT.tableCaption} columns={AREA_COLUMNS} rows={list.data.items} getRowId={(a) => a.id} />
        <Pagination
          total={list.data.total}
          limit={list.data.limit}
          offset={list.data.offset}
          disabled={list.isFetching}
          onOffsetChange={(offset) => update({ page: String(Math.floor(offset / AREA_PAGE_SIZE) + 1) }, true)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
        {PAGE_TITLE.areas}
      </h1>

      <div className="space-y-4 rounded-lg border bg-card p-4 shadow">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="area-q" label={AREA_TEXT.search} hint={AREA_TEXT.searchHint}>
            {(control) => (
              <Input {...control} type="search" maxLength={SEARCH_MAX_LENGTH} value={text} onChange={(e) => setText(e.target.value)} />
            )}
          </FormField>
          <FormField id="area-status" label={AREA_TEXT.status}>
            {(control) => (
              <select {...control} className={selectClass} value={status} onChange={(e) => update({ status: e.target.value === "active" ? null : e.target.value })}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>

        <form aria-label={AREA_TEXT.bbox} noValidate onSubmit={applyBox} className="space-y-3">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">{AREA_TEXT.bbox}</legend>
            <p className="text-sm text-ink-muted">{AREA_TEXT.bboxHint}</p>
            <div className="grid gap-4 sm:grid-cols-4">
              {BBOX_FIELDS.map(({ key, label }) => (
                <FormField key={key} id={`bbox-${key}`} label={label} error={boxErrors[key]}>
                  {(control) => (
                    <Input {...control} inputMode="decimal" value={box[key]} onChange={(e) => setBox((b) => ({ ...b, [key]: e.target.value }))} />
                  )}
                </FormField>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="outline" className="h-11 sm:h-10">
              {AREA_TEXT.applyBbox}
            </Button>
            {mapExtent && (
              <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={() => setBox(bboxInputs(mapExtent))}>
                {AREA_TEXT.useMapExtent}
              </Button>
            )}
            {bbox && (
              <Button type="button" variant="ghost" className="h-11 sm:h-10" onClick={clearBox}>
                {AREA_TEXT.clearBbox}
              </Button>
            )}
          </div>
        </form>
      </div>

      <section aria-label={AREA_TEXT.tableCaption} aria-busy={list.isPending || list.isFetching} className="min-w-0">
        {body}
      </section>
    </div>
  );
}

