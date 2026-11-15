import { Menu } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth, useAuthState } from "@/core/auth/AuthProvider";
import { useCurrentPrincipal } from "@/core/auth/principal";
import { AUTH_TEXT, SHELL_TEXT } from "@/lib/messages";
import { displayEmail, type NavItem } from "@/lib/navigation";

import { SidebarNav } from "./Sidebar";

/** Username, email when known (4.6, 4.7), sign-out, and the drawer menu below 640 px (1.3). */
export function Header({ items }: { items: readonly NavItem[] }): JSX.Element {
  const auth = useAuth();
  const { idEmail } = useAuthState();
  const principal = useCurrentPrincipal();
  const email = displayEmail(principal.email, idEmail);
  const [open, setOpen] = useState(false);

  return (
    <header className="flex items-center gap-3 border-b bg-card px-4 py-2 sm:px-6">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button type="button" variant="ghost" className="h-11 w-11 p-0 sm:hidden" aria-label={SHELL_TEXT.openMenu}>
            <Menu aria-hidden="true" className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 overflow-y-auto">
          <SheetTitle className="mb-4 text-base">{AUTH_TEXT.appName}</SheetTitle>
          <SheetDescription className="sr-only">{SHELL_TEXT.navTitle}</SheetDescription>
          <SidebarNav items={items} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <p className="truncate font-semibold text-foreground sm:hidden">{AUTH_TEXT.appName}</p>
      <div className="ml-auto flex min-w-0 items-center gap-3">
        <div className="min-w-0 text-right text-sm">
          <p className="truncate font-medium text-foreground" data-testid="principal-username">
            {principal.username}
          </p>
          {email && (
            <p className="hidden truncate text-ink-muted sm:block" data-testid="principal-email">
              {email}
            </p>
          )}
        </div>
        <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => auth.signOut()}>
          {SHELL_TEXT.signOut}
        </Button>
      </div>
    </header>
  );
}
