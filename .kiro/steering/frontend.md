---
inclusion: fileMatch
fileMatchPattern: "frontend/**"
---

# Frontend Conventions

Frontend design: #[[file:.kiro/specs/eco-sentinel-frontend/design.md]]

- Consume the backend contract as defined in `.kiro/specs/eco-sentinel-backend/design.md` (API Contract). Do not invent endpoints or fields. Gaps go into the frontend design's Open Items, not into code.
- All backend calls go through `src/core/api/client.ts` (bearer token, Error_Envelope parsing, one renew-and-replay on 401, 30 s timeout, 130 s for refresh, limit clamping, host allow-list). Data fetching uses TanStack Query hooks in `src/features/*/hooks.ts` with keys from `keys.ts`.
- Display text for backend warning and error codes comes only from `src/lib/messages.ts`. Render backend `summary_text`, `limitations`, `caveats` and warning messages unchanged.
- Never compute quality levels, flags, warnings or NDVI differences in the browser. One sensor per chart. Cloud and data coverage are separate values.
- Comparisons send the earlier date as `date_a`.
- Design system: use the Tailwind tokens and CSS variables (Primary Emerald 700 `#047857`, Secondary Emerald 600 `#059669`, Dark accent `#064E3B`, Light accent `#D1FAE5`, Subtle bg `#F0FDF4`, Main bg `#F8FAFC`, Surface `#FFFFFF`, Text `#0F172A` / `#475569`, Border `#E2E8F0`) and shared components in `src/components`. Do not style pages with one-off colours. NDVI uses the viridis-like ramp in `ndviRamp.ts`, not emerald. Status always has a text label besides colour.
- Accessibility: WCAG 2.1 AA contrast, visible focus rings, keyboard operation, focus management in dialogs and on route change, reduced-motion support, `aria-busy` on loading regions.
- Every data region has loading, empty and error states. Layouts work from 320 px to 1920 px (mobile < 640, tablet 640-1023, desktop >= 1024).
- No new third-party hosts at run time other than the basemap tiles. No fonts or scripts from CDNs.
- Tests: Vitest + React Testing Library, MSW handlers built from the contract, fast-check properties tagged with their design property number, vitest-axe checks. MapLibre is mocked in tests.
