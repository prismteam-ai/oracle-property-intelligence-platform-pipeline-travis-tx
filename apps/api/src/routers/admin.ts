// A-16 T002 + T024 (AC-6..AC-10; contracts/frozen-interfaces.md): the admin router.
//   admin.me               → { email, groups, isAdmin }            (any signed-in user)
//   admin.run.start/stop/retry → { commandId, expiresAt }          (admins)
//   admin.runs.live        → LiveRunV1 & { bridgeOnline, lastSent? } (admins)
//   admin.activity.summary → Logs Insights over the query log      (admins)
// Commands go to the SQS queue as RunCommandV1 (SendMessage only; the laptop bridge long-polls
// it, so nothing reaches the laptop). The bridge's state comes from s3://<CID copy>/live/live.json
// (read-only). Start and Retry are refused with 409 while live.json says a run is running.
// Nothing is sent before `adminProcedure` has checked the caller (trpc.ts).
import { randomUUID } from "node:crypto";
import {
  CloudWatchLogsClient,
  GetQueryResultsCommand,
  StartQueryCommand,
  StopQueryCommand,
  type ResultField,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  CognitoIdentityProviderClient,
  GetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  BRIDGE_STALE_MS,
  LiveRunV1,
  RUN_COMMAND_SCHEMA,
  RUN_COMMAND_TTL_MS,
  RunCommandV1,
} from "@countylens/contract";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { latestOf, loadRunsIndex } from "../mcp/runs-index.js";
import { adminProcedure, authedProcedure, router, type CallerIdentity } from "../trpc.js";

// --- T002: env names and I/O schemas (frozen) ---

export const ADMIN_QUEUE_URL_ENV = "COUNTYLENS_ADMIN_QUEUE_URL";
export const LIVE_STATUS_KEY_ENV = "LIVE_STATUS_KEY";
export const QUERY_LOG_GROUP_ENV = "COUNTYLENS_QUERY_LOG_GROUP";
export const CID_COPY_BUCKET_ENV = "CID_COPY_BUCKET";

export const RUN_ALREADY_RUNNING = "A run is already running";

export const AdminMeOutput = z
  .object({ email: z.string(), groups: z.array(z.string()), isAdmin: z.boolean() })
  .strict();
export type AdminMeOutput = z.infer<typeof AdminMeOutput>;

export const RunStartInput = z.object({ mode: z.enum(["publish", "dry_run"]) }).strict();
export const RunStopInput = z.object({ commandId: z.uuid().optional() }).strict();
export const RunRetryInput = z
  .object({
    targetRunId: z.string().min(1),
    mode: z.enum(["publish", "dry_run"]).default("publish"),
  })
  .strict();
export const RunCommandSent = z.object({ commandId: z.uuid(), expiresAt: z.string() }).strict();
export type RunCommandSent = z.infer<typeof RunCommandSent>;

export type RunsLiveOutput = LiveRunV1 & {
  readonly bridgeOnline: boolean;
  readonly lastSent?: RunCommandSent;
};

export const ActivityMetric = z
  .object({
    id: z.string(),
    label: z.string(),
    value: z.number().nullable(),
    unit: z.enum(["count", "ms"]),
    query: z.string(),
    consoleUrl: z.string(),
  })
  .strict();
export const ActivitySummaryOutput = z
  .object({
    cachedAt: z.string(),
    metrics: z.array(ActivityMetric),
    perDay: z.array(z.object({ day: z.string(), questions: z.number() }).strict()),
  })
  .strict();
export type ActivitySummaryOutput = z.infer<typeof ActivitySummaryOutput>;

// --- Logs Insights queries over the HTTP API access log (identifiers and counts only) ---

/** 30 days: the query log's retention (AM-03). */
export const ACTIVITY_WINDOW_S = 30 * 24 * 60 * 60;
/** Warm sandboxes answer from memory for 5 minutes (AC-10). */
export const ACTIVITY_CACHE_MS = 5 * 60 * 1000;
/** A cold summary gives up after 8 s, well inside the 15 s Lambda timeout. */
export const ACTIVITY_DEADLINE_MS = 8000;
const POLL_MS = 400;

/**
 * Only question procedures count (Explore searches and the query.* procedures); admin, runs and
 * status polling are left out so the Runs page's own 5 s polls never inflate the numbers
 * (metagross review, Major 2). Agent questions use the separate agent API and its own log.
 */
export const QUESTION_FILTER = String.raw`filter path like /\/trpc\/(explore\.search|query\.)/`;

export const ACTIVITY_QUERIES = {
  perDay: `${QUESTION_FILTER} | stats count(*) as questions by bin(1d) as day | sort day asc`,
  latency: `${QUESTION_FILTER} | filter ispresent(responseLatency) | stats count(*) as requests, pct(responseLatency, 95) as p95`,
  failures: `${QUESTION_FILTER} | filter status >= 400 | stats count(*) as failures by status`,
} as const;
type QueryName = keyof typeof ACTIVITY_QUERIES;

