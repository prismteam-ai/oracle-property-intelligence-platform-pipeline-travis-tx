// T022 (A-14): the agent Lambda's own tRPC router (AD-27: a separate Lambda from the query API's
// appRouter, infra/src/api-stack.ts's `AGENT_ENTRY`), so `agent.ask` is actually callable through
// the tRPC AWS Lambda adapter -- same composition pattern as apps/api/src/routers/index.ts
// (router({...}) of named procedures), kept in its own file because this Lambda bundles
// apps/api/src/handlers/agent.ts, never apps/api/src/handlers/trpc.ts's `appRouter`.
import { publicProcedure, router } from "../trpc.js";
import { AgentAskInput, runAgentAsk } from "./ask.js";

export const agentRouter = router({
  ask: publicProcedure.input(AgentAskInput).mutation(({ input }) => runAgentAsk(input)),
});

export type AgentRouter = typeof agentRouter;
