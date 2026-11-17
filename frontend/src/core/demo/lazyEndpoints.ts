import type { Endpoints } from "@/core/api/endpoints";

/**
 * Endpoints whose implementation loads on first use, so the demo data stays out of the
 * entry chunk. Every endpoint function returns a promise, so each call can wait for it.
 */
export function lazyEndpoints(load: () => Promise<Endpoints>): Endpoints {
  let loaded: Promise<Endpoints> | null = null;
  return new Proxy({} as Endpoints, {
    get: (_target, key: string) =>
      (...args: unknown[]) =>
        (loaded ??= load()).then((api) => (api[key as keyof Endpoints] as (...a: unknown[]) => unknown)(...args)),
  });
}
