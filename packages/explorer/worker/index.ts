import { ANALYST_PROMPT } from "./agent-prompt.js";
import { AgentRoute, type ChatCompletion, type ChatModel } from "./agent-route.js";
import { analystTools } from "./analyst-tools.js";
import { IpfsRoute, type MirrorStore } from "./ipfs-route.js";
import { PublicationIndex, publicationRecordKey } from "./publications.js";
import { tooManyRequests } from "./rate-limit.js";

interface Env {
  ASSETS: Fetcher;
  MIRROR: R2Bucket;
  AGENT_STORE: KVNamespace;
  AI: Ai;
  AGENT_MODEL: string;
  AGENT_DAILY_NEURONS: string;
  IPFS_GATEWAYS: string;
  AGENT_LIMITER: RateLimit;
}

const PUBLICATIONS_KEY = "publications.json";
const NOT_FOUND = 404;
const PUBLICATIONS_REFRESH_MS = 60_000;
const PUBLICATIONS_CACHE_CONTROL = "public, max-age=60";
const APP = "explorer";
const ISO_DATE_LENGTH = 10;
const TOOLS = analystTools();
const TOO_MANY_QUESTIONS =
  "Too many questions in the last minute from this address. Wait a moment and ask again.";

enum Route {
  Publications = "/api/publications",
  Agent = "/api/agent",
  AgentBudget = "/api/agent/budget",
  Ipfs = "/ipfs/",
}

let publicationIndex: PublicationIndex | undefined;

function publications(env: Env): PublicationIndex {
  publicationIndex ??= new PublicationIndex({
    read: async () => (await env.MIRROR.get(PUBLICATIONS_KEY))?.text() ?? null,
    now: () => Date.now(),
    refreshMs: PUBLICATIONS_REFRESH_MS,
  });
  return publicationIndex;
}

function mirrorOf(bucket: R2Bucket): MirrorStore {
  return {
    head: async (key) => {
      const object = await bucket.head(key);
      return object && { size: object.size };
    },
    get: async (key, range) => {
      const object = await bucket.get(key, range ? { range } : undefined);
      return object && { body: object.body, size: object.size };
    },
  };
}

function agentOf(env: Env): AgentRoute {
  const model: ChatModel = async (request) =>
    (await env.AI.run(
      env.AGENT_MODEL as Parameters<Ai["run"]>[0],
      request as never,
    )) as unknown as ChatCompletion;
  return new AgentRoute({
    model,
    modelName: env.AGENT_MODEL,
    store: env.AGENT_STORE,
    app: APP,
    dailyNeurons: Number(env.AGENT_DAILY_NEURONS),
    today: () => new Date().toISOString().slice(0, ISO_DATE_LENGTH),
    systemPrompt: ANALYST_PROMPT,
    tools: TOOLS,
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === Route.Publications) {
      return Response.json(await publications(env).list(), {
        headers: { "cache-control": PUBLICATIONS_CACHE_CONTROL },
      });
    }
    const recordKey = publicationRecordKey(pathname);
    if (recordKey) {
      const record = await env.MIRROR.get(recordKey);
      return record
        ? new Response(record.body, { headers: { "content-type": "application/json" } })
        : Response.json({ error: "No CI record for this publication." }, { status: NOT_FOUND });
    }
    if (pathname === Route.AgentBudget) return agentOf(env).budget();
    if (pathname === Route.Agent && request.method === "POST") {
      return (
        (await tooManyRequests(env.AGENT_LIMITER, request, TOO_MANY_QUESTIONS)) ??
        agentOf(env).handle(request)
      );
    }
    if (pathname.startsWith(Route.Ipfs)) {
      return new IpfsRoute({
        mirror: mirrorOf(env.MIRROR),
        gateways: env.IPFS_GATEWAYS.split(","),
        fetch: (input, init) => fetch(input, init),
        publications: () => publications(env).list(),
      }).handle(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
