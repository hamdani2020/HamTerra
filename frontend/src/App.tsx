import type { PublicConfig } from "@/core/config";

export interface AppProps {
  config: PublicConfig;
}

/** Placeholder shell. Auth, routing and the app shell arrive in tasks 6 to 8. */
export function App(_props: AppProps): JSX.Element {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <h1 className="text-xl font-semibold">Eco-Sentinel Ghana</h1>
    </main>
  );
}