/** The CloudWatch console's Logs Insights deep link with the query and log group pre-filled. */
export function logsInsightsUrl(region: string, logGroup: string, query: string): string {
  const esc = (s: string) => encodeURIComponent(s).replace(/%/g, "*");
  const detail =
    `~(end~0~start~-${ACTIVITY_WINDOW_S}~timeType~'RELATIVE~unit~'seconds` +
    `~editorString~'${esc(query)}~source~(~'${esc(logGroup)}))`;
  return (
    `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}` +
    `#logsV2:logs-insights$3FqueryDetail$3D${encodeURIComponent(detail).replace(/%/g, "$")}`
  );
}

// --- AWS clients (one per sandbox; aws-sdk-client-mock intercepts them in tests) ---

let clients:
  | {
      sqs: SQSClient;
      s3: S3Client;
      logs: CloudWatchLogsClient;
      cognito: CognitoIdentityProviderClient;
    }
  | undefined;
function aws() {
  clients ??= {
    sqs: new SQSClient({}),
    s3: new S3Client({}),
    logs: new CloudWatchLogsClient({}),
    cognito: new CognitoIdentityProviderClient({}),
  };
  return clients;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `${name} is not configured` });
  }
  return value;
}

// --- live.json ---

/** The bridge's status, or undefined when it has never written one (S3 404, or 403 without List). */
async function readLive(): Promise<LiveRunV1 | undefined> {
  let text: string | undefined;
  try {
    const out = await aws().s3.send(
      new GetObjectCommand({
        Bucket: requiredEnv(CID_COPY_BUCKET_ENV),
        Key: requiredEnv(LIVE_STATUS_KEY_ENV),
      }),
    );
    text = await out.Body?.transformToString();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    const name = (error as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound" || name === "AccessDenied") return undefined;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Run status is not available" });
  }
  if (text === undefined) return undefined;
  const parsed = LiveRunV1.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Run status is malformed" });
  }
  return parsed.data;
}

const isActive = (live: LiveRunV1 | undefined): boolean =>
  live !== undefined && (live.state === "running" || live.state === "stopping");

// --- commands ---

/** The last command this sandbox sent (best effort: per warm sandbox, not durable). */
let lastSent: RunCommandSent | undefined;

async function send(
  user: CallerIdentity,
  fields: Pick<RunCommandV1, "action" | "window" | "mode"> & { targetRunId?: string },
): Promise<RunCommandSent> {
  const queueUrl = requiredEnv(ADMIN_QUEUE_URL_ENV);
  const now = Date.now();
  const command = RunCommandV1.parse({
    schema: RUN_COMMAND_SCHEMA,
    commandId: randomUUID(),
    action: fields.action,
    window: fields.window,
    ...(fields.targetRunId === undefined ? {} : { targetRunId: fields.targetRunId }),
    mode: fields.mode,
    requestedBy: user.sub,
    requestedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + RUN_COMMAND_TTL_MS).toISOString(),
  });
  await aws().sqs.send(
    new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(command) }),
  );
  lastSent = { commandId: command.commandId, expiresAt: command.expiresAt };
  return lastSent;
}

async function refuseWhileRunning(): Promise<void> {
  if (isActive(await readLive()))
    throw new TRPCError({ code: "CONFLICT", message: RUN_ALREADY_RUNNING });
}

// --- activity ---

let activityCache: { at: number; value: ActivitySummaryOutput } | undefined;

