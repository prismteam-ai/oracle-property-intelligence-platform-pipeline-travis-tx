// A-16 T024 (AC-6..AC-10): adminProcedure and the admin router. Written before
// src/routers/admin.ts existed. AWS calls are aws-sdk-client-mock (Golden Path mock); the access
// token verifier is a fake behind trpc.ts `configureAuth`, so no JWKS fetch happens.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CloudWatchLogsClient,
  GetQueryResultsCommand,
  StartQueryCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  CognitoIdentityProviderClient,
  GetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  LIVE_RUN_SCHEMA,
  RUN_COMMAND_TTL_MS,
  RUNS_INDEX_SCHEMA,
  RunCommandV1,
  type LiveRunV1,
} from "@countylens/contract";
import type { APIGatewayProxyEventV2, Context as LambdaContext } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asProxyRouteEvent, bearerTokenOf } from "../src/context.js";
import { appRouter } from "../src/routers/index.js";
import { ACTIVITY_QUERIES, RUN_ALREADY_RUNNING, resetAdminState } from "../src/routers/admin.js";
import { configureAuth, type AccessTokenClaims } from "../src/trpc.js";

const sqs = mockClient(SQSClient);
const s3 = mockClient(S3Client);
const logs = mockClient(CloudWatchLogsClient);
const cognito = mockClient(CognitoIdentityProviderClient);

const ADMIN_TOKEN = "admin.token.value";
const USER_TOKEN = "user.token.value";
const BAD_TOKEN = "expired.token.value";
const ADMIN_SUB = "11111111-1111-4111-8111-111111111111";
const USER_SUB = "22222222-2222-4222-8222-222222222222";
const REGION = ["xx", "test", "1"].join("-");

const claims: Record<string, AccessTokenClaims> = {
  [ADMIN_TOKEN]: { sub: ADMIN_SUB, username: ADMIN_SUB, "cognito:groups": ["admin"] },
  [USER_TOKEN]: { sub: USER_SUB, username: USER_SUB },
};
const warn = vi.fn();
const error = vi.fn();

function caller(token?: string) {
  const event = { headers: {} } as unknown as APIGatewayProxyEventV2;
  return appRouter.createCaller({
    event,
    lambda: {} as LambdaContext,
    bearerToken: token,
  });
}

function live(overrides: Partial<LiveRunV1> = {}): LiveRunV1 {
  const now = new Date().toISOString();
  return {
    schema: LIVE_RUN_SCHEMA,
    state: "idle",
    runId: null,
    commandId: null,
    startedAt: null,
    updatedAt: now,
    step: null,
    bridgeSeenAt: now,
    lastCommand: null,
    limitations: [],
    ...overrides,
  };
}
function serveLive(value: LiveRunV1 | "missing"): void {
  s3.on(GetObjectCommand).callsFake(() => {
    if (value === "missing") throw Object.assign(new Error("no key"), { name: "NoSuchKey" });
    return { Body: { transformToString: async () => JSON.stringify(value) } };
  });
}

let dir: string;
const saved = { ...process.env };
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "admin-test-"));
  const index = join(dir, "index.json");
  writeFileSync(
    index,
    JSON.stringify({
      schema: RUNS_INDEX_SCHEMA,
      runs: [
        {
          runId: "travis-run-1",
          manifestCid: "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
          finishedAt: "2026-10-20T10:00:00Z",
        },
        {
          runId: "travis-run-2",
          manifestCid: "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
          finishedAt: "2026-10-24T10:00:00Z",
        },
      ],
    }),
  );
  Object.assign(process.env, {
    RUNS_INDEX_URL: "",
    RUNS_INDEX_PATH: index,
    COUNTYLENS_ADMIN_QUEUE_URL:
      "https://sqs.example.invalid/000000000000/countylens-admin-commands",
    CID_COPY_BUCKET: "cid-copy-bucket",
    LIVE_STATUS_KEY: "live/live.json",
    COUNTYLENS_QUERY_LOG_GROUP: "CountyLensApi-AccessLogs",
    AWS_REGION: REGION,
  });
  configureAuth({
    verifier: {
      verify: async (token) => {
        const c = claims[token];
        if (c === undefined) throw new Error(`Token expired: ${token}`);
        return c;
      },
    },
    logger: { warn, error },
  });
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = saved;
});
beforeEach(() => {
  sqs.reset();
  s3.reset();
  logs.reset();
  cognito.reset();
  warn.mockReset();
  error.mockReset();
  resetAdminState();
  sqs.on(SendMessageCommand).resolves({ MessageId: "m-1" });
  serveLive(live());
});

