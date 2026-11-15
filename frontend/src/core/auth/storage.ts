/**
 * Auth values in `sessionStorage` (Requirements 3.1, 3.6). Nothing auth-related is ever
 * written to `localStorage`. The access token and ID token stay in memory.
 */
export const STORAGE_KEYS = {
  verifier: "eco.pkce.verifier",
  state: "eco.pkce.state",
  returnTo: "eco.pkce.returnTo",
  refreshToken: "eco.rt",
} as const;

export interface AuthStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** Remove every `eco.*` key. */
  clearAll(): void;
}

export function sessionAuthStorage(storage: Storage = window.sessionStorage): AuthStorage {
  return {
    get: (key) => storage.getItem(key),
    set: (key, value) => storage.setItem(key, value),
    remove: (key) => storage.removeItem(key),
    clearAll: () => {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key?.startsWith("eco.")) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
    },
  };
}

export function clearPkce(storage: AuthStorage): void {
  storage.remove(STORAGE_KEYS.verifier);
  storage.remove(STORAGE_KEYS.state);
  storage.remove(STORAGE_KEYS.returnTo);
}
