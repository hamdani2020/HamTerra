import { type ReactNode, useState } from "react";

import { RegionError, RegionSkeleton } from "@/components/common/RegionState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { VerbatimText } from "@/components/common/VerbatimText";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatInteger } from "@/lib/format";
import { ADMIN_TEXT } from "@/lib/messages";
import { PAGE_TITLE } from "@/lib/pageTitles";
import type { IntegrationStatus, IntegrationsStatus } from "@/types/api";

import { RECENT_ACTIVITY, RECENT_FAILURES, useActivity, useAdminDashboard, useIntegrations, useRetrievals } from "./adminHooks";
import { OutcomeBadge, RetrievalStatusBadge } from "./badges";

function Card({ id, title, busy, children, actions }: { id: string; title: string; busy: boolean; children: ReactNode; actions?: ReactNode }): JSX.Element {
  return (
    <section aria-labelledby={id} aria-busy={busy} className="space-y-3 rounded-lg border bg-card p-4 shadow">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-lg font-semibold text-foreground">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Counts as numbers; zero shows "0" (Requirement 16.9). */
function CountList({ entries, label }: { entries: [string, number][]; label: string }): JSX.Element {
  return (
    <dl aria-label={label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
      {entries.map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="text-ink-muted">{name}</dt>
          <dd className="text-right font-medium tabular-nums">{formatInteger(value ?? 0)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProviderStatus({ name, status, probed }: { name: string; status: IntegrationStatus; probed: IntegrationStatus | undefined }): JSX.Element {
  const probe = probed?.probe ?? null;
  return (
    <div className="space-y-2 rounded-md border p-3" aria-label={name} role="group">
      <p className="font-medium text-foreground">{name}</p>
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={status.configured ? "success" : "warning"} label={status.configured ? ADMIN_TEXT.configured : ADMIN_TEXT.notConfigured} />
        <StatusBadge tone={status.enabled ? "success" : "neutral"} label={status.enabled ? ADMIN_TEXT.enabled : ADMIN_TEXT.disabled} />
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-muted">{ADMIN_TEXT.lastSuccess}</dt>
        <dd>{status.last_success_at ? formatDateTime(status.last_success_at) : ADMIN_TEXT.never}</dd>
        <dt className="text-ink-muted">{ADMIN_TEXT.lastFailure}</dt>
        <dd>{status.last_failure_at ? formatDateTime(status.last_failure_at) : ADMIN_TEXT.never}</dd>
        <dt className="text-ink-muted">{ADMIN_TEXT.failures24h}</dt>
        <dd className="tabular-nums">{formatInteger(status.failures_24h)}</dd>
        {status.last_error !== null && (
          <>
            <dt className="text-ink-muted">{ADMIN_TEXT.lastError}</dt>
            <dd>
              <VerbatimText as="span" text={status.last_error} />
            </dd>
          </>
        )}
        {probe && (
          <>
            <dt className="text-ink-muted">{ADMIN_TEXT.probe}</dt>
            <dd>
              <StatusBadge
                tone={probe.ok ? "success" : "error"}
                label={probe.ok ? ADMIN_TEXT.probeOk : probe.outcome === "timeout" ? ADMIN_TEXT.probeTimeout : ADMIN_TEXT.probeFailed}
              />
            </dd>
            <dt className="text-ink-muted">{ADMIN_TEXT.probeLatency}</dt>
            <dd className="tabular-nums">{formatInteger(probe.latency_ms)} ms</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function Integrations(): JSX.Element {
  const status = useIntegrations(false);
  const [probeRequested, setProbeRequested] = useState(false);
  const probe = useIntegrations(true, probeRequested);
  const probing = probeRequested && probe.isFetching;

  function runProbe(): void {
    if (!probeRequested) setProbeRequested(true);
    else void probe.refetch();
  }

  let body: JSX.Element;
  if (status.isError && !status.data) {
    body = <RegionError error={status.error} context={ADMIN_TEXT.integrationsError} onRetry={() => void status.refetch()} retrying={status.isFetching} />;
  } else if (!status.data) {
    body = <RegionSkeleton rows={4} />;
  } else {
    const probed: IntegrationsStatus | undefined = probe.isError ? undefined : probe.data;
    body = (
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <ProviderStatus name={ADMIN_TEXT.agromonitoring} status={status.data.agromonitoring} probed={probed?.agromonitoring} />
          <ProviderStatus name={ADMIN_TEXT.weather} status={status.data.weather} probed={probed?.weather} />
        </div>
        {/* A failed probe stays in this card; the non-probe values above stay (16.4). */}
        {probe.isError && !probing && <RegionError error={probe.error} context={ADMIN_TEXT.probeError} />}
      </div>
    );
  }
  return (
    <Card
      id="admin-integrations"
      title={ADMIN_TEXT.integrationsTitle}
      busy={status.isPending || probing}
      actions={
        <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={probing || !status.data} onClick={runProbe}>
          {probing ? ADMIN_TEXT.probing : ADMIN_TEXT.probe}
        </Button>
      }
    >
      {body}
    </Card>
  );
}

function Counts(): JSX.Element {
  const dashboard = useAdminDashboard();
  let body: JSX.Element;
  if (dashboard.isError && !dashboard.data) {
    body = <RegionError error={dashboard.error} context={ADMIN_TEXT.countsError} onRetry={() => void dashboard.refetch()} retrying={dashboard.isFetching} />;
  } else if (!dashboard.data) {
    body = <RegionSkeleton rows={4} />;
  } else {
    const d = dashboard.data;
    body = (
      <div className="grid gap-4 md:grid-cols-3">
        <CountList
          label={ADMIN_TEXT.countsTitle}
          entries={[
            [ADMIN_TEXT.areasActive, d.areas_active],
            [ADMIN_TEXT.observationsTotal, d.observations_total],
            [ADMIN_TEXT.reportsTotal, d.reports_total],
          ]}
        />
        <div>
          <p className="mb-1 text-sm font-medium text-foreground">{ADMIN_TEXT.usersByRole}</p>
          <CountList label={ADMIN_TEXT.usersByRole} entries={Object.entries(d.users_by_role)} />
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-foreground">
            {ADMIN_TEXT.retrievalsByStatus} ({ADMIN_TEXT.last7Days})
          </p>
          <CountList label={`${ADMIN_TEXT.retrievalsByStatus}, ${ADMIN_TEXT.last7Days}`} entries={Object.entries(d.retrievals_7d_by_status)} />
        </div>
      </div>
    );
  }
  return (
    <Card id="admin-counts" title={ADMIN_TEXT.countsTitle} busy={dashboard.isPending}>
      {body}
    </Card>
  );
}

function RecentFailures(): JSX.Element {
  const failures = useRetrievals(RECENT_FAILURES);
  let body: JSX.Element;
  if (failures.isError && !failures.data) {
    body = <RegionError error={failures.error} context={ADMIN_TEXT.failuresError} onRetry={() => void failures.refetch()} retrying={failures.isFetching} />;
  } else if (!failures.data) {
    body = <RegionSkeleton rows={3} />;
  } else if (failures.data.items.length === 0) {
    body = <p className="text-sm text-ink-muted">{ADMIN_TEXT.failuresEmpty}</p>;
  } else {
    body = (
      <ul className="space-y-2">
        {failures.data.items.slice(0, 5).map((r) => (
          <li key={r.id} className="space-y-1 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <RetrievalStatusBadge status={r.status} />
              <span className="font-medium">{r.provider}</span>
              <span className="text-ink-muted">{r.area_id ?? ADMIN_TEXT.noArea}</span>
              <span className="text-ink-muted">{formatDateTime(r.started_at)}</span>
            </div>
            {r.error && (
              <p>
                <code>{r.error.code}</code> <VerbatimText as="span" text={r.error.message ?? ""} />
              </p>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Card id="admin-failures" title={ADMIN_TEXT.failuresTitle} busy={failures.isPending}>
      {body}
    </Card>
  );
}

function RecentActivity(): JSX.Element {
  const activity = useActivity(RECENT_ACTIVITY);
  let body: JSX.Element;
  if (activity.isError && !activity.data) {
    body = <RegionError error={activity.error} context={ADMIN_TEXT.activityError} onRetry={() => void activity.refetch()} retrying={activity.isFetching} />;
  } else if (!activity.data) {
    body = <RegionSkeleton rows={3} />;
  } else if (activity.data.items.length === 0) {
    body = <p className="text-sm text-ink-muted">{ADMIN_TEXT.activityEmpty}</p>;
  } else {
    body = (
      <ul className="space-y-2">
        {activity.data.items.slice(0, 10).map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
            <span className="text-ink-muted">{formatDateTime(e.occurred_at)}</span>
            <span className="font-medium">{e.actor_sub ?? ADMIN_TEXT.noActor}</span>
            <code>{e.action}</code>
            <span className="text-ink-muted">{e.target_type}</span>
            <OutcomeBadge outcome={e.outcome} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Card id="admin-activity" title={ADMIN_TEXT.activityTitle} busy={activity.isPending}>
      {body}
    </Card>
  );
}

/**
 * The admin overview (Requirement 16): independent cards, each with its own query, error
 * and retry. No key or masked key is shown, because the Backend returns none.
 */
export function AdminOverviewPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
        {PAGE_TITLE.admin}
      </h1>
      <Counts />
      <Integrations />
      <div className="grid gap-4 lg:grid-cols-2">
        <RecentFailures />
        <RecentActivity />
      </div>
    </div>
  );
}
