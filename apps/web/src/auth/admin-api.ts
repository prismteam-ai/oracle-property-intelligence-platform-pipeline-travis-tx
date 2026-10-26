// The admin calls of the web app (A-16 T042/T043/T044; frozen-interfaces.md "tRPC procedures"):
// `admin.me`, `admin.run.start|stop|retry`, `admin.runs.live`, `admin.activity.summary`. They go
// through the shared tRPC client (packages/api-client, the only one) with the access token as a
// Bearer header; the API (`adminProcedure`) verifies it and the `admin` group, answering 401 for a
// missing or expired token and 403 for a signed-in user who is not an admin.
//
// The router type does not carry `admin` until the API group's router lands, so the client is
// narrowed to the frozen shapes here and every response is parsed with Zod before the page sees
// it: a drifted answer is an "unavailable" state, never a half-rendered control. Once `admin` is in
// `AppRouter`, the cast in `adminTrpc()` can go.
import { createApiClient } from "@countylens/api-client";
import { IsoDateTime, LiveRunV1 } from "@countylens/contract";
import { z } from "zod";
import { clearSession, loadSession } from "./session";

export const AdminMe = z.object({
  email: z.string().nullable(),
  groups: z.array(z.string()),
  isAdmin: z.boolean(),
});
export type AdminMe = z.infer<typeof AdminMe>;

export const RunCommandAck = z.object({ commandId: z.string().min(1), expiresAt: IsoDateTime });
export type RunCommandAck = z.infer<typeof RunCommandAck>;

/** `admin.runs.live`: the bridge's live status plus what the API itself last sent. */
export const AdminLive = LiveRunV1.extend({
  bridgeOnline: z.boolean(),
  lastSent: RunCommandAck.optional(),
});
export type AdminLive = z.infer<typeof AdminLive>;

const MetricValue = z.union([z.number(), z.string()]).nullable();

export const ActivitySummary = z.object({
  cachedAt: IsoDateTime,
  metrics: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      value: MetricValue,
      unit: z.string().nullable().optional(),
      /** The Logs Insights query that produced the number. */
      query: z.string().min(1),
      /** The CloudWatch console link with that query pre-filled. */
      consoleUrl: z.string(),
    }),
  ),
  perDay: z.array(z.object({ day: z.string().min(1), questions: z.number() })),
});
export type ActivitySummary = z.infer<typeof ActivitySummary>;

export type RunMode = "publish" | "dry_run";

interface Procedure<I, O> {
  query?: (input?: I) => Promise<O>;
  mutate?: (input: I) => Promise<O>;
}

interface AdminTrpc {
  readonly admin: {
    readonly me: { query: () => Promise<unknown> };
    readonly run: {
      readonly start: { mutate: (input: { mode: RunMode }) => Promise<unknown> };
      readonly stop: { mutate: (input: { commandId?: string }) => Promise<unknown> };
      readonly retry: {
        mutate: (input: { targetRunId: string; mode: RunMode }) => Promise<unknown>;
      };
    };
    readonly runs: { readonly live: { query: () => Promise<unknown> } };
    readonly activity: { readonly summary: { query: () => Promise<unknown> } };
  };
}
export type { Procedure };

export type AdminErrorCode =
  "UNAUTHORIZED" | "FORBIDDEN" | "CONFLICT" | "NOT_FOUND" | "UNAVAILABLE";

export class AdminApiError extends Error {
  override readonly name = "AdminApiError";
  constructor(
    readonly code: AdminErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Fixed wording for a refused command; the API's own text is never shown. */
export const ADMIN_TEXTS = Object.freeze({
  alreadyRunning: "A run is already running",
  signedOut: "Your session ended. Sign in again.",
  notAdmin: "This account is not an admin.",
  unavailable: "The admin service did not answer. Try again in a moment.",
  confirmPublish:
    "Start a real run? It publishes a new public run by CID, and published CIDs never change. Tick Dry run to rehearse without uploading.",
});

function adminTrpc(): AdminTrpc {
  const client = createApiClient({
    headers: () => {
      const session = loadSession();
      return session === undefined ? {} : { Authorization: `Bearer ${session.accessToken}` };
    },
  });
  return client as unknown as AdminTrpc;
}

/** Maps a tRPC client error (duck-typed, so no @trpc/client import here) to a typed one. */
export function toAdminError(error: unknown): AdminApiError {
  if (error instanceof AdminApiError) return error;
  const data = (error as { data?: { code?: unknown; httpStatus?: unknown } } | null)?.data;
  const status = typeof data?.httpStatus === "number" ? data.httpStatus : undefined;
  const code = typeof data?.code === "string" ? data.code : undefined;
  if (code === "UNAUTHORIZED" || status === 401) {
    clearSession();
    return new AdminApiError("UNAUTHORIZED", ADMIN_TEXTS.signedOut);
  }
  if (code === "FORBIDDEN" || status === 403) {
    return new AdminApiError("FORBIDDEN", ADMIN_TEXTS.notAdmin);
  }
  if (code === "CONFLICT" || status === 409) {
    return new AdminApiError("CONFLICT", ADMIN_TEXTS.alreadyRunning);
  }
  if (code === "NOT_FOUND" || status === 404) {
    return new AdminApiError("NOT_FOUND", ADMIN_TEXTS.unavailable);
  }
  return new AdminApiError("UNAVAILABLE", ADMIN_TEXTS.unavailable);
}

async function call<T>(
  schema: z.ZodType<T>,
  run: (api: AdminTrpc) => Promise<unknown>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await run(adminTrpc());
  } catch (error) {
    throw toAdminError(error);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AdminApiError("UNAVAILABLE", ADMIN_TEXTS.unavailable);
  return parsed.data;
}

export const adminApi = {
  me: (): Promise<AdminMe> => call(AdminMe, (api) => api.admin.me.query()),
  live: (): Promise<AdminLive> => call(AdminLive, (api) => api.admin.runs.live.query()),
  start: (mode: RunMode): Promise<RunCommandAck> =>
    call(RunCommandAck, (api) => api.admin.run.start.mutate({ mode })),
  stop: (commandId?: string): Promise<unknown> =>
    call(z.unknown(), (api) =>
      api.admin.run.stop.mutate(commandId === undefined ? {} : { commandId }),
    ),
  retry: (targetRunId: string, mode: RunMode): Promise<RunCommandAck> =>
    call(RunCommandAck, (api) => api.admin.run.retry.mutate({ targetRunId, mode })),
  activity: (): Promise<ActivitySummary> =>
    call(ActivitySummary, (api) => api.admin.activity.summary.query()),
};
