import type { Config } from "tailwindcss";

// Design tokens are added in task 4 (CSS variables in src/styles/globals.css).
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};

export default config;
