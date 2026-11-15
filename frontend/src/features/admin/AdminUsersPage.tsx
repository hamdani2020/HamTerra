import { type FormEvent, useState } from "react";

import { ResponsiveTable, type Column } from "@/components/common/DataTable";
import { FormField } from "@/components/common/FormField";
import { Pagination } from "@/components/common/Pagination";
import { EmptyState, RegionError, RegionSkeleton } from "@/components/common/RegionState";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/core/api/errors";
import { useCurrentPrincipal } from "@/core/auth/principal";
import { formatDateTime } from "@/lib/format";
import { ADMIN_TEXT, describeError } from "@/lib/messages";
import { PAGE_TITLE } from "@/lib/pageTitles";
import { parsePageSize } from "@/lib/pagination";
import type { AdminUser, AdminUserListParams, Role } from "@/types/api";

import { ADMIN_PAGE_SIZE, useAdminUser, useAdminUsers, useChangeRoles } from "./adminHooks";
import { PageSizeField, alertClass, noticeClass, selectClass } from "./filters";

const ROLES: readonly Role[] = ["admin", "researcher"];
const ROLE_LABEL: Record<Role, string> = { admin: ADMIN_TEXT.roleAdmin, researcher: ADMIN_TEXT.roleResearcher };

type Outcome = { kind: "notice" | "alert"; text: string } | null;

function rolesText(roles: readonly string[]): string {
  return roles.length === 0 ? ADMIN_TEXT.noRoles : roles.join(", ");
}

/**
 * Role editor (Requirements 17.4 to 17.10). One mutation per editor, so the confirm control
 * stays disabled while a request for this user is in flight. Displayed roles change only
 * through the refetch after a 200.
 */
