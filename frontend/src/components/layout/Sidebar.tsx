import { NavLink } from "react-router";

import { SHELL_TEXT } from "@/lib/messages";
import type { NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export interface SidebarNavProps {
  items: readonly NavItem[];
  /** Called after a link is chosen, so the mobile drawer can close. */
  onNavigate?: () => void;
}

function itemClass({ isActive }: { isActive: boolean }): string {
  return cn(
    "flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-9",
    isActive ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent hover:text-accent-foreground",
  );
}

function ItemList({ items, onNavigate }: SidebarNavProps): JSX.Element {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.to}>
          {/* NavLink sets aria-current="page" on the active item only (Requirement 1.9). */}
          <NavLink to={item.to} end={item.end ?? false} className={itemClass} onClick={onNavigate}>
            {item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

/** The navigation list used by the persistent sidebar and the mobile drawer. */
export function SidebarNav({ items, onNavigate }: SidebarNavProps): JSX.Element {
  const researcher = items.filter((item) => item.group === "researcher");
  const admin = items.filter((item) => item.group === "admin");
  return (
    <nav aria-label={SHELL_TEXT.navLabel} className="space-y-6">
      <ItemList items={researcher} {...(onNavigate ? { onNavigate } : {})} />
      {admin.length > 0 && (
        <div>
          <h2 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{SHELL_TEXT.adminGroup}</h2>
          <ItemList items={admin} {...(onNavigate ? { onNavigate } : {})} />
        </div>
      )}
    </nav>
  );
}
