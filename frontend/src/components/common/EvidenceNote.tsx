import { VerbatimText } from "@/components/common/VerbatimText";
import { EVIDENCE_TEXT } from "@/lib/messages";
import { cn } from "@/lib/utils";

export type EvidenceNoteProps =
  | { kind: "aggregate"; className?: string }
  | { kind: "weather"; note: string; className?: string };

/**
 * Standard evidence statements: the polygon-level aggregate note on every screen with NDVI,
 * and the Backend weather note, shown unchanged, on every screen with weather.
 */
export function EvidenceNote(props: EvidenceNoteProps): JSX.Element {
  const text = props.kind === "aggregate" ? EVIDENCE_TEXT.aggregateNote : props.note;
  return (
    // role="note", not <aside>: a complementary landmark inside <main> breaks the landmark rules.
    <div role="note" className={cn("text-sm text-ink-muted", props.className)}>
      <VerbatimText text={text} />
    </div>
  );
}
