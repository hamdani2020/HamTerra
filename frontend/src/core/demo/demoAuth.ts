import type { AuthModule, AuthState } from "@/core/auth/authModule";

const STATE: AuthState = { status: "signed_in", idEmail: null, endReason: null };

/**
 * A demo Session: always signed in, with no token and no Cognito call. Signing out (or a
 * Session end) leaves the demo through `onExit`.
 */
export function createDemoAuth(onExit: () => void): AuthModule {
  return {
    getState: () => STATE,
    subscribe: () => () => undefined,
    signIn: async () => onExit(),
    handleCallback: async () => ({ ok: false, error: "state_mismatch" }),
    restore: async () => undefined,
    signOut: onExit,
    getAccessToken: async () => null,
    renew: async () => false,
    endSession: onExit,
  };
}
