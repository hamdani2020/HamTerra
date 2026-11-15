import { ArrowDown, LayoutDashboard } from "lucide-react";
import { lazy, Suspense, type ReactNode } from "react";
import { Link } from "react-router";

import { WarningBanner } from "@/components/common/WarningBanner";
import { SignInButton } from "@/features/auth/SignInButton";
import { AUTH_TEXT, REGION_TEXT } from "@/lib/messages";
import { ROUTES } from "@/lib/routes";

import { PITCH_SECTIONS, PITCH_TEXT } from "./content";
import { BrandMark, Graticule } from "./decor";
import { darkFocus, onDarkPrimary } from "./styles";

// Sections, data and imagery load as one lazy chunk, so the sign-in control renders at once.
const PitchSections = lazy(() => import("./PitchSections"));
const HeroVisual = lazy(() => import("./PitchSections").then((m) => ({ default: m.HeroVisual })));

/** What the call to action does: start sign-in, or open the app for a signed-in user. */
export type PitchAccess =
  | { kind: "sign_in"; returnTo?: string | undefined }
  | { kind: "restoring" }
  | { kind: "signed_in" };

export interface PitchLayoutProps {
  access: PitchAccess;
  /** The expired-session notice and similar, shown above the headline. */
  notice?: ReactNode;
}

function PrimaryAction({ access, label }: { access: PitchAccess; label: string }): JSX.Element {
  if (access.kind === "restoring") {
    return (
      <p role="status" aria-busy="true" className="text-brand-100">
        {AUTH_TEXT.restoring}
      </p>
    );
  }
  if (access.kind === "signed_in") {
    return (
      <Link to={ROUTES.dashboard} className={`inline-flex h-11 items-center gap-2 rounded-md px-5 text-sm font-semibold ${onDarkPrimary} ${darkFocus}`}>
        <LayoutDashboard aria-hidden="true" className="h-4 w-4" />
        {PITCH_TEXT.ctaDashboard}
      </Link>
    );
  }
  return <SignInButton label={label} returnTo={access.returnTo} className={`h-11 px-5 font-semibold ${onDarkPrimary} ${darkFocus}`} />;
}

/**
 * The public project page (`/` and `/about`): a pitch for visitors and judges, and the way
 * into the platform. The header and hero render eagerly; the evidence sections are lazy.
 */
export function PitchLayout({ access, notice }: PitchLayoutProps): JSX.Element {
  return (
    <div className="bg-landing min-h-screen text-foreground">
      <header className="sticky top-0 z-30 border-b border-brand-700 bg-brand-900 text-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="#top" className={`flex items-center gap-2 rounded-md font-semibold ${darkFocus}`}>
            <BrandMark className="h-7 w-7" />
            <span>{PITCH_TEXT.brand}</span>
          </a>
          <nav aria-label={PITCH_TEXT.navLabel} className="hidden lg:block">
            <ul className="flex items-center gap-1 text-sm">
              {PITCH_SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className={`rounded-md px-2.5 py-2 text-brand-100 hover:bg-brand-700 hover:text-surface ${darkFocus}`}>
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="w-auto shrink-0">
            {access.kind === "sign_in" && <SignInButton returnTo={access.returnTo} className={`h-9 w-auto px-4 ${onDarkPrimary} ${darkFocus}`} />}
            {access.kind === "signed_in" && (
              <Link to={ROUTES.dashboard} className={`inline-flex h-9 items-center rounded-md px-4 text-sm font-medium ${onDarkPrimary} ${darkFocus}`}>
                {PITCH_TEXT.ctaDashboard}
              </Link>
            )}
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="focus:outline-none">
        <section id="top" aria-labelledby="pitch-title" className="relative overflow-hidden bg-brand-900 text-surface">
          <Graticule className="pointer-events-none absolute inset-0 h-full w-full text-brand-600 opacity-30" />
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center">
            <div className="space-y-6">
              {notice}
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-brand-100">{PITCH_TEXT.eyebrow}</p>
              <h1 id="pitch-title" tabIndex={-1} className="text-4xl font-bold leading-tight tracking-tight focus:outline-none sm:text-5xl">
                {PITCH_TEXT.headline}
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-brand-100">{PITCH_TEXT.tagline}</p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="sm:w-auto">
                  <PrimaryAction access={access} label={PITCH_TEXT.ctaPlatform} />
                </div>
                <a
                  href="#evidence"
                  className={`inline-flex h-11 items-center justify-center gap-2 rounded-md border border-brand-100 px-5 text-sm font-semibold text-surface hover:bg-brand-700 ${darkFocus}`}
                >
                  {PITCH_TEXT.ctaEvidence}
                  <ArrowDown aria-hidden="true" className="h-4 w-4" />
                </a>
              </div>
              {access.kind === "sign_in" && <p className="text-sm text-brand-100">{PITCH_TEXT.accountNote}</p>}
            </div>
            <Suspense fallback={<div className="aspect-[3/2] w-full rounded-lg border border-brand-700" aria-hidden="true" />}>
              <HeroVisual />
            </Suspense>
          </div>
        </section>

        <Suspense fallback={<p className="mx-auto max-w-6xl px-4 py-10 text-ink-muted sm:px-6">{REGION_TEXT.loading}</p>}>
          <PitchSections access={access} />
        </Suspense>
      </main>
    </div>
  );
}

/** The expired-session notice for the hero. */
export function ExpiredNotice(): JSX.Element {
  return <WarningBanner title={AUTH_TEXT.sessionEndedTitle} messages={[AUTH_TEXT.sessionExpired]} />;
}