/** Tests only: forget the cached summary and the last sent command. */
export function resetAdminState(): void {
  activityCache = undefined;
  lastSent = undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runQuery(
  logGroup: string,
  query: string,
  deadline: number,
): Promise<ResultField[][]> {
  const end = Math.floor(Date.now() / 1000);
  const { queryId } = await aws().logs.send(
    new StartQueryCommand({
      logGroupName: logGroup,
      startTime: end - ACTIVITY_WINDOW_S,
      endTime: end,
      queryString: query,
    }),
  );
  if (queryId === undefined) throw new Error("StartQuery returned no queryId");
  for (;;) {
    const out = await aws().logs.send(new GetQueryResultsCommand({ queryId }));
    if (out.status === "Complete") return out.results ?? [];
    if (out.status === "Failed" || out.status === "Cancelled" || out.status === "Timeout") {
      throw new Error(`Logs Insights query ${out.status}`);
    }
    if (Date.now() + POLL_MS > deadline) {
      await aws()
        .logs.send(new StopQueryCommand({ queryId }))
        .catch(() => undefined);
      throw new TRPCError({ code: "TIMEOUT", message: "Activity is taking too long, try again" });
    }
    await sleep(POLL_MS);
  }
}

const field = (row: ResultField[], name: string): string | undefined =>
  row.find((f) => f.field === name)?.value;
const num = (value: string | undefined): number | null =>
  value === undefined || value === "" || Number.isNaN(Number(value)) ? null : Number(value);

async function activitySummary(): Promise<ActivitySummaryOutput> {
  if (activityCache !== undefined && Date.now() - activityCache.at < ACTIVITY_CACHE_MS) {
    return activityCache.value;
  }
  const logGroup = requiredEnv(QUERY_LOG_GROUP_ENV);
  const region = requiredEnv("AWS_REGION");
  const deadline = Date.now() + ACTIVITY_DEADLINE_MS;
  const names = Object.keys(ACTIVITY_QUERIES) as QueryName[];
  const results = await Promise.all(
    names.map((n) => runQuery(logGroup, ACTIVITY_QUERIES[n], deadline)),
  );
  const by = Object.fromEntries(names.map((n, i) => [n, results[i] ?? []])) as Record<
    QueryName,
    ResultField[][]
  >;

  const latency = by.latency[0] ?? [];
  const failures = by.failures.map((row) => ({
    status: num(field(row, "status")) ?? 0,
    count: num(field(row, "failures")) ?? 0,
  }));
  const sum = (keep: (status: number) => boolean) =>
    failures.filter((f) => keep(f.status)).reduce((total, f) => total + f.count, 0);
  const link = (q: QueryName) => ({
    query: ACTIVITY_QUERIES[q],
    consoleUrl: logsInsightsUrl(region, logGroup, ACTIVITY_QUERIES[q]),
  });

  const value: ActivitySummaryOutput = {
    cachedAt: new Date().toISOString(),
    metrics: [
      {
        id: "requests",
        label: "Requests, last 30 days",
        value: num(field(latency, "requests")) ?? 0,
        unit: "count",
        ...link("latency"),
      },
      {
        id: "p95",
        label: "p95 latency",
        value: num(field(latency, "p95")),
        unit: "ms",
        ...link("latency"),
      },
      {
        id: "server_errors",
        label: "Failures: server error (5xx)",
        value: sum((s) => s >= 500),
        unit: "count",
        ...link("failures"),
      },
      {
        id: "throttled",
        label: "Failures: throttled (429)",
        value: sum((s) => s === 429),
        unit: "count",
        ...link("failures"),
      },
      {
        id: "client_errors",
        label: "Failures: refused or invalid (4xx)",
        value: sum((s) => s >= 400 && s < 500 && s !== 429),
        unit: "count",
        ...link("failures"),
      },
    ],
    perDay: by.perDay
      .map((row) => ({
        day: (field(row, "day") ?? "").slice(0, 10),
        questions: num(field(row, "questions")) ?? 0,
      }))
      .filter((d) => d.day !== ""),
  };
  activityCache = { at: Date.now(), value };
  return value;
}

// --- router ---

async function emailOf(token: string | undefined, user: CallerIdentity): Promise<string> {
  if (token !== undefined) {
    try {
      const out = await aws().cognito.send(new GetUserCommand({ AccessToken: token }));
      const email = out.UserAttributes?.find((a) => a.Name === "email")?.Value;
      if (email) return email;
    } catch {
      // The token already verified; the name lookup is cosmetic, fall back below.
    }
  }
  return user.username ?? user.sub;
}

export const adminRouter = router({
  me: authedProcedure.query(async ({ ctx }): Promise<AdminMeOutput> => ({
    email: await emailOf(ctx.bearerToken, ctx.user),
    groups: [...ctx.user.groups],
    isAdmin: ctx.user.isAdmin,
  })),
  run: router({
    start: adminProcedure.input(RunStartInput).mutation(async ({ ctx, input }) => {
      await refuseWhileRunning();
      const latest = latestOf(await loadRunsIndex());
      if (latest === undefined) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No published run to start from",
        });
      }
      return send(ctx.user, {
        action: "start",
        window: { kind: "austin_permits_since_watermark", sinceRunId: latest.runId },
        mode: input.mode,
      });
    }),
    stop: adminProcedure.input(RunStopInput).mutation(async ({ ctx, input }) =>
      send(ctx.user, {
        action: "stop",
        window: null,
        mode: "publish",
        ...(input.commandId === undefined ? {} : { targetRunId: input.commandId }),
      }),
    ),
    retry: adminProcedure.input(RunRetryInput).mutation(async ({ ctx, input }) => {
      await refuseWhileRunning();
      return send(ctx.user, {
        action: "retry",
        window: null,
        mode: input.mode,
        targetRunId: input.targetRunId,
      });
    }),
  }),
  runs: router({
    live: adminProcedure.query(async (): Promise<RunsLiveOutput> => {
      const live = await readLive();
      if (live === undefined) {
        throw new TRPCError({ code: "NOT_FOUND", message: "The bridge has not reported yet" });
      }
      return {
        ...live,
        bridgeOnline: Date.now() - Date.parse(live.bridgeSeenAt) <= BRIDGE_STALE_MS,
        ...(lastSent === undefined ? {} : { lastSent }),
      };
    }),
  }),
  activity: router({
    summary: adminProcedure.query(() => activitySummary()),
  }),
});
