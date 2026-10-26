// A-14 T033: the browser client of `agent.ask` posts the tRPC mutation to /api/agent/ask (the
// Amplify rewrite of the agent Lambda route) and validates what comes back.
import { describe, expect, it, vi } from "vitest";
import { AGENT_ASK_PATH, AgentAskError, askAgent } from "../src/data/agent-ask";

const ok = {
  answer: "x",
  how: "",
  steps: [],
  matches: [],
  query: {},
  missing: [],
  outcome: "answered",
};
const reply = (body: unknown, status = 200): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("askAgent", () => {
  it("posts the request as JSON to the agent route and returns the validated data", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => reply({ result: { data: ok } }));
    const signal = new AbortController().signal;
    const out = await askAgent(
      { prompt: "q", turns: [{ prompt: "a", outcome: "answered" }] },
      signal,
      fetchImpl,
    );
    expect(out.outcome).toBe("answered");
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(AGENT_ASK_PATH);
    expect(AGENT_ASK_PATH).toBe("/api/agent/ask");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      prompt: "q",
      turns: [{ prompt: "a", outcome: "answered" }],
    });
    expect(init?.signal).toBe(signal);
  });

  it("accepts an optional run echo and keeps it; a malformed run is refused", async () => {
    const run = { run_id: "r1", manifest_cid: "bafyx", as_of: "2026-10-21T10:35:16.000Z" };
    const good = vi.fn<typeof fetch>(() => reply({ result: { data: { ...ok, run } } }));
    const out = await askAgent({ prompt: "q" }, new AbortController().signal, good);
    expect(out.run).toEqual(run);
    const bad = vi.fn<typeof fetch>(() =>
      reply({ result: { data: { ...ok, run: { run_id: "r1" } } } }),
    );
    await expect(askAgent({ prompt: "q" }, new AbortController().signal, bad)).rejects.toThrow(
      AgentAskError,
    );
  });

  it("raises the server's message for a tRPC error body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => reply({ error: { message: "bad input" } }, 400));
    await expect(
      askAgent({ prompt: "q" }, new AbortController().signal, fetchImpl),
    ).rejects.toThrow("bad input");
  });

  it("refuses a body of an unexpected shape and a non-JSON body", async () => {
    const shape = vi.fn<typeof fetch>(() =>
      reply({ result: { data: { ...ok, outcome: "weird" } } }),
    );
    await expect(
      askAgent({ prompt: "q" }, new AbortController().signal, shape),
    ).rejects.toBeInstanceOf(AgentAskError);
    const text = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("<html>", { status: 502 })),
    );
    await expect(askAgent({ prompt: "q" }, new AbortController().signal, text)).rejects.toThrow(
      "HTTP 502",
    );
  });
});
