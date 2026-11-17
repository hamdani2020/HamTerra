/**
 * The sign-in-free demo. A flag in `sessionStorage` marks the tab as a demo; on load,
 * `createAppServices` then builds a demo Auth_Module and demo endpoints instead of the real
 * ones, so the researcher pages run unchanged on a saved snapshot and never call the Backend.
 * Entering and leaving reload the page, because the services are built once per page load.
 */
import { STORAGE_KEYS, type AuthStorage } from "@/core/auth/storage";
import { ROUTES } from "@/lib/routes";

type Navigate = (url: string) => void;
const assign: Navigate = (url) => window.location.assign(url);

export function isDemoSession(storage: AuthStorage): boolean {
  return storage.get(STORAGE_KEYS.demo) === "1";
}

export function startDemo(storage: AuthStorage, navigate: Navigate = assign): void {
  storage.set(STORAGE_KEYS.demo, "1");
  navigate(ROUTES.dashboard);
}

export function exitDemo(storage: AuthStorage, navigate: Navigate = assign): void {
  storage.remove(STORAGE_KEYS.demo);
  navigate(ROUTES.landing);
}
