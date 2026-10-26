// tRPC initialisation (A-03 T008). One instance for the whole API; routers import `router` and
// `publicProcedure` from here. Every procedure input is a Zod schema (constitution V).
//
// A-16 T024 (AC-6, AC-8; agent-design metagross § 1): `authedProcedure` and `adminProcedure`.
// No API Gateway authorizer: /trpc is one route shared with the public procedures. The
// middleware verifies the Cognito ACCESS token with aws-jwt-verify (signature, expiry, issuer,
// token_use "access", client_id), then:
//   - no token, or a token that does not verify → 401 UNAUTHORIZED;
//   - a valid token outside the `admin` group     → 403 FORBIDDEN (adminProcedure only).
// 401 is always decided before 403. A refusal is logged as { procedure, reason, sub? }, never the
// token. Procedures run only after the check, so nothing is queued for a refused caller.
import { Logger } from "@aws-lambda-powertools/logger";
import { initTRPC, TRPCError } from "@trpc/server";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { Context } from "./context.js";

// isDev false: error responses never carry a stack trace (ERR-75; the Lambdas do not set NODE_ENV).
const t = initTRPC.context<Context>().create({ isDev: false });

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
export const mergeRouters = t.mergeRouters;

/** The one Cognito group allowed to call admin.* (infra/src/config.ts ADMIN_GROUP_NAME). */
export const ADMIN_GROUP = "admin";
/** Env names set by CountyLensApi (infra/src/config.ts ENV_NAMES). */
export const USER_POOL_ID_ENV = "COUNTYLENS_USER_POOL_ID";
export const USER_POOL_CLIENT_ID_ENV = "COUNTYLENS_USER_POOL_CLIENT_ID";

/** The claims of a verified access token that the API uses. */
export interface AccessTokenClaims {
  readonly sub: string;
  readonly username?: string;
  readonly "cognito:groups"?: readonly string[];
}
export interface AccessTokenVerifier {
  verify(token: string): Promise<AccessTokenClaims>;
}

/** The signed-in caller, as procedures see it. */
export interface CallerIdentity {
  readonly sub: string;
  readonly username: string | undefined;
  readonly groups: readonly string[];
  readonly isAdmin: boolean;
}

export type RefusalReason = "missing_token" | "invalid_token" | "not_admin" | "auth_not_configured";

interface AuthDeps {
  verifier: AccessTokenVerifier | undefined;
  logger: Pick<Logger, "warn" | "error">;
}

const auth: AuthDeps = {
  verifier: undefined,
  logger: new Logger({ serviceName: "countylens-api" }),
};

/** Tests swap the verifier and logger; `undefined` restores the default. */
export function configureAuth(overrides: Partial<AuthDeps>): void {
  if ("verifier" in overrides) auth.verifier = overrides.verifier;
  if (overrides.logger !== undefined) auth.logger = overrides.logger;
}

/** Built once per sandbox, so the pool's JWKS is fetched once and cached (aws-jwt-verify). */
function verifier(): AccessTokenVerifier | undefined {
  if (auth.verifier !== undefined) return auth.verifier;
  const userPoolId = process.env[USER_POOL_ID_ENV];
  const clientId = process.env[USER_POOL_CLIENT_ID_ENV];
  if (!userPoolId || !clientId) return undefined;
  const cognito = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: "access" });
  auth.verifier = {
    verify: async (token) => (await cognito.verify(token)) as unknown as AccessTokenClaims,
  };
  return auth.verifier;
}

function refuse(
  code: "UNAUTHORIZED" | "FORBIDDEN" | "INTERNAL_SERVER_ERROR",
  reason: RefusalReason,
  procedure: string,
  sub?: string,
): never {
  const fields = { procedure, reason, ...(sub === undefined ? {} : { sub }) };
  if (code === "INTERNAL_SERVER_ERROR")
    auth.logger.error("admin sign-in is not configured", fields);
  else auth.logger.warn("admin request refused", fields);
  throw new TRPCError({
    code,
    message:
      code === "UNAUTHORIZED"
        ? "Sign in again"
        : code === "FORBIDDEN"
          ? "This account is not an admin"
          : "Sign-in is not available right now, try later",
  });
}

const requireUser = t.middleware(async ({ ctx, path, next }) => {
  const token = ctx.bearerToken;
  if (token === undefined) refuse("UNAUTHORIZED", "missing_token", path);
  const check = verifier();
  if (check === undefined) refuse("INTERNAL_SERVER_ERROR", "auth_not_configured", path);
  let claims: AccessTokenClaims;
  try {
    claims = await check.verify(token);
  } catch {
    // The verifier's message can quote token parts; only the reason is logged.
    refuse("UNAUTHORIZED", "invalid_token", path);
  }
  const groups = [...(claims["cognito:groups"] ?? [])];
  const user: CallerIdentity = {
    sub: claims.sub,
    username: claims.username,
    groups,
    isAdmin: groups.includes(ADMIN_GROUP),
  };
  return next({ ctx: { ...ctx, user } });
});

const requireAdmin = t.middleware(async ({ ctx, path, next }) => {
  const user = (ctx as Context & { user?: CallerIdentity }).user;
  if (user === undefined) refuse("UNAUTHORIZED", "missing_token", path);
  if (!user.isAdmin) refuse("FORBIDDEN", "not_admin", path, user.sub);
  return next({ ctx: { ...ctx, user } });
});

/** Any signed-in user of the pool (401 otherwise). */
export const authedProcedure = t.procedure.use(requireUser);
/** Signed-in members of the `admin` group only (401, then 403). */
export const adminProcedure = authedProcedure.use(requireAdmin);
