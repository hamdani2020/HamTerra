import { Menu } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth, useAuthState } from "@/core/auth/AuthProvider";
import { useCurrentPrincipal } from "@/core/auth/principal";
import { useDemo } from "@/core/demo/DemoContext";
import { AUTH_TEXT, DEMO_TEXT, SHELL_TEXT } from "@/lib/messages";
import { displayEmail, type NavItem } from "@/lib/navigation";

import { SidebarNav } from "./Sidebar";

/**
 * The signed-in user, sign-out, and the drawer menu below 640 px (1.3). The email is shown
 * when known (4.6); the username only when it is not (4.7). With email sign-in, the Cognito
 * username is an opaque ID, so it is not shown next to the email.
 */
export function Header({ items }: { items: readonly NavItem[] }): JSX.Element {
  const auth = useAuth();
  const { idEmail } = useAuthState();
  const principal = useCurrentPrincipal();
  const email = displayEmail(principal.email, idEmail);
  const demo = useDemo();
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
          {email ? (
            <p className="truncate font-medium text-foreground" data-testid="principal-email">
              {email}
            </p>
          ) : (
            <p className="truncate font-medium text-foreground" data-testid="principal-username">
              {principal.username}
            </p>
          )}
        </div>
        <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => auth.signOut()}>
          {demo.active ? DEMO_TEXT.exit : SHELL_TEXT.signOut}
        </Button>
      </div>
    </header>
  );
}
