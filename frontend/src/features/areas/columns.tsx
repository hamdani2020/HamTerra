import { Link } from "react-router";

import type { Column } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { formatDate, formatHectares } from "@/lib/format";
import { AREA_TEXT } from "@/lib/messages";
import { routeTo } from "@/lib/routes";
import type { Area } from "@/types/api";

const linkClass =
  "inline-flex min-h-11 items-center rounded-md font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-0";

export function AreaStatusBadge({ status }: { status: Area["status"] }): JSX.Element {
  return <StatusBadge tone={status === "active" ? "success" : "neutral"} label={status === "active" ? AREA_TEXT.statusActive : AREA_TEXT.statusArchived} />;
}

/** The area table columns shared by the area list and the admin area page (12.1, 14.1). */
export const AREA_COLUMNS: Column<Area>[] = [
  {
    id: "name",
    header: AREA_TEXT.name,
    cell: (a) => (
      <Link className={linkClass} to={routeTo.area(a.id)}>
        {a.name}
      </Link>
    ),
  },
  { id: "size", header: AREA_TEXT.size, cell: (a) => formatHectares(a.area_ha), align: "right" },
  {
    id: "status",
    header: AREA_TEXT.status,
    cell: (a) => <AreaStatusBadge status={a.status} />,
  },
  { id: "latest", header: AREA_TEXT.latest, cell: (a) => (a.latest_observation_date ? formatDate(a.latest_observation_date) : AREA_TEXT.noObservations) },
  {
    id: "details",
    header: AREA_TEXT.details,
    cell: (a) => (
      <Link className={linkClass} to={routeTo.area(a.id)} aria-label={`${AREA_TEXT.details}: ${a.name}`}>
        {AREA_TEXT.details}
      </Link>
    ),
  },
];

