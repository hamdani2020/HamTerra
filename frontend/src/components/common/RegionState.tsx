import { AlertTriangle, Inbox } from "lucide-react";
import type { ReactNode } from "react";

import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError, emptyText, REGION_TEXT } from "@/lib/messages";
import { cn } from "@/lib/utils";

export interface RegionErrorProps {
  error: unknown;
  onRetry?: (() => void) | undefined;
  /** True while the retried request is pending: the control is disabled (6.4). */
  retrying?: boolean;
  /** What failed, shown first, for example "The area list could not be loaded." */
  context?: string | undefined;
  className?: string;
}

/** The error state inside one region (Requirements 5.2, 6.3). Never shows `details`. */
export function RegionError({ error, onRetry, retrying = false, context, className }: RegionErrorProps): JSX.Element {
  const display = describeError(error);
  return (
    <div role="alert" className={cn("space-y-2 rounded-md border border-status-error bg-status-error-bg p-4 text-status-error", className)}>
      {context && <p className="font-medium text-foreground">{context}</p>}
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
        {display.title}
      </p>
      <p className="text-foreground">{display.body}</p>
      {display.requestId && (
        <p className="text-sm text-ink-muted">
          {REGION_TEXT.requestId}: <code>{display.requestId}</code>
        </p>
      )}
      {display.retry && onRetry && (
        <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={retrying} onClick={onRetry}>
          {retrying ? REGION_TEXT.retrying : REGION_TEXT.retry}
        </Button>
      )}
    </div>
  );
}

export interface EmptyStateProps {
  /** The missing item type, plural: "areas", "observations" (Requirement 6.2). */
  noun: string;
  /** A next action the user may take, such as "Refresh observations". */
  action?: ReactNode;
  message?: string;
}

export function EmptyState({ noun, action, message }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-6 text-center text-ink-muted">
      <Inbox aria-hidden="true" className="h-6 w-6" />
      <p>{message ?? emptyText(noun)}</p>
      {action}
    </div>
  );
}

export function RegionSkeleton({ rows = 3 }: { rows?: number }): JSX.Element {
  return (
    <div className="space-y-2" data-testid="region-skeleton">
      <span className="sr-only">{REGION_TEXT.loading}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  );
}

/** The parts of a TanStack Query result the region needs; combined results can supply it too. */
export interface QueryLike<T> {
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => unknown;
}

export interface RegionStateProps<T> {
  query: QueryLike<T>;
  /** Accessible name of the region. */
  label: string;
  isEmpty?: (data: T) => boolean;
  empty?: EmptyStateProps;
  skeleton?: ReactNode;
  /** Passed to `RegionError` to say what failed. */
  errorContext?: string;
  className?: string;
  children: (data: T) => ReactNode;
}

/**
 * Loading, error, empty and data states for one region (Requirement 6). The skeleton and
 * `aria-busy` render synchronously while the query is pending, so they appear in the same
 * frame as the request. A retry repeats the request once; while it runs the region is busy
 * and the control is disabled. Data already shown stays, marked possibly outdated (5.8).
 */
export function RegionState<T>({ query, label, isEmpty, empty, skeleton, errorContext, className, children }: RegionStateProps<T>): JSX.Element {
  const { data, error, isPending, isError, isFetching } = query;
  const retry = (): void => {
    void query.refetch();
  };
  const busy = isPending || (isError && isFetching);

  let content: ReactNode;
  if (data !== undefined) {
    content = (
      <>
        {isError && (
          <div className="mb-3 space-y-2">
            <StatusBadge tone="warning" label={REGION_TEXT.outdated} />
            <p className="text-sm text-ink-muted">{REGION_TEXT.outdatedBody}</p>
            <RegionError error={error} onRetry={retry} retrying={isFetching} context={errorContext} />
          </div>
        )}
        {isEmpty?.(data) ? <EmptyState {...(empty ?? { noun: "items" })} /> : children(data)}
      </>
    );
  } else if (isError) {
    content = <RegionError error={error} onRetry={retry} retrying={isFetching} context={errorContext} />;
  } else {
    content = skeleton ?? <RegionSkeleton />;
  }

  return (
    <section aria-label={label} aria-busy={busy} className={className}>
      {content}
    </section>
  );
}
