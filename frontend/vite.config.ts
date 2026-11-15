import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

import { assertRequiredEnv } from "./config/requiredEnv";

// Compose passes every VITE_ variable, set or not, so an unset one arrives as "". Vite lets
// process variables override .env files, so treat an empty value as absent; otherwise it
// would hide a value from frontend/.env.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("VITE_") && (process.env[key] ?? "").trim() === "") {
    Reflect.deleteProperty(process.env, key);
  }
}

export default defineConfig(({ mode }) => {
  // loadEnv reads frontend/.env* files and the process environment (Compose), VITE_ only.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  if (mode !== "test") assertRequiredEnv(env);
  const polling =
    process.env.VITE_USE_POLLING === "true" || process.env.CHOKIDAR_USEPOLLING === "true";
  // chokidar reads CHOKIDAR_USEPOLLING itself and lets it override `usePolling`. Compose always
  // passes it ("false" by default), which would switch polling off even when VITE_USE_POLLING
  // asks for it, so the decision above is the only one that counts.
  Reflect.deleteProperty(process.env, "CHOKIDAR_USEPOLLING");

  return {
    plugins: [react()],
    // MapLibre starts its worker as a module worker, so worker entries are built as ES modules.
    worker: { format: "es" },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@tests": fileURLToPath(new URL("./tests", import.meta.url)),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      // Bind mounts on some hosts do not deliver file events; polling makes reload work.
      watch: { usePolling: polling },
      // The browser connects to the host-published port, which may differ from 5173.
      hmr: { clientPort: Number(process.env.FRONTEND_PORT ?? 5173) },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["tests/setup.ts"],
      include: ["tests/**/*.test.{ts,tsx}"],
      // No real network: MSW rejects unmocked requests (tests/setup.ts).
      restoreMocks: true,
      // Headroom for shared CI runners, where the first lazy route import is slow.
      testTimeout: 15_000,
    },
  };
});
