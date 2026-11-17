import type { AgentBackend, AgentReply } from "./agent-loop.js";

const AGENT_PATH = "/api/agent";

export function httpBackend(onReply: (reply: AgentReply) => void): AgentBackend {
  return {
    next: async (messages) => {
      const response = await fetch(AGENT_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<AgentReply> & {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? `The agent answered ${response.status}`);
      const reply = body as AgentReply;
      onReply(reply);
      return reply;
    },
  };
}
