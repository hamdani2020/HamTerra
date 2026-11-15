import { EvidenceNote } from "@/components/common/EvidenceNote";
import { EmptyState, RegionState } from "@/components/common/RegionState";
import { AreaCard } from "@/features/dashboard/AreaCard";
import { DASHBOARD_AREA_LIMIT, useDashboardAreas, useDashboardLimiter } from "@/features/dashboard/hooks";
import { RecentObservations } from "@/features/dashboard/RecentObservations";
import { formatInteger } from "@/lib/format";
import { DASHBOARD_TEXT, EVIDENCE_TEXT } from "@/lib/messages";
import { PAGE_TITLE } from "@/lib/pageTitles";

/**
 * The researcher dashboard (Requirement 7). Per-area calls start only after the area list
 * has loaded, and all of them share one limiter of 6 concurrent requests.
 */
export default function DashboardPage(): JSX.Element {
  const areas = useDashboardAreas();
  const limiter = useDashboardLimiter();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
          {PAGE_TITLE.dashboard}
        </h1>
        {/* Requirement 7.9 and 20.3: shown at the top of the page. */}
        <EvidenceNote kind="aggregate" />
        <p className="text-sm text-ink-muted">{EVIDENCE_TEXT.investigationNote}</p>
      </header>

      <RegionState
        query={areas}
        label={DASHBOARD_TEXT.areaCards}
        errorContext={DASHBOARD_TEXT.listErrorTitle}
      >
        {(page) => (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-foreground">{DASHBOARD_TEXT.areaCards}</h2>
            <p className="text-foreground">
              {DASHBOARD_TEXT.activeAreas}:{" "}
              <span className="font-semibold tabular-nums" data-testid="active-area-count">
                {formatInteger(page.total)}
              </span>
            </p>
            {/* Zero areas: the count stays visible as 0 and nothing else is requested (7.12). */}
            {page.total === 0 && <EmptyState noun="active areas" message={DASHBOARD_TEXT.noActiveAreas} />}
            {page.total > DASHBOARD_AREA_LIMIT && <p className="text-sm text-ink-muted">{DASHBOARD_TEXT.showingFirst}</p>}
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {page.items.slice(0, DASHBOARD_AREA_LIMIT).map((area) => (
                <li key={area.id} className="min-w-0">
                  <AreaCard area={area} limiter={limiter} />
                </li>
              ))}
            </ul>
            {page.total > 0 && <RecentObservations areas={page.items} limiter={limiter} />}
          </div>
        )}
      </RegionState>
    </div>
  );
}
