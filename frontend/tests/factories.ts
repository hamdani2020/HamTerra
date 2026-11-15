/**
 * Typed test-data builders. `builder(defaults)` returns a function that produces a fresh
 * copy of the defaults with optional overrides, so tests never share mutable fixtures.
 * Builders for the Backend contract types are added with `src/types/api.ts` (task 6).
 */
export type Builder<T> = (overrides?: Partial<T>) => T;

export function builder<T extends object>(defaults: () => T): Builder<T> {
  return (overrides = {}) => ({ ...defaults(), ...overrides });
}

let counter = 0;

/** A deterministic, unique UUID-shaped identifier for test data. */
export function testId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
}
