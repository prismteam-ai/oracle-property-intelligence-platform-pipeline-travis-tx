// tRPC request context (A-03 T008; build-frontend-backends § tRPC backend). T073 (G-C2b) adds
// the Powertools Logger / Tracer / Metrics and the correlation ID here; procedures read them
// from `ctx` and never construct their own.
//
// A-16 (T024): the context also carries the caller's bearer token (the Cognito ACCESS token in
// `Authorization: Bearer <token>`), read once here and only ever checked by `adminProcedure` /
// `authedProcedure` in trpc.ts. It is never logged and never returned.
import type { CreateAWSLambdaContextOptions } from "@trpc/server/adapters/aws-lambda";
import type { APIGatewayProxyEventV2, Context as LambdaContext } from "aws-lambda";

export interface Context {
  readonly event: APIGatewayProxyEventV2;
  readonly lambda: LambdaContext;
  /** The bearer token, or undefined when the header is missing or not `Bearer <token>`. */
  readonly bearerToken?: string | undefined;
}

const BEARER = /^Bearer\s+(\S+)\s*$/i;

/** `Authorization: Bearer <token>` → the token (HTTP API v2 lowercases header names). */
export function bearerTokenOf(event: Pick<APIGatewayProxyEventV2, "headers">): string | undefined {
  const headers = event.headers ?? {};
  const raw = headers.authorization ?? headers.Authorization;
  if (raw === undefined) return undefined;
  return BEARER.exec(raw)?.[1];
}

export function createContext({
  event,
  context,
}: CreateAWSLambdaContextOptions<APIGatewayProxyEventV2>): Context {
  return { event, lambda: context, bearerToken: bearerTokenOf(event) };
}

/** Literal-path routes of the HTTP API (A-16: `ANY /trpc/explore.search`, its own throttle). */
const LITERAL_TRPC_ROUTE = /^[A-Z]+ \/trpc\/([A-Za-z0-9_.]+)$/;

/**
 * The tRPC Lambda adapter reads the procedure from a greedy `{proxy+}` path parameter and falls
 * back to the whole raw path ("trpc/explore.search", which no procedure matches). A request that
 * came through a literal-path route is presented as the `/trpc/{proxy+}` route it shadows, so the
 * same procedure answers it. Every other event is returned unchanged.
 */
export function asProxyRouteEvent(event: APIGatewayProxyEventV2): APIGatewayProxyEventV2 {
  const procedure = LITERAL_TRPC_ROUTE.exec(event.routeKey ?? "")?.[1];
  if (procedure === undefined) return event;
  const method = event.requestContext?.http?.method ?? "POST";
  return {
    ...event,
    routeKey: `${method} /trpc/{proxy+}`,
    pathParameters: { ...event.pathParameters, proxy: procedure },
  };
}
