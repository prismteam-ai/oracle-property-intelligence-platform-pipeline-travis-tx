import type { ToolResult } from "@travis-oracle/query-core";
import { describe, expect, it } from "vitest";
import {
  type AgentBackend,
  type AgentEvent,
  type AgentReply,
  askAgent,
  type ChatMessage,
} from "../../src/agent/agent-loop.js";

const DATASET = {
  buildId: "20261027T193500Z",
  manifestCid: "bafkrei-manifest",
  rootCid: "bafybei-root",
};

function reply(message: AgentReply["message"], neurons = 10): AgentReply {
  return { message, neurons, cached: false, budget: { used: neurons, limit: 4_500 }, model: "m" };
}

function scriptedBackend(replies: AgentReply[]) {
  const seen: ChatMessage[][] = [];
  const backend: AgentBackend = {
    next: async (messages) => {
      seen.push(structuredClone(messages));
      const next = replies.shift();
      if (!next) throw new Error("no more replies");
      return next;
    },
  };
  return { seen, backend };
}

function lastContent(messages: ChatMessage[] | undefined): string {
  const last = messages?.at(-1);
  return last && typeof last.content === "string" ? last.content : "";
}

const agedRoofs = (rows: number): ToolResult => ({
  tool: "find_aged_roofs",
  rows: Array.from({ length: rows }, (_, index) => ({
    prop_id: index + 1,
    situs_address: `${index + 1} MAIN ST`,
    roof_age_years: 30,
    roof_age_anchor: "year_built",
    owner_name: null,
    latitude: 30.4,
    longitude: -97.6,
    source: "tcad-appraisal-export",
    source_run_id: "20261027T100000Z",
  })),
  totalMatches: 1_204,
  summary: { high_confidence: 40, medium_confidence: 300, low_confidence: 864 },
  center: { name: "Pflugerville", latitude: 30.45, longitude: -97.6 },
  sql: "SELECT ...",
  dataset: DATASET,
});

const CALL = {
  id: "call-1",
  type: "function" as const,
  function: { name: "find_aged_roofs", arguments: '{"place":"Pflugerville","radius_miles":5}' },
};

describe("askAgent", () => {
  it("runs the tools the model asks for and returns its answer with the evidence", async () => {
    const { seen, backend } = scriptedBackend([
      reply({ content: "", tool_calls: [CALL] }),
      reply({ content: "1,204 properties match.", tool_calls: [] }, 7),
    ]);
    const calls: { name: string; input: unknown }[] = [];
    const events: AgentEvent[] = [];

    const result = await askAgent("Aged roofs near Pflugerville?", [], {
      backend,
      tools: {
        run: async (name, input) => {
          calls.push({ name, input });
          return agedRoofs(12);
        },
      },
      onEvent: (event) => events.push(event),
    });

    expect(calls).toEqual([
      { name: "find_aged_roofs", input: { place: "Pflugerville", radius_miles: 5 } },
    ]);
    expect(result.answer).toBe("1,204 properties match.");
    expect(result.neurons).toBe(17);
    expect(result.evidence.map((item) => item.tool)).toEqual(["find_aged_roofs"]);
    expect(events.map((event) => event.kind)).toEqual(["tool_call", "tool_result", "answer"]);

    const toolMessage = seen[1]?.at(-1);
    expect(toolMessage).toMatchObject({ role: "tool", tool_call_id: "call-1" });
    const forModel = JSON.parse((toolMessage as { content: string }).content);
    expect(forModel).toMatchObject({ totalMatches: 1_204, center: { name: "Pflugerville" } });
    expect(forModel.rows).toHaveLength(10);
    expect(forModel.rows[0]).toEqual({
      prop_id: 1,
      situs_address: "1 MAIN ST",
      roof_age_years: 30,
      roof_age_anchor: "year_built",
      owner_name: null,
      source: "tcad-appraisal-export",
    });
    expect(forModel.summary).toEqual({
      high_confidence: 40,
      medium_confidence: 300,
      low_confidence: 864,
    });
    expect(forModel.note).toMatch(/2 more rows/);
    expect(forModel.dataset).toEqual({ manifestCid: "bafkrei-manifest", rootCid: "bafybei-root" });
  });

  it("keeps the conversation so a follow-up can refer to the earlier search", async () => {
    const { seen, backend } = scriptedBackend([
      reply({ content: "Earlier answer.", tool_calls: [] }),
      reply({ content: "Follow-up answer.", tool_calls: [] }),
    ]);
    const deps = { backend, tools: { run: async () => agedRoofs(0) }, onEvent: () => {} };

    const first = await askAgent("Aged roofs near Lakeway?", [], deps);
    await askAgent("Open permits near that area?", first.messages, deps);

    expect(seen[1]?.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
  });

  it("sends only recent whole turns so long conversations stay within the server's limit", async () => {
    const { seen, backend } = scriptedBackend([
      reply({ content: "Latest answer.", tool_calls: [] }),
    ]);
    const longHistory: ChatMessage[] = Array.from({ length: 30 }, (_, turn) => [
      { role: "user" as const, content: `question ${turn}` },
      { role: "assistant" as const, content: "", tool_calls: [CALL] },
      { role: "tool" as const, tool_call_id: "call-1", content: "{}" },
      { role: "assistant" as const, content: `answer ${turn}` },
    ]).flat();

    await askAgent("newest question", longHistory, {
      backend,
      tools: { run: async () => agedRoofs(0) },
      onEvent: () => {},
    });

    const sent = seen[0] ?? [];
    expect(sent.length).toBeLessThanOrEqual(17);
    expect(sent[0]).toMatchObject({ role: "user" });
    expect(sent.at(-1)).toEqual({ role: "user", content: "newest question" });
    expect(sent.at(-2)).toEqual({ role: "assistant", content: "answer 29" });
  });

  it("tells the model when a tool fails so it can correct itself", async () => {
    const { seen, backend } = scriptedBackend([
      reply({
        content: "",
        tool_calls: [{ ...CALL, function: { name: "find_aged_roofs", arguments: "{bad" } }],
      }),
      reply({ content: "", tool_calls: [CALL] }),
      reply({ content: "Done.", tool_calls: [] }),
    ]);
    let attempts = 0;
    const events: AgentEvent[] = [];

    const result = await askAgent("x", [], {
      backend,
      tools: {
        run: async () => {
          attempts += 1;
          throw new Error('Unknown place "Atlantis"');
        },
      },
      onEvent: (event) => events.push(event),
    });

    expect(result.answer).toBe("Done.");
    expect(attempts).toBe(1);
    expect(JSON.parse(lastContent(seen[1]))).toMatchObject({
      error: expect.stringMatching(/arguments/i),
    });
    expect(JSON.parse(lastContent(seen[2]))).toEqual({
      error: 'Unknown place "Atlantis"',
    });
    expect(events.filter((event) => event.kind === "tool_error")).toHaveLength(2);
  });

  it("gives up after a bounded number of model calls", async () => {
    const { backend } = scriptedBackend(
      Array.from({ length: 10 }, () => reply({ content: "", tool_calls: [CALL] })),
    );

    const result = await askAgent("loop forever", [], {
      backend,
      tools: { run: async () => agedRoofs(1) },
      onEvent: () => {},
    });

    expect(result.answer).toMatch(/could not finish/i);
    expect(result.evidence.length).toBeLessThanOrEqual(6);
  });
});
