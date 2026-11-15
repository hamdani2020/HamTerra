import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface AuthCardProps {
  title: string;
  children: ReactNode;
  className?: string;
}

/** The card used by the sign-in landing, callback, signed-out and auth error pages. */
export function AuthCard({ title, children, className }: AuthCardProps): JSX.Element {
  return (
    <main id="main-content" tabIndex={-1} className="bg-landing flex min-h-screen items-center justify-center p-4">
      <section
        aria-labelledby="auth-card-title"
        className={cn("w-full max-w-md rounded-lg border bg-card p-6 shadow", className)}
      >
        <h1 id="auth-card-title" tabIndex={-1} className="text-xl font-semibold text-foreground">
          {title}
        </h1>
        <div className="mt-4 space-y-4 text-ink-muted">{children}</div>
      </section>
    </main>
  );
}
