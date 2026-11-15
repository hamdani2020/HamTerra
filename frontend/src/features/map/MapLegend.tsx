import { Legend } from "@/components/common/Legend";
import { EVIDENCE_TEXT, MAP_TEXT, opacityText } from "@/lib/messages";
import { TOKENS } from "@/styles/tokens";

/** Outline colours, plus the overlay notes while a preview is shown (Requirement 8.11). */
export function MapLegend({ overlayOpacity }: { overlayOpacity: number | null }): JSX.Element {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3 shadow">
      <Legend
        title={MAP_TEXT.legendTitle}
        items={[
          { label: MAP_TEXT.legendDefault, color: TOKENS["emerald-700"], shape: "line" },
          { label: MAP_TEXT.legendSelected, color: TOKENS["emerald-900"], shape: "line" },
        ]}
      />
      {overlayOpacity !== null && (
        <div className="text-sm text-ink-muted" data-testid="legend-overlay">
          <p>{EVIDENCE_TEXT.previewOrientation}</p>
          <p>{opacityText(overlayOpacity)}</p>
        </div>
      )}
    </div>
  );
}
