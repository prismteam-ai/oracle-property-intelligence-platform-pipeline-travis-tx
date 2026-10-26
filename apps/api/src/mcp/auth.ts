// A-14 T017 (G-4): the MCP Lambda's bearer-token check (AD-10, AD-14; agent-design.md § oracle
// "Token-check design"). The token lives in SSM as a SecureString (never Secrets Manager, never
// a default or fallback value) at MCP_TOKEN_PARAMETER_NAME, read once per sandbox at cold start
// through Powertools Parameters — the same lazy-singleton, "a failed open/load is not kept"
// pattern as apps/api/src/engine/duckdb-node.ts's getEngine() (DuckDB is wired only under
// apps/*/src/engine/**, ARD § 4/AD-19 — this module deliberately does not import it). A missing
// or empty parameter fails fast before any route registers, with one clear, secret-free log
// line; the caller (src/mcp/server.ts, T026) lets that failure 500 the request rather than
// silently serving unauthenticated.
//
// Every request's `Authorization` header is checked against the cached token in constant time:
// both values are hashed first (SHA-256) so `crypto.timingSafeEqual` always compares two
// fixed-length buffers and never throws or leaks a length difference, and `===` is never used.
// A missing or wrong token returns the typed 401 shape and nothing else runs. This module
// imports no DuckDB/engine code at all (not bindOnce/getEngine/timedQuery) — an auth failure can
// structurally never reach a bind or a query (AC-11); verified directly by reading this file's
// own source in apps/api/test/mcp-auth.test.ts.
import { createHash, timingSafeEqual } from "node:crypto";
import { Logger } from "@aws-lambda-powertools/logger";
import { getParameter } from "@aws-lambda-powertools/parameters/ssm";

/** `/countylens/<...>` naming, the sibling of infra/src/api-stack.ts's HTTP_API_URL_PARAMETER:
 *  the MCP bearer token, an SSM SecureString. infra/src/api-stack.ts's MCP block (T018) grants
 *  the MCP Lambda `ssm:GetParameter` on exactly this parameter's ARN, no wildcard (AD-14, no
 *  Secrets Manager resource). The two must name the same parameter: changing this constant also
 *  means changing the literal in infra/src/api-stack.ts's MCP block and the deployed parameter. */
export const MCP_TOKEN_PARAMETER_NAME = "/countylens/mcp/token";

const SERVICE_NAME = "countylens-mcp";

export type AuthLogger = Pick<Logger, "error">;

let logger: AuthLogger | undefined;

function log(): AuthLogger {
  logger ??= new Logger({ serviceName: SERVICE_NAME });
  return logger;
}

/** Tests only: replaces the logger (or restores the lazily built Powertools default). */
export function setAuthObservability(next: AuthLogger | undefined): void {
  logger = next;
}

let token: Promise<string> | undefined;

/** Tests only: forgets the cached token so the next call reads SSM again. The Lambda itself
 *  never calls this — there is no rotation TTL by default (a documented limitation: a revoked
 *  token stays valid on an already-warm sandbox until it recycles). */
export function resetMcpTokenCache(): void {
  token = undefined;
}

async function loadToken(): Promise<string> {
  let value: string | undefined;
  try {
    value = await getParameter(MCP_TOKEN_PARAMETER_NAME, { decrypt: true });
  } catch (error) {
    log().error("MCP bearer token not configured: SSM GetParameter failed", {
      parameterName: MCP_TOKEN_PARAMETER_NAME,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    throw new Error("MCP bearer token not configured", { cause: error });
  }
  if (value === undefined || value === "") {
    log().error("MCP bearer token not configured: the SSM parameter has no value", {
      parameterName: MCP_TOKEN_PARAMETER_NAME,
    });
    throw new Error("MCP bearer token not configured");
  }
  return value;
}

/**
 * The bearer token for this sandbox's lifetime: loaded from SSM once, no default. A failed load
 * is not cached, so the next call tries SSM again and fails the same honest way (fail fast, no
 * route ever serves with an unconfigured token).
 */
export function getMcpToken(): Promise<string> {
  token ??= loadToken().catch((error: unknown) => {
    token = undefined;
    throw error;
  });
  return token;
}

export interface AuthFailure {
  readonly status: 401;
  readonly body: { readonly error: "unauthorized" };
}

export type AuthResult =
  { readonly ok: true } | { readonly ok: false; readonly failure: AuthFailure };

const UNAUTHORIZED: AuthFailure = { status: 401, body: { error: "unauthorized" } };

/** The typed 401 shape for no/wrong token (AC-11); exported so callers can reuse the exact
 *  object instead of re-deriving it. */
export function unauthorized(): AuthFailure {
  return UNAUTHORIZED;
}

const BEARER = /^Bearer (.+)$/;

/** SHA-256 digest, so `timingSafeEqual` always sees two equal-length buffers (never a length
 *  exception, never a length-based timing signal) and `===` is never used on the raw strings. */
const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

/**
 * Checks one request's `Authorization` header against the cached SSM token, constant-time.
 * Resolves `{ok:false, failure}` for a missing/malformed header or a wrong token — never throws
 * for those cases. A cold-start token-load failure (see `getMcpToken`) still propagates as a
 * thrown error: that is a configuration failure, not a per-request auth decision, and must fail
 * the whole route rather than be reported as an ordinary 401.
 */
export async function checkAuth(authorization: string | undefined): Promise<AuthResult> {
  const expected = await getMcpToken();
  const presented = authorization !== undefined ? BEARER.exec(authorization)?.[1] : undefined;
  if (presented === undefined || !timingSafeEqual(digest(presented), digest(expected))) {
    return { ok: false, failure: unauthorized() };
  }
  return { ok: true };
}
