import { createContext, type ReactNode, useContext, useEffect, useSyncExternalStore } from "react";

import type { AuthModule, AuthState } from "@/core/auth/authModule";

const AuthContext = createContext<AuthModule | null>(null);

export interface AuthProviderProps {
  auth: AuthModule;
  children: ReactNode;
}

/**
 * Makes the Auth_Module available to the tree and restores a Session from the stored
 * refresh token once on start (frontend design, Application Start Sequence). `restore`
 * shares the single in-flight renewal, so a second run under strict mode sends nothing new.
 */
export function AuthProvider({ auth, children }: AuthProviderProps): JSX.Element {
  useEffect(() => {
    void auth.restore();
  }, [auth]);
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthModule {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside AuthProvider");
  return auth;
}

/** The current Session state; re-renders on every Auth_Module change. */
export function useAuthState(): AuthState {
  const auth = useAuth();
  return useSyncExternalStore(auth.subscribe, auth.getState, auth.getState);
}
