import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";

import { useApi } from "@/core/api/ApiProvider";
import { keys } from "@/core/api/keys";
import { ME_STALE_TIME } from "@/core/api/queryClient";
import { useAuthState } from "@/core/auth/AuthProvider";
import type { PrincipalMe } from "@/types/api";

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** `GET /me` is a trust boundary, so its shape is checked at run time (frontend design). */
export function isPrincipalMe(body: unknown): body is PrincipalMe {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.sub === "string" &&
    b.sub !== "" &&
    typeof b.username === "string" &&
    (b.email === null || typeof b.email === "string") &&
    isStringArray(b.roles) &&
    isStringArray(b.permissions)
  );
}

export class InvalidPrincipalError extends Error {
  constructor() {
    super("The account response was not in the expected format.");
    this.name = "InvalidPrincipalError";
  }
}

/**
 * The Principal, loaded once per Session and kept in the query cache in memory only
 * (Requirements 4.1, 4.2). The cache is cleared when the Session ends.
 */
export function usePrincipal(): UseQueryResult<PrincipalMe> {
  const api = useApi();
  const { status } = useAuthState();
  return useQuery({
    queryKey: keys.me(),
    queryFn: async ({ signal }) => {
      const body: unknown = await api.getMe({ signal });
      if (!isPrincipalMe(body)) throw new InvalidPrincipalError();
      return body;
    },
    staleTime: ME_STALE_TIME,
    enabled: status === "signed_in",
  });
}

const PrincipalContext = createContext<PrincipalMe | null>(null);

export function PrincipalProvider({ principal, children }: { principal: PrincipalMe; children: ReactNode }): JSX.Element {
  return <PrincipalContext.Provider value={principal}>{children}</PrincipalContext.Provider>;
}

/** The loaded Principal; only valid below `RequirePrincipal`. */
export function useCurrentPrincipal(): PrincipalMe {
  const principal = useContext(PrincipalContext);
  if (!principal) throw new Error("useCurrentPrincipal must be used below RequirePrincipal");
  return principal;
}

// Hot updates would re-create the Principal context while mounted components keep the old one,
// so a change to this module (or anything it imports) reloads the page in development.
// Vite 7 has no `decline`: the module accepts its own update and reloads instead.
import.meta.hot?.accept(() => window.location.reload());
