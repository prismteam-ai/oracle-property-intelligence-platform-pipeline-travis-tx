import { createClient, firstCallAlone, type ApiClient } from '@travis/api-client';
import { createContext, useContext, type ReactNode } from 'react';

/** `VITE_API_URL` is the execute-api `$default` URL; empty keeps requests same-origin (dev/preview proxy). */
export const API_URL: string = import.meta.env.VITE_API_URL ?? '';

/** The page's first call opens the API instance; the calls that start with it wait for it (decisions.md section 31). */
export const defaultClient: ApiClient = createClient({
  baseUrl: API_URL,
  fetch: firstCallAlone((...args: Parameters<typeof fetch>) => fetch(...args)),
});

const ApiContext = createContext<ApiClient>(defaultClient);

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export const useApi = (): ApiClient => useContext(ApiContext);

/** What the page shows as the MCP endpoint and in curl examples. */
export function apiOrigin(client: ApiClient): string {
  return client.baseUrl || (typeof location === 'undefined' ? '' : location.origin);
}
