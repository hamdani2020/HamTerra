import type { Parameters } from "fast-check";

/** Every property test runs at least 100 generated cases (frontend design, Testing Strategy). */
export const propertyConfig: Parameters<unknown> = { numRuns: 100 };
