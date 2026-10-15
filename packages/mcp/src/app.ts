import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { agentRequestSchema, askAgent } from "./agent.js";
import { QueryError } from "./queries.js";
import { createMcpServer } from "./server.js";
import { getSnapshot } from "./snapshot.js";
import { TOOLS } from "./tools.js";

export function createApp(): Hono {
  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: process.env.ORACLE_CORS_ORIGIN || "*",
      allowHeaders: ["content-type", "mcp-session-id", "mcp-protocol-version"],
    }),
  );

  app.get("/health", async (c) => {
    const s = await getSnapshot();
    return c.json({
      ok: true,
      runId: s.source.runId,
      base: s.source.base,
      rootCid: s.source.rootCid,
    });
  });

  app.all("/mcp", async (c) => {
    const server = createMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const res = await transport.handleRequest(c.req.raw);
    return res;
  });

  app.get("/api/tools", (c) =>
    c.json(TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description }))),
  );

  app.post("/api/tools/:name", async (c) => {
    const t = TOOLS.find((x) => x.name === c.req.param("name"));
    if (!t) return c.json({ error: "unknown tool" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as unknown;
    const parsed = t.input.safeParse(body ?? {});
    if (!parsed.success)
      return c.json({ error: "invalid input", issues: parsed.error.issues }, 400);
    try {
      return c.json(await t.run(await getSnapshot(), parsed.data));
    } catch (err) {
      const status = err instanceof QueryError ? 400 : 500;
      return c.json({ error: err instanceof Error ? err.message : String(err) }, status);
    }
  });

  app.post("/api/agent", async (c) => {
    const parsed = agentRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success)
      return c.json({ error: "invalid input", issues: parsed.error.issues }, 400);
    try {
      return c.json(await askAgent(await getSnapshot(), parsed.data));
    } catch (err) {
      return c.json(
        { error: `agent unavailable: ${err instanceof Error ? err.message : String(err)}` },
        502,
      );
    }
  });

  return app;
}
