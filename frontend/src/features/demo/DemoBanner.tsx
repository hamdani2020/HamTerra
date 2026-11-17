import { FlaskConical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useDemo } from "@/core/demo/DemoContext";
import { formatDateTime } from "@/lib/format";
import { DEMO_TEXT, demoBannerText } from "@/lib/messages";

import { DEMO_SNAPSHOT } from "./demoApi";

/** Shown on every page of the demo: what the visitor sees, and the way out. */
export default function DemoBanner(): JSX.Element {
  const demo = useDemo();
  return (
    <section
      aria-label={DEMO_TEXT.bannerTitle}
      className="flex flex-col gap-3 border-b border-brand-600 bg-subtle px-4 py-3 text-sm text-brand-900 sm:flex-row sm:items-center sm:justify-between sm:px-6"
    >
      <p className="flex items-start gap-2">
        <FlaskConical aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>{DEMO_TEXT.bannerTitle}.</strong> {demoBannerText(formatDateTime(DEMO_SNAPSHOT.exported_at))} {DEMO_TEXT.readOnly}
        </span>
      </p>
      <Button type="button" variant="outline" className="h-11 shrink-0 sm:h-9" onClick={demo.exit}>
        {DEMO_TEXT.exit}
      </Button>
    </section>
  );
}