/** The RunCommandV1 bodies sent so far, parsed (fails the test on a malformed body). */
const sentCommands = () =>
  sqs
    .commandCalls(SendMessageCommand)
    .map((c) => RunCommandV1.parse(JSON.parse(c.args[0].input.MessageBody ?? "null")));

const logged = () => JSON.stringify([...warn.mock.calls, ...error.mock.calls]);

describe("adminProcedure (AC-8): 401 before 403, nothing queued, refusal logged without the token", () => {
  it("no token → UNAUTHORIZED on every admin procedure, nothing sent", async () => {
    await expect(caller().admin.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller().admin.run.start({ mode: "dry_run" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller().admin.runs.live()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller().admin.activity.summary()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      "admin request refused",
      expect.objectContaining({ reason: "missing_token", procedure: "admin.run.start" }),
    );
  });

  it("an expired/invalid token → UNAUTHORIZED (not FORBIDDEN), the token never logged", async () => {
    await expect(caller(BAD_TOKEN).admin.run.start({ mode: "publish" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(logged()).toContain("invalid_token");
    expect(logged()).not.toContain(BAD_TOKEN);
  });

  it("a signed-in non-admin → FORBIDDEN on run.start/stop/retry, runs.live, activity; nothing sent; sub logged, not the token", async () => {
    const c = caller(USER_TOKEN);
    for (const call of [
      () => c.admin.run.start({ mode: "dry_run" }),
      () => c.admin.run.stop({}),
      () => c.admin.run.retry({ targetRunId: "travis-run-2" }),
      () => c.admin.runs.live(),
      () => c.admin.activity.summary(),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(s3.commandCalls(GetObjectCommand)).toHaveLength(0);
    expect(logs.commandCalls(StartQueryCommand)).toHaveLength(0);
    expect(logged()).toContain(USER_SUB);
    expect(logged()).toContain("not_admin");
    expect(logged()).not.toContain(USER_TOKEN);
  });
});

describe("admin.me (AC-6)", () => {
  it("returns the email from Cognito, the groups and isAdmin", async () => {
    cognito.on(GetUserCommand).resolves({
      Username: ADMIN_SUB,
      UserAttributes: [{ Name: "email", Value: "operator@example.invalid" }],
    });
    await expect(caller(ADMIN_TOKEN).admin.me()).resolves.toEqual({
      email: "operator@example.invalid",
      groups: ["admin"],
      isAdmin: true,
    });
    expect(cognito.commandCalls(GetUserCommand)[0]?.args[0].input).toEqual({
      AccessToken: ADMIN_TOKEN,
    });
  });

  it("a non-admin may call me and learns isAdmin false", async () => {
    cognito.on(GetUserCommand).rejects(new Error("throttled"));
    await expect(caller(USER_TOKEN).admin.me()).resolves.toEqual({
      email: USER_SUB,
      groups: [],
      isAdmin: false,
    });
  });
});

describe("admin.run.* (AC-7, AC-9)", () => {
  it("start sends one valid RunCommandV1 (window since the newest run, expiresAt = now + 15 min, requestedBy = sub)", async () => {
    const before = Date.now();
    const sent = await caller(ADMIN_TOKEN).admin.run.start({ mode: "dry_run" });
    const calls = sqs.commandCalls(SendMessageCommand);
    expect(calls).toHaveLength(1);
    const input = (calls[0]?.args[0].input ?? {}) as { QueueUrl?: string; MessageBody?: string };
    expect(input.QueueUrl).toBe(process.env.COUNTYLENS_ADMIN_QUEUE_URL);
    const command = RunCommandV1.parse(JSON.parse(input.MessageBody ?? "null"));
    expect(command).toMatchObject({
      action: "start",
      mode: "dry_run",
      window: { kind: "austin_permits_since_watermark", sinceRunId: "travis-run-2" },
      requestedBy: ADMIN_SUB,
    });
    const ttl = Date.parse(command.expiresAt) - Date.parse(command.requestedAt);
    expect(ttl).toBe(RUN_COMMAND_TTL_MS);
    expect(Date.parse(command.requestedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(sent).toEqual({ commandId: command.commandId, expiresAt: command.expiresAt });
    expect(input.MessageBody).not.toContain(ADMIN_TOKEN);
  });

  it("start and retry → 409 CONFLICT 'A run is already running' while live.json says running or stopping; nothing sent", async () => {
    for (const state of ["running", "stopping"] as const) {
      serveLive(live({ state, runId: "travis-run-3" }));
      await expect(caller(ADMIN_TOKEN).admin.run.start({ mode: "publish" })).rejects.toMatchObject({
        code: "CONFLICT",
        message: RUN_ALREADY_RUNNING,
      });
      await expect(
        caller(ADMIN_TOKEN).admin.run.retry({ targetRunId: "travis-run-2" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it("start works when the bridge has never written live.json", async () => {
    serveLive("missing");
    await expect(caller(ADMIN_TOKEN).admin.run.start({ mode: "publish" })).resolves.toHaveProperty(
      "commandId",
    );
  });

  it("stop is accepted while running and carries the command id to cancel as targetRunId", async () => {
    serveLive(live({ state: "running" }));
    const target = "33333333-3333-4333-8333-333333333333";
    await caller(ADMIN_TOKEN).admin.run.stop({ commandId: target });
    await caller(ADMIN_TOKEN).admin.run.stop({});
    const [withTarget, plain] = sentCommands();
    expect(withTarget).toMatchObject({ action: "stop", window: null, targetRunId: target });
    expect(plain?.targetRunId).toBeUndefined();
  });

  it("retry names the run to retry", async () => {
    await caller(ADMIN_TOKEN).admin.run.retry({ targetRunId: "travis-run-2" });
    expect(sentCommands()[0]).toMatchObject({
      action: "retry",
      targetRunId: "travis-run-2",
      window: null,
    });
  });

  it("rejects input outside the schema before anything is sent", async () => {
    await expect(
      caller(ADMIN_TOKEN).admin.run.start({ mode: "everything" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
  });
});

describe("admin.runs.live (AC-7, AC-9)", () => {
  it("bridgeOnline is true within 3 minutes of bridgeSeenAt, false after; lastSent echoes the last command", async () => {
    serveLive(live({ bridgeSeenAt: new Date(Date.now() - 60_000).toISOString() }));
    await expect(caller(ADMIN_TOKEN).admin.runs.live()).resolves.toMatchObject({
      bridgeOnline: true,
    });
    const sent = await caller(ADMIN_TOKEN).admin.run.start({ mode: "dry_run" });
    serveLive(live({ bridgeSeenAt: new Date(Date.now() - 4 * 60_000).toISOString() }));
    await expect(caller(ADMIN_TOKEN).admin.runs.live()).resolves.toMatchObject({
      bridgeOnline: false,
      lastSent: sent,
    });
  });

  it("NOT_FOUND when the bridge never reported", async () => {
    serveLive("missing");
    await expect(caller(ADMIN_TOKEN).admin.runs.live()).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("admin.activity.summary (AC-10)", () => {
  beforeEach(() => {
    logs.on(StartQueryCommand).callsFake((input: { queryString: string }) => ({
      queryId: Object.entries(ACTIVITY_QUERIES).find(([, q]) => q === input.queryString)?.[0],
    }));
    logs.on(GetQueryResultsCommand).callsFake((input: { queryId: string }) => {
      const rows: Record<string, { field: string; value: string }[][]> = {
        perDay: [
          [
            { field: "day", value: "2026-10-24 00:00:00.000" },
            { field: "questions", value: "12" },
          ],
          [
            { field: "day", value: "2026-10-25 00:00:00.000" },
            { field: "questions", value: "30" },
          ],
        ],
        latency: [
          [
            { field: "requests", value: "42" },
            { field: "p95", value: "812.5" },
          ],
        ],
        failures: [
          [
            { field: "status", value: "500" },
            { field: "failures", value: "2" },
          ],
          [
            { field: "status", value: "429" },
            { field: "failures", value: "3" },
          ],
          [
            { field: "status", value: "403" },
            { field: "failures", value: "1" },
          ],
        ],
      };
      return { status: "Complete", results: rows[input.queryId] };
    });
  });

  it("runs the three queries on the query log over 30 days and returns each number with its query and console link", async () => {
    const out = await caller(ADMIN_TOKEN).admin.activity.summary();
    const starts = logs.commandCalls(StartQueryCommand).map((c) => c.args[0].input);
    expect(starts).toHaveLength(3);
    for (const s of starts) {
      expect(s.logGroupName).toBe("CountyLensApi-AccessLogs");
      expect((s.endTime ?? 0) - (s.startTime ?? 0)).toBe(30 * 24 * 60 * 60);
    }
    const value = (id: string) => out.metrics.find((m) => m.id === id)?.value;
    expect(value("requests")).toBe(42);
    expect(value("p95")).toBe(812.5);
    expect(value("server_errors")).toBe(2);
    expect(value("throttled")).toBe(3);
    expect(value("client_errors")).toBe(1);
    expect(out.perDay).toEqual([
      { day: "2026-10-24", questions: 12 },
      { day: "2026-10-25", questions: 30 },
    ]);
    for (const m of out.metrics) {
      expect(Object.values(ACTIVITY_QUERIES)).toContain(m.query);
      expect(m.consoleUrl).toMatch(
        new RegExp(
          `^https://${REGION}\\.console\\.aws\\.amazon\\.com/cloudwatch/home\\?region=${REGION}#logsV2:logs-insights`,
        ),
      );
    }
  });

  it("a second call within 5 minutes is served from the cache (same cachedAt, no new query)", async () => {
    const first = await caller(ADMIN_TOKEN).admin.activity.summary();
    const second = await caller(ADMIN_TOKEN).admin.activity.summary();
    expect(second.cachedAt).toBe(first.cachedAt);
    expect(logs.commandCalls(StartQueryCommand)).toHaveLength(3);
  });
});

describe("context helpers", () => {
  it("bearerTokenOf reads `Authorization: Bearer <token>` only", () => {
    expect(bearerTokenOf({ headers: { authorization: "Bearer abc.def" } })).toBe("abc.def");
    expect(bearerTokenOf({ headers: { authorization: "Basic abc" } })).toBeUndefined();
    expect(bearerTokenOf({ headers: {} })).toBeUndefined();
  });

  it("asProxyRouteEvent presents ANY /trpc/explore.search as the proxy route; other events unchanged", () => {
    const event = {
      routeKey: "ANY /trpc/explore.search",
      rawPath: "/trpc/explore.search",
      requestContext: { http: { method: "GET" } },
    } as unknown as APIGatewayProxyEventV2;
    expect(asProxyRouteEvent(event)).toMatchObject({
      routeKey: "GET /trpc/{proxy+}",
      pathParameters: { proxy: "explore.search" },
    });
    const proxied = {
      routeKey: "POST /trpc/{proxy+}",
      pathParameters: { proxy: "runs.summary" },
    } as unknown as APIGatewayProxyEventV2;
    expect(asProxyRouteEvent(proxied)).toBe(proxied);
  });
});

describe("Activity counts questions only (metagross review, Major 2)", () => {
  it("every Activity query filters to explore.search and query.* paths, never admin or runs", () => {
    for (const q of Object.values(ACTIVITY_QUERIES)) {
      expect(q.startsWith("filter path like /\\/trpc\\/(explore\\.search|query\\.)/")).toBe(true);
      expect(q).not.toMatch(/admin|runs\./);
    }
  });
});
