import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Environment checks, file-watch polling and HMR settings are added by the Docker task (2.1).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@tests": fileURLToPath(new URL("./tests", import.meta.url)),
    },
  },
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // No real network: MSW rejects unmocked requests (tests/setup.ts).
    restoreMocks: true,
  },
});
