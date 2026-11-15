import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { createContext, type ReactElement, type ReactNode, useContext } from "react";
import { MemoryRouter } from "react-router-dom";

/**
 * Stand-in for the signed-in session used by component tests. The real Auth_Module
 * (task 7) is wired into this helper once it exists; until then components under test
 * read this stub through `useTestAuth`.
 */
export interface AuthStub {
  signedIn: boolean;
  sub: string;
  roles: string[];
}

const defaultAuth: AuthStub = { signedIn: true, sub: "test-user", roles: ["researcher"] };
const AuthStubContext = createContext<AuthStub>(defaultAuth);

export function useTestAuth(): AuthStub {
  return useContext(AuthStubContext);
}

/** A QueryClient for tests: no retries, no caching between tests. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface ProviderOptions extends Omit<RenderOptions, "wrapper"> {
  route?: string;
  queryClient?: QueryClient;
  auth?: Partial<AuthStub>;
}

export function renderWithProviders(
  ui: ReactElement,
  { route = "/", queryClient = createTestQueryClient(), auth = {}, ...options }: ProviderOptions = {},
): RenderResult & { queryClient: QueryClient } {
  const value: AuthStub = { ...defaultAuth, ...auth };
  function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthStubContext.Provider value={value}>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </AuthStubContext.Provider>
      </QueryClientProvider>
    );
  }
  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient };
}
