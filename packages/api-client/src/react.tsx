// React Query integration of the shared client (A-03 T009): `@trpc/tanstack-react-query`
// hooks typed by `AppRouter`, and one provider that owns the QueryClient and the tRPC client.
// Usage in a page: `const trpc = useTRPC(); useQuery(trpc.runs.summary.queryOptions(input))`.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useState, type ReactElement, type ReactNode } from "react";
import { createApiClient, type ApiClient, type AppRouter } from "./index";

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

/** Public, immutable-by-CID data: one retry, no refetch on focus, a minute of freshness. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000 },
    },
  });
}

export interface ApiProviderProps {
  readonly children: ReactNode;
  /** Injected for tests; defaults to `createApiClient()`. */
  readonly client?: ApiClient;
  /** Injected for tests; defaults to `createQueryClient()`. */
  readonly queryClient?: QueryClient;
}

export function ApiProvider({ children, client, queryClient }: ApiProviderProps): ReactElement {
  const [ownQueryClient] = useState(() => queryClient ?? createQueryClient());
  const [ownClient] = useState(() => client ?? createApiClient());
  return (
    <QueryClientProvider client={ownQueryClient}>
      <TRPCProvider trpcClient={ownClient} queryClient={ownQueryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