function RoleEditor({ user, onDone }: { user: AdminUser; onDone: (outcome: Outcome) => void }): JSX.Element {
  const [selected, setSelected] = useState<Role[]>(() => ROLES.filter((r) => user.roles.includes(r)));
  const [error, setError] = useState<string | null>(null);
  const change = useChangeRoles(user.sub);

  function toggle(role: Role, on: boolean): void {
    setSelected((s) => (on ? ROLES.filter((r) => r === role || s.includes(r)) : s.filter((r) => r !== role)));
  }

  function confirm(): void {
    setError(null);
    change.mutate(selected, {
      onSuccess: (result) => onDone({ kind: "notice", text: `${result.message} ${ADMIN_TEXT.afterNextLogin}` }),
      onError: (e) => {
        const status = e instanceof ApiError ? e.status : 0;
        const code = e instanceof ApiError ? e.code : "";
        // 501 and 409 end the edit; the roles shown stay as they were (17.7 to 17.9).
        if (status === 501) return onDone({ kind: "alert", text: ADMIN_TEXT.notEnabled });
        if (code === "SELF_ROLE_CHANGE") return onDone({ kind: "alert", text: ADMIN_TEXT.selfChange });
        if (code === "LAST_ADMIN") return onDone({ kind: "alert", text: ADMIN_TEXT.lastAdmin });
        // 404, 502, 504 and others keep the editor open with the selections (17.10).
        if (status === 404) return setError(ADMIN_TEXT.userNotFound);
        if (status === 502 || status === 504) return setError(ADMIN_TEXT.serviceUnavailable);
        setError(`${ADMIN_TEXT.roleChangeFailed} ${describeError(e).body}`);
      },
    });
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-foreground">{ADMIN_TEXT.roles}</legend>
        {ROLES.map((role) => (
          <div key={role} className="flex min-h-11 items-center gap-3">
            <Checkbox
              id={`role-${role}`}
              checked={selected.includes(role)}
              disabled={change.isPending}
              onCheckedChange={(v) => toggle(role, v === true)}
            />
            <Label htmlFor={`role-${role}`}>{ROLE_LABEL[role]}</Label>
          </div>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" className="h-11 sm:h-10" disabled={change.isPending} onClick={() => onDone(null)}>
          {ADMIN_TEXT.close}
        </Button>
        <Button type="button" className="h-11 sm:h-10" disabled={change.isPending} onClick={confirm}>
          {change.isPending ? ADMIN_TEXT.savingRoles : ADMIN_TEXT.confirmRoles}
        </Button>
      </DialogFooter>
    </div>
  );
}

function UserDetails({ sub, ownSub, onEdit }: { sub: string; ownSub: string; onEdit: (u: AdminUser) => void }): JSX.Element {
  const user = useAdminUser(sub);
  let body: JSX.Element;
  if (user.isError) {
    body = <RegionError error={user.error} context={ADMIN_TEXT.userError} onRetry={() => void user.refetch()} retrying={user.isFetching} />;
  } else if (!user.data) {
    body = <RegionSkeleton rows={4} />;
  } else {
    const u = user.data;
    const own = u.sub === ownSub;
    body = (
      <div className="space-y-3">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">{ADMIN_TEXT.username}</dt>
          <dd className="[overflow-wrap:anywhere]">{u.username}</dd>
          <dt className="text-ink-muted">{ADMIN_TEXT.email}</dt>
          <dd className="[overflow-wrap:anywhere]">{u.email ?? ADMIN_TEXT.notAvailableEmail}</dd>
          <dt className="text-ink-muted">{ADMIN_TEXT.sub}</dt>
          <dd className="[overflow-wrap:anywhere]">{u.sub}</dd>
          <dt className="text-ink-muted">{ADMIN_TEXT.roles}</dt>
          <dd>{rolesText(u.roles)}</dd>
          <dt className="text-ink-muted">{ADMIN_TEXT.status}</dt>
          <dd>{u.status}</dd>
          <dt className="text-ink-muted">{ADMIN_TEXT.lastSeen}</dt>
          <dd>{u.last_seen_at ? formatDateTime(u.last_seen_at) : ADMIN_TEXT.never}</dd>
        </dl>
        <Button type="button" variant="outline" className="h-11 sm:h-10" disabled={own} aria-describedby={own ? "own-account-reason" : undefined} onClick={() => onEdit(u)}>
          {ADMIN_TEXT.editRoles}
        </Button>
        {own && (
          <p id="own-account-reason" className="text-sm text-ink-muted">
            {ADMIN_TEXT.ownAccount}
          </p>
        )}
      </div>
    );
  }
  return (
    <section aria-labelledby="user-details-title" aria-busy={user.isPending} className="space-y-3 rounded-lg border bg-card p-4 shadow">
      <h2 id="user-details-title" className="text-lg font-semibold text-foreground">
        {ADMIN_TEXT.userDetails}
      </h2>
      {body}
    </section>
  );
}

/**
 * Users and roles (Requirement 17). Filters `role` and `q` only (G8). No create, reset or
 * delete control exists (17.12).
 */
export function AdminUsersPage(): JSX.Element {
  const principal = useCurrentPrincipal();
  const [roleInput, setRoleInput] = useState<"" | Role>("");
  const [qInput, setQInput] = useState("");
  const [sizeInput, setSizeInput] = useState(String(ADMIN_PAGE_SIZE));
  const [sizeError, setSizeError] = useState<string | undefined>(undefined);
  const [filters, setFilters] = useState<AdminUserListParams>({ limit: ADMIN_PAGE_SIZE });
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const list = useAdminUsers({ ...filters, offset });

  function apply(event: FormEvent): void {
    event.preventDefault();
    const limit = parsePageSize(sizeInput);
    if (limit === null) {
      setSizeError(ADMIN_TEXT.pageSizeInvalid);
      return;
    }
    setSizeError(undefined);
    const next: AdminUserListParams = { limit };
    if (roleInput) next.role = roleInput;
    if (qInput.trim()) next.q = qInput.trim();
    setFilters(next);
    setOffset(0);
  }

  const columns: Column<AdminUser>[] = [
    { id: "username", header: ADMIN_TEXT.username, cell: (u) => u.username },
    { id: "email", header: ADMIN_TEXT.email, cell: (u) => u.email ?? ADMIN_TEXT.notAvailableEmail },
    { id: "roles", header: ADMIN_TEXT.roles, cell: (u) => rolesText(u.roles) },
    { id: "status", header: ADMIN_TEXT.status, cell: (u) => u.status },
    { id: "last-seen", header: ADMIN_TEXT.lastSeen, cell: (u) => (u.last_seen_at ? formatDateTime(u.last_seen_at) : ADMIN_TEXT.never) },
    {
      id: "details",
      header: ADMIN_TEXT.details,
      cell: (u) => (
        <Button type="button" variant="outline" className="h-11 sm:h-9" aria-label={`${ADMIN_TEXT.details}: ${u.username}`} onClick={() => setSelected(u.sub)}>
          {ADMIN_TEXT.details}
        </Button>
      ),
    },
  ];

  let body: JSX.Element;
  if (list.isError) {
    body = <RegionError error={list.error} context={ADMIN_TEXT.usersError} onRetry={() => void list.refetch()} retrying={list.isFetching} />;
  } else if (!list.data) {
    body = <RegionSkeleton rows={6} />;
  } else if (list.data.items.length === 0) {
    body = <EmptyState noun="users" message={ADMIN_TEXT.usersEmpty} />;
  } else {
    body = (
      <div className="space-y-2">
        <ResponsiveTable caption={ADMIN_TEXT.usersCaption} columns={columns} rows={list.data.items} getRowId={(u) => u.sub} />
        <Pagination total={list.data.total} limit={list.data.limit} offset={list.data.offset} disabled={list.isFetching} onOffsetChange={setOffset} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
        {PAGE_TITLE.adminUsers}
      </h1>
      <form noValidate onSubmit={apply} className="grid gap-4 rounded-lg border bg-card p-4 shadow sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
        <FormField id="users-role" label={ADMIN_TEXT.role}>
          {(control) => (
            <select {...control} className={selectClass} value={roleInput} onChange={(e) => setRoleInput(e.target.value as "" | Role)}>
              <option value="">{ADMIN_TEXT.anyRole}</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField id="users-q" label={ADMIN_TEXT.search}>
          {(control) => <Input {...control} value={qInput} onChange={(e) => setQInput(e.target.value)} />}
        </FormField>
        <PageSizeField id="users-size" value={sizeInput} error={sizeError} onChange={setSizeInput} />
        <Button type="submit" variant="outline" className="h-11 sm:h-10">
          {ADMIN_TEXT.apply}
        </Button>
      </form>
      {outcome && (
        <p role={outcome.kind === "notice" ? "status" : "alert"} className={outcome.kind === "notice" ? noticeClass : alertClass}>
          {outcome.text}
        </p>
      )}
      <section aria-label={ADMIN_TEXT.usersCaption} aria-busy={list.isFetching} className="min-w-0">
        {body}
      </section>
      {selected !== null && <UserDetails sub={selected} ownSub={principal.sub} onEdit={(u) => { setOutcome(null); setEditing(u); }} />}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ADMIN_TEXT.roleEditorTitle}</DialogTitle>
            <DialogDescription>
              {editing?.username}. {ADMIN_TEXT.roleEditorBody}
            </DialogDescription>
          </DialogHeader>
          {editing && editing.sub !== principal.sub && (
            <RoleEditor
              key={editing.sub}
              user={editing}
              onDone={(o) => {
                setEditing(null);
                if (o) setOutcome(o);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
