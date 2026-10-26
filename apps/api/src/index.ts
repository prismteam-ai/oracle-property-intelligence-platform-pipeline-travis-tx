// Package entry of @countylens/api (A-03 T008): the root router and its type, for the shared
// tRPC client (packages/api-client, type-only) and the infra bundling tests. The Lambda entry
// point is src/handlers/trpc.ts, bundled by the CDK Api stack (T074), not this file.
export { appRouter, type AppRouter } from "./routers/index.js";
