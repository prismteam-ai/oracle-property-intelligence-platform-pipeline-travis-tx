// Root router (A-03 T008, T064, T072; A-13 T012): `runs` (runs.summary), `query` (query.radius,
// query.roofAge) per contracts/api.md, and `explore` (explore.search, A-13
// contracts/explore-search.md) and `mcpProxy` (mcpProxy.callTool, A-14 T034). `AppRouter` is the type the shared client (packages/api-client)
// imports type-only; procedures change additively only (ARD § 6).
import { router } from "../trpc.js";
import { adminRouter } from "./admin.js";
import { exploreRouter } from "./explore.js";
import { mcpProxyRouter } from "./mcp-proxy.js";
import { queryRouter } from "./query.js";
import { runsRouter } from "./runs.js";

export const appRouter = router({
  runs: runsRouter,
  query: queryRouter,
  explore: exploreRouter,
  mcpProxy: mcpProxyRouter,
  // A-16 (AC-6..AC-10): sign-in-gated; see trpc.ts adminProcedure.
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
