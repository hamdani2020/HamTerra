import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const token = (name: string): string => `rgb(var(--${name}) / <alpha-value>)`;
const cardShadow = "var(--shadow-card)";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    // One shadow level everywhere (Requirement 21.2), whatever size a component asks for.
    boxShadow: {
      DEFAULT: cardShadow,
      sm: cardShadow,
      md: cardShadow,
      lg: cardShadow,
      xl: cardShadow,
      "2xl": cardShadow,
      none: "none",
    },
    // No animation or transition longer than 200 ms (Requirement 21.10).
    transitionDuration: {
      DEFAULT: "150ms",
      0: "0ms",
      75: "75ms",
      100: "100ms",
      150: "150ms",
      200: "200ms",
    },
    fontFamily: {
      sans: [
        "ui-sans-serif",
        "system-ui",
        "-apple-system",
        '"Segoe UI"',
        "Roboto",
        '"Helvetica Neue"',
        "Arial",
        "sans-serif",
      ],
      mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
    },
    extend: {
      colors: {
        // Semantic names used by shadcn/ui, mapped onto the design tokens.
        background: token("slate-50"),
        foreground: token("slate-900"),
        card: { DEFAULT: token("surface"), foreground: token("slate-900") },
        popover: { DEFAULT: token("surface"), foreground: token("slate-900") },
        primary: { DEFAULT: token("emerald-700"), foreground: token("surface") },
        secondary: { DEFAULT: token("emerald-100"), foreground: token("emerald-900") },
        muted: { DEFAULT: token("slate-50"), foreground: token("slate-600") },
        accent: { DEFAULT: token("emerald-100"), foreground: token("emerald-900") },
        destructive: { DEFAULT: token("status-error"), foreground: token("surface") },
        border: token("slate-200"),
        input: token("slate-500"),
        ring: token("focus-ring"),
        // Design token names.
        brand: {
          700: token("emerald-700"),
          600: token("emerald-600"),
          900: token("emerald-900"),
          100: token("emerald-100"),
        },
        subtle: token("green-50"),
        surface: token("surface"),
        ink: { DEFAULT: token("slate-900"), muted: token("slate-600") },
        line: token("slate-200"),
        status: {
          success: token("status-success"),
          "success-bg": token("status-success-bg"),
          warning: token("status-warning"),
          "warning-bg": token("status-warning-bg"),
          error: token("status-error"),
          "error-bg": token("status-error-bg"),
          info: token("status-info"),
          "info-bg": token("status-info-bg"),
        },
      },
      borderRadius: { lg: "0.5rem", md: "0.375rem", sm: "0.25rem" },
    },
  },
  plugins: [animate],
};

export default config;
