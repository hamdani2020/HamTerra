import { Maximize, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MAP_TEXT } from "@/lib/messages";

import type { MapController } from "./useMap";

/** Our own buttons, so they are in the tab order and 44 px on mobile (Requirement 8.10). */
export function MapControls({ controller }: { controller: MapController | null }): JSX.Element {
  const disabled = controller === null;
  const button = "h-11 w-11 p-0 shadow sm:h-9 sm:w-9";
  return (
    <div role="group" aria-label={MAP_TEXT.controls} className="absolute left-3 top-3 z-10 flex flex-col gap-2">
      <Button type="button" variant="outline" className={button} disabled={disabled} aria-label={MAP_TEXT.zoomIn} onClick={() => controller?.zoomIn()}>
        <Plus aria-hidden="true" className="h-4 w-4" />
      </Button>
      <Button type="button" variant="outline" className={button} disabled={disabled} aria-label={MAP_TEXT.zoomOut} onClick={() => controller?.zoomOut()}>
        <Minus aria-hidden="true" className="h-4 w-4" />
      </Button>
      <Button type="button" variant="outline" className={button} disabled={disabled} aria-label={MAP_TEXT.reset} onClick={() => controller?.fitToGhana()}>
        <Maximize aria-hidden="true" className="h-4 w-4" />
      </Button>
    </div>
  );
}
