import { SHELL_TEXT } from "@/lib/messages";

/** Stand-in content for a route whose feature arrives in a later task. */
export function PlaceholderPage({ title }: { title: string }): JSX.Element {
  return (
    <section className="space-y-2">
      <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
        {title}
      </h1>
      <p className="text-ink-muted">{SHELL_TEXT.placeholder}</p>
    </section>
  );
}
