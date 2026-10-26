// Browser client of `agent.ask` (A-14 T033; contracts/agent-ask.md). The agent is its own Lambda
// behind the HTTP API route `/agent/{proxy+}` (infra AGENT_ROUTE_PATH); the Amplify rewrite
// `/api/<*>` forwards `/api/agent/ask` there. The tRPC mutation wire format (POST, JSON input,
// `{ result: { data } }` back) is used directly because `AppRouter` of @countylens/api-client
// holds the query API only; the browser never reaches a model provider, only this route. The
// response is validated with Zod, so a malformed body is an error, never a half-shown answer.
import { z } from "zod";

export const AGENT_ASK_PATH = "/api/agent/ask";

export const AGENT_OUTCOMES = [
  "answered",
  "failed",
  "paused",
  "throttled",
  "timed_out",
  "cancelled",
] as const;
export type AgentOutcome = (typeof AGENT_OUTCOMES)[number];

const MissingEntry = z.object({ field: z.string(), reason: z.string() });

/** One cited row (data-model.md `Match`): copied from the tool row's provenance by the server. */
export const AgentMatch = z.object({
  n: z.number().int().positive(),
  property_cid: z.string().optional(),
  permit_cid: z.string().optional(),
  permit_number: z.string().optional(),
  source_url: z.string().nullable(),
  captured_at: z.string(),
  table: z.string(),
  table_cid: z.string(),
  run_id: z.string(),
  manifest_cid: z.string(),
  as_of: z.string(),
  roof_age_years: z.number().optional(),
  roof_age_basis: z.string().optional(),
  roof_age_confidence: z.string().optional(),
  open_days: z.number().optional(),
  status_class: z.string().optional(),
  contractor_resolution: z.string().optional(),
  bbb_status: z.string().optional(),
  bbb_status_reason: z.string().optional(),
  missing: z.array(MissingEntry),
});
export type AgentMatch = z.infer<typeof AgentMatch>;

/** The one run an answer is about (contracts/agent-ask.md `run`); optional so an older server validates. */
export const AgentRun = z.object({
  run_id: z.string(),
  manifest_cid: z.string(),
  as_of: z.string(),
});
export type AgentRun = z.infer<typeof AgentRun>;

export const AgentAskResponse = z.object({
  answer: z.string(),
  how: z.string(),
  steps: z.array(z.object({ tool: z.string(), input: z.unknown(), summary: z.string() })),
  matches: z.array(AgentMatch),
  query: z.record(z.string(), z.unknown()),
  missing: z.array(MissingEntry),
  outcome: z.enum(AGENT_OUTCOMES),
  run: AgentRun.optional(),
  // ERR-63: observable budgets; optional so an older server still validates.
  modelCalls: z.number().optional(),
  outputTokens: z.number().optional(),
  durationMs: z.number().optional(),
  traceId: z.string().optional(),
});
export type AgentAskResponse = z.infer<typeof AgentAskResponse>;

export interface AgentTurn {
  readonly prompt: string;
  readonly outcome: string;
}

export interface AgentAskRequest {
  readonly prompt: string;
  /** Last four turns, client-held (no server conversation store, AD-09). */
  readonly turns?: readonly AgentTurn[];
  /** Values of edited "How I read this" chips, e.g. `{ tenure_years_min: 3 }`. */
  readonly overrides?: Readonly<Record<string, unknown>>;
  /** Pins the run the conversation compares against; omitted on turn 1. */
  readonly manifest_cid?: string;
}

export type AskAgent = (request: AgentAskRequest, signal: AbortSignal) => Promise<AgentAskResponse>;

export class AgentAskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentAskError";
  }
}

const Envelope = z.object({ result: z.object({ data: z.unknown() }) });
const ErrorEnvelope = z.object({ error: z.object({ message: z.string() }) });

/** Posts one question; throws `AgentAskError` for a transport or shape failure, and lets an abort
 *  propagate as the fetch `AbortError`. `fetchImpl` is injected by tests. */
export async function askAgent(
  request: AgentAskRequest,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentAskResponse> {
  const response = await fetchImpl(AGENT_ASK_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AgentAskError(`agent.ask answered HTTP ${response.status} with a non-JSON body`);
  }
  const ok = Envelope.safeParse(body);
  if (!ok.success) {
    const failure = ErrorEnvelope.safeParse(body);
    throw new AgentAskError(
      failure.success ? failure.data.error.message : `agent.ask answered HTTP ${response.status}`,
    );
  }
  const data = AgentAskResponse.safeParse(ok.data.result.data);
  if (!data.success) throw new AgentAskError("agent.ask answered with an unexpected shape");
  return data.data;
}
