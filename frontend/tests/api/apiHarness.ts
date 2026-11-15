import { vi } from "vitest";

import { createApiClient, type AuthProvider } from "@/core/api/client";
import { createEndpoints } from "@/core/api/endpoints";
import { createHttpGuard } from "@/core/api/httpGuard";

import { buildPublicConfig } from "../factories";

export interface FakeAuth extends AuthProvider {
  token: string | null;
  renewResult: boolean;
  renewCalls: number;
  endCalls: number;
}

export function fakeAuth(token: string | null = "access-token-1"): FakeAuth {
  const auth: FakeAuth = {
    token,
    renewResult: true,
    renewCalls: 0,
    endCalls: 0,
    getAccessToken: vi.fn(async () => auth.token),
    renew: vi.fn(async () => {
      auth.renewCalls += 1;
      if (auth.renewResult) auth.token = `renewed-${auth.renewCalls}`;
      return auth.renewResult;
    }),
    endSession: vi.fn(() => {
      auth.endCalls += 1;
    }),
  };
  return auth;
}

export function makeApi(auth: FakeAuth = fakeAuth()) {
  const guard = createHttpGuard(buildPublicConfig());
  const client = createApiClient(guard, auth);
  return { api: createEndpoints(client), client, guard, auth };
}
