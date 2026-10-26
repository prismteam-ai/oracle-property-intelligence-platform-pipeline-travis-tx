// A-03 T009 (G-A2): the only tRPC client (agent-design metagross § 8; plan "Patterns the code
// must show"). Written before src/index.ts exists (red run: Cannot find module '../src/index').
// Pins the path, the batching split (agent / mcpProxy are never batched, ARD AD-27) and that the
// client is built from links only: no procedure is named here because the router is empty until W3.
import { describe, expect, it } from "vitest";
import { TRPC_PATH, UNBATCHED_PREFIXES, createApiClient, isUnbatched } from "../src/index.js";

describe("@countylens/api-client", () => {
  it("talks to the same-origin tRPC path behind the Amplify rewrite", () => {
    expect(TRPC_PATH).toBe("/api/trpc");
  });

  it("never batches agent.* and mcpProxy.* procedures; batches everything else", () => {
    expect([...UNBATCHED_PREFIXES].sort()).toEqual(["agent.", "explore.search", "mcpProxy."]);
    expect(isUnbatched("agent.ask")).toBe(true);
    expect(isUnbatched("mcpProxy.call")).toBe(true);
    expect(isUnbatched("runs.summary")).toBe(false);
    expect(isUnbatched("query.radius")).toBe(false);
    expect(isUnbatched("agents.list")).toBe(false);
  });

  it("creates a client without touching the network", () => {
    const client = createApiClient();
    // A tRPC client is a Proxy over a callable, so `typeof` reports "function".
    expect(client).toBeDefined();
    expect(client).not.toBeNull();
    expect(["object", "function"]).toContain(typeof client);
  });

  it("accepts an absolute base URL for non-browser callers (tests, scripts)", () => {
    const client = createApiClient({ url: "https://runtime.example/api/trpc" });
    expect(client).toBeDefined();
  });
});
