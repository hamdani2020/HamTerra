import { StrictMode } from "react";
import type { Root } from "react-dom/client";

import { App } from "@/App";
import { loadConfig } from "@/core/config";
import { ConfigErrorPage } from "@/pages/ConfigErrorPage";

/**
 * Validate the configuration, then render either the configuration error page or the
 * application. With an invalid configuration nothing else is created: no Auth_Module,
 * no query client and no request (Requirements 2.2, 2.3).
 */
export function bootstrap(root: Root, env: Record<string, unknown>): void {
  const result = loadConfig(env);
  if (!result.ok) {
    root.render(
      <StrictMode>
        <ConfigErrorPage missing={result.missing} invalid={result.invalid} />
      </StrictMode>,
    );
    return;
  }
  root.render(
    <StrictMode>
      <App config={result.config} />
    </StrictMode>,
  );
}
