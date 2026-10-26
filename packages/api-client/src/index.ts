// The only tRPC client of the workspace (A-03 T009; agent-design metagross § 8; plan "Patterns
// the code must show"). `AppRouter` is imported type-only from @countylens/api, so no server
// code reaches a browser bundle. Requests go same-origin to `/api/trpc`, which the Amplify
// rewrite forwards to the HTTP API (T043); `splitLink` batches every procedure except the
// agent and MCP-proxy families, whose calls are long-lived and must never share a batch
// (ARD AD-27; A-14). Apps import this package; none builds its own client.
import {
  createTRPCClient,
  httpBatchLink,
  httpLink,
  splitLink,
  type HTTPHeaders,
  type TRPCClient,
} from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@countylens/api";

export type { AppRouter };
export type ApiInputs = inferRouterInputs<AppRouter>;
export type ApiOutputs = inferRouterOutputs<AppRouter>;
export type ApiClient = TRPCClient<AppRouter>;

/** Same-origin tRPC path (Amplify rewrite `/api/<*>` → the HTTP API). */
export const TRPC_PATH = "/api/trpc";

/** Procedure families that are never batched: one HTTP request per call. */
export const UNBATCHED_PREFIXES: readonly string[] = ["agent.", "mcpProxy.", "explore.search"];

export function isUnbatched(path: string): boolean {
  return UNBATCHED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** tRPC's own fetch type (`FetchEsque`), taken from the link options so the two never drift. */
export type ApiFetch = NonNullable<Parameters<typeof httpLink>[0]["fetch"]>;

export interface ApiClientOptions {
  /** Absolute or root-relative tRPC URL; defaults to TRPC_PATH (the browser's own origin). */
  readonly url?: string;
  /** Injected for tests and non-browser callers; defaults to the global fetch. */
  readonly fetch?: ApiFetch;
  /** Extra request headers (none in A-03: the API is public and read-only, FR-013). */
  readonly headers?: HTTPHeaders | (() => HTTPHeaders | Promise<HTTPHeaders>);
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const linkOptions = {
    url: options.url ?? TRPC_PATH,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  };
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (operation) => isUnbatched(operation.path),
        true: httpLink(linkOptions),
        false: httpBatchLink(linkOptions),
      }),
    ],
  });
}
