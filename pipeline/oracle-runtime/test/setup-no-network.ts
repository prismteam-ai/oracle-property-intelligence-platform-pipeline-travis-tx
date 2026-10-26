// Unit tests never touch the network: a test that forgets to inject its fetch fails here
// instead of reaching a real host (constitution: no requests to sources from tests).
import { beforeAll } from "vitest";

beforeAll(() => {
  globalThis.fetch = (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.reject(new Error(`unit tests may not use the network (${new URL(url).host})`));
  };
});
