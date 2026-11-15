export interface ConfigErrorPageProps {
  missing: string[];
  invalid: string[];
}

/**
 * Shown instead of the application when the public configuration is incomplete
 * (Requirements 2.2, 2.3). It names the variables only, never their values, and the
 * application does not start sign-in or send any request while it is shown.
 */
export function ConfigErrorPage({ missing, invalid }: ConfigErrorPageProps): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <section
        aria-labelledby="config-error-title"
        className="w-full max-w-xl rounded-lg border bg-card p-6 shadow"
      >
        <h1 id="config-error-title" className="text-xl font-semibold">
          The application is not configured
        </h1>
        <p className="mt-2 text-ink-muted">
          Sign-in is unavailable until the configuration below is corrected. Set the values in
          the environment file used to start the frontend, then reload this page.
        </p>
        {missing.length > 0 && (
          <div className="mt-4">
            <h2 className="font-medium">Missing or empty</h2>
            <ul className="mt-1 list-disc pl-6" aria-label="Missing or empty variables">
              {missing.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
        {invalid.length > 0 && (
          <div className="mt-4">
            <h2 className="font-medium">Not a valid absolute http or https URL</h2>
            <ul className="mt-1 list-disc pl-6" aria-label="Invalid variables">
              {invalid.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
