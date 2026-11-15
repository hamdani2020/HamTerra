import { useState } from "react";

import { ResponsiveTable, type Column } from "@/components/common/DataTable";
import { Pagination } from "@/components/common/Pagination";
import { EmptyState, RegionError, RegionSkeleton } from "@/components/common/RegionState";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError } from "@/core/api/errors";
import { useCurrentPrincipal } from "@/core/auth/principal";
import { AREA_COLUMNS } from "@/features/areas/columns";
import { AREA_PAGE_SIZE, useAreaList } from "@/features/areas/hooks";
import { useArea } from "@/features/map/hooks";
import { ADMIN_AREA_TEXT, AREA_TEXT } from "@/lib/messages";
import { isAdmin } from "@/lib/navigation";
import { PAGE_TITLE } from "@/lib/pageTitles";
import type { Area, AreaListParams } from "@/types/api";

import { useArchiveRestore } from "./areaHooks";
import { AreaForm } from "./AreaForm";

type Editing = { mode: "create" } | { mode: "edit"; areaId: string } | null;
type Pending = { area: Area; action: "archive" | "restore" } | null;

/** Loads the area with its geometry before the edit form opens. */
function EditArea({ areaId, onSaved, onCancel }: { areaId: string; onSaved: (a: Area) => void; onCancel: () => void }): JSX.Element {
  const area = useArea(areaId);
  if (area.isError) return <RegionError error={area.error} onRetry={() => void area.refetch()} retrying={area.isFetching} />;
  if (!area.data) return <RegionSkeleton rows={5} />;
  return <AreaForm area={area.data} onSaved={onSaved} onCancel={onCancel} />;
}

/**
 * Monitoring area management (Requirement 14). All statuses are listed. Write controls are
 * shown only to admins (14.16); the Backend enforces the role.
 */
export function AdminAreasPage(): JSX.Element {
  const { roles } = useCurrentPrincipal();
  const canWrite = isAdmin(roles);
  const [offset, setOffset] = useState(0);
  const params: AreaListParams = { status: "all", limit: AREA_PAGE_SIZE, offset };
  const list = useAreaList(params);
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const archiveRestore = useArchiveRestore();

  function saved(): void {
    setEditing(null);
    setFailure(null);
    setNotice(ADMIN_AREA_TEXT.saved);
  }

  function runAction(): void {
    if (!pending) return;
    const { area, action } = pending;
    setPending(null);
    setNotice(null);
    setFailure(null);
    archiveRestore.mutate(
      { areaId: area.id, action },
      {
        onSuccess: () => setNotice(action === "archive" ? ADMIN_AREA_TEXT.archived : ADMIN_AREA_TEXT.restored),
        // The status shown stays as it was: nothing is updated before the Backend confirms (14.14).
        onError: (error) =>
          setFailure(action === "restore" && error instanceof ApiError && error.status === 409 ? ADMIN_AREA_TEXT.restoreConflict : ADMIN_AREA_TEXT.actionFailed),
      },
    );
  }

  const columns: Column<Area>[] = canWrite
    ? [
        ...AREA_COLUMNS.filter((c) => c.id !== "details"),
        {
          id: "actions",
          header: ADMIN_AREA_TEXT.actions,
          cell: (a) => (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="h-11 sm:h-9" aria-label={`${ADMIN_AREA_TEXT.edit}: ${a.name}`} onClick={() => setEditing({ mode: "edit", areaId: a.id })}>
                {ADMIN_AREA_TEXT.edit}
              </Button>
              {a.status === "active" ? (
                <Button type="button" variant="outline" className="h-11 sm:h-9" aria-label={`${ADMIN_AREA_TEXT.archive}: ${a.name}`} disabled={archiveRestore.isPending} onClick={() => setPending({ area: a, action: "archive" })}>
                  {ADMIN_AREA_TEXT.archive}
                </Button>
              ) : (
                <Button type="button" variant="outline" className="h-11 sm:h-9" aria-label={`${ADMIN_AREA_TEXT.restore}: ${a.name}`} disabled={archiveRestore.isPending} onClick={() => setPending({ area: a, action: "restore" })}>
                  {ADMIN_AREA_TEXT.restore}
                </Button>
              )}
            </div>
          ),
        },
      ]
    : AREA_COLUMNS;

  let body: JSX.Element;
  if (list.isError && !list.data) {
    body = <RegionError error={list.error} context={AREA_TEXT.listError} onRetry={() => void list.refetch()} retrying={list.isFetching} />;
  } else if (!list.data) {
    body = <RegionSkeleton rows={6} />;
  } else if (list.data.items.length === 0) {
    body = <EmptyState noun="areas" />;
  } else {
    body = (
      <div className="space-y-2">
        <ResponsiveTable caption={AREA_TEXT.tableCaption} columns={columns} rows={list.data.items} getRowId={(a) => a.id} />
        <Pagination total={list.data.total} limit={list.data.limit} offset={list.data.offset} disabled={list.isFetching} onOffsetChange={setOffset} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
          {PAGE_TITLE.adminAreas}
        </h1>
        {canWrite && (
          <Button type="button" className="h-11 sm:h-10" onClick={() => setEditing({ mode: "create" })}>
            {ADMIN_AREA_TEXT.create}
          </Button>
        )}
      </div>
      {notice && (
        <p role="status" className="rounded-md border border-status-success bg-status-success-bg p-3 text-sm text-status-success">
          {notice}
        </p>
      )}
      {failure && (
        <p role="alert" className="rounded-md border border-status-error bg-status-error-bg p-3 text-sm text-status-error">
          {failure}
        </p>
      )}
      <section aria-label={AREA_TEXT.tableCaption} aria-busy={list.isFetching || archiveRestore.isPending} className="min-w-0">
        {body}
      </section>

      {canWrite && (
        <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editing?.mode === "edit" ? ADMIN_AREA_TEXT.editTitle : ADMIN_AREA_TEXT.createTitle}</DialogTitle>
              <DialogDescription>{ADMIN_AREA_TEXT.coordinateOrder}</DialogDescription>
            </DialogHeader>
            {editing?.mode === "create" && <AreaForm onSaved={saved} onCancel={() => setEditing(null)} />}
            {editing?.mode === "edit" && <EditArea areaId={editing.areaId} onSaved={saved} onCancel={() => setEditing(null)} />}
          </DialogContent>
        </Dialog>
      )}

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.action === "restore" ? ADMIN_AREA_TEXT.restoreTitle : ADMIN_AREA_TEXT.archiveTitle}</AlertDialogTitle>
            <AlertDialogDescription>{pending?.action === "restore" ? ADMIN_AREA_TEXT.restoreBody : ADMIN_AREA_TEXT.archiveBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ADMIN_AREA_TEXT.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={runAction}>{pending?.action === "restore" ? ADMIN_AREA_TEXT.restore : ADMIN_AREA_TEXT.archive}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
