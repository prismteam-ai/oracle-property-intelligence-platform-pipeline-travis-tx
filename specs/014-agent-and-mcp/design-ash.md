# A-14 agent design consult — ash (agent runtime, `agent.ask`)

Scope: the `agent.ask` tRPC procedure, `getModel()`, limits, conversation state, timeout layering, spend cap, outcome taxonomy, Explore · AI tab states. Read-only consult; MCP server internals and `query-core` tool implementation are `oracle`'s and `alakazam`'s areas respectively — this file only specifies the contract `agent.ask` needs from them.

## Components & files touched

- `apps/api/src/agent/ask.ts` — the `agent.ask` tRPC procedure (handler, orchestration loop via `ToolLoopAgent`/Vercel AI SDK `generateText` with `tools`, `stopWhen`/`maxSteps`).
- `apps/api/src/agent/getModel.ts` — provider switch (`AI_PROVIDER=bedrock|gateway`); no provider name anywhere else in `apps/api/src/agent/**`.
- `apps/api/src/agent/budget.ts` — DynamoDB spend-counter read/increment (one on-demand item per UTC day), 80% alarm wiring hook.
- `apps/api/src/agent/conversation.ts` — in-memory-per-request conversation-state shaping (client sends last 4 turns; server does not persist turns server-side — see below).
- `apps/api/src/agent/outcomes.ts` — the typed outcome union and the AbortSignal/timeout plumbing.
- `apps/api/src/agent/tools.ts` — thin adapters wrapping `packages/query-core`'s Zod tool schemas (`geocodePlace`, `searchProperties`, `searchRoofingPermits`, `getProperty`) as Vercel AI SDK `tool()` defs. Not this consult's area to design the SQL, only the adapter shape and step/row budget enforcement.
- `apps/web/src/routes/Explore/AiTab.tsx` (lands once A-13 merges) — Working… / answer / no-results / throttled / paused / timed-out / limit-reached states; this design keeps the `agent.ask` response shape stable so AiTab can be built against it today without the A-13 shell.
- `infra/CountyLensApi` (CDK) — agent Lambda function, DynamoDB spend table, CloudWatch alarm, API Gateway route + stage throttle for `agent.ask`.
- Powertools: `Logger`/`Tracer`/`Metrics` in `apps/api/src/agent/ask.ts`, one log line per tool call with latency, one trace segment per model call.

## `agent.ask` contract

**Request**
```ts
{
  question: string,
  turns: Array<{ role: "user" | "assistant", content: string }>, // last ≤4 turns, client-supplied
  context?: { area?: string, radiusMi?: number, roofYears?: number, openYears?: number, ...editableAssumptions },
  sessionQuestionCount: number, // client-tracked (sessionStorage), 0-based; server rejects if ≥10
}
```
Conversation state is **not** persisted server-side (no DB row per turn) — the client resends the last 4 turns plus any edited "How I read this" chip values as `context` on every call. This matches FR-004 ("remember… across at least the last few turns") without adding a stateful store the spend/lock layers don't already need, and matches AD-09's "one response, no streaming" model: each call is self-contained and idempotent-ish from the server's point of view.

**Response**
```ts
{
  answer: string,
  how: string,                 // "How I read this" prose
  steps: Array<{ tool: string, input: unknown, summary: string }>, // shown all at once (AD-09)
  matches: Array<{             // citation n → row n
    citationIndex: number,
    property_cid: string,
    source_url: string,
    run_id: string,
    captured_at?: string,
  }>,
  query: { area?: string, radiusMi?: number, roofYears?: number, permit?: string, openYears?: number },
  missing: string[],           // plain-language gaps, e.g. "contractor not printed on most permits"
  outcome: "answered" | "failed" | "paused" | "throttled" | "timed_out" | "cancelled",
  message?: string,            // present when outcome !== "answered"; the plain user-facing text
}
```
This matches `docs/02-design.md` § "Explore · AI" exactly (same field names, same outcome enum) and AC-1/AC-2/AC-12. Zod-validate both directions.

## `getModel()` / provider-switch design

```ts
// apps/api/src/agent/getModel.ts
export function getModel() {
  const provider = process.env.AI_PROVIDER; // "bedrock" | "gateway", no default fallback silently assumed
  if (provider === "bedrock") {
    return bedrock(process.env.BEDROCK_MODEL_ID!); // eu.anthropic.claude-sonnet-4-6, eu-north-1 inference profile
  }
  if (provider === "gateway") {
    return gateway(process.env.AI_GATEWAY_MODEL_ID ?? "anthropic/claude-sonnet-4.6");
  }
  throw new Error(`AI_PROVIDER must be "bedrock" or "gateway", got: ${provider}`);
}
```
`ask.ts` calls only `getModel()`; it never imports `@ai-sdk/amazon-bedrock` or the gateway package directly, and never branches on provider itself — satisfies constitution VI and AD-20. The gateway key comes from SSM SecureString (AD-14), read once at cold start, never logged. Switching providers is an env var change in CDK context + redeploy, not a code change — exercised by one of the edge cases (`AI_PROVIDER=gateway` → same answers).

## Limits & how enforced

| Limit | Enforcement |
| --- | --- |
| ≤ 6 tool steps | `ToolLoopAgent`/`generateText` `stopWhen: stepCountIs(6)` (AI SDK v5) or manual step counter incremented in the tool-call loop; once hit, loop exits and the model is asked to finalize with what it has — never silently truncated mid-answer. |
| ≤ 3 model calls | Explicit counter around each `generateText`/`streamText`-less call (no streaming per AD-09); increment before each Bedrock/Gateway invocation; abort the loop and return `outcome: failed` with message if a 4th would be needed. |
| ≤ 1,500 output tokens | `maxOutputTokens: 1500` passed to `getModel()` call options; AI SDK truncation is backstopped by instructing the model (system prompt) to be concise, since a hard token cut mid-sentence would violate "never a partial answer shown as complete" — so the prompt asks for citations+assumptions+missing-data in a bounded format that fits the budget, verified in Stage 0/golden-query evidence, not relied on as the only safety net. |
| ≤ 1,000 rows per tool call | Enforced inside each `query-core`-backed tool adapter in `tools.ts` (`LIMIT 1001`, `truncated` flag if the 1001st row exists), mirroring AD-21's MCP cap so the two surfaces agree (FR-011). |

All four counters are logged per request via Powertools `Metrics` (`toolSteps`, `modelCalls`, `outputTokens`, `durationMs`) so AC-5 (p95 < 20s, step/call/token ceilings) is checkable from CloudWatch without re-running golden queries.

## Conversation-state design

No server-side session store for turns (see contract above) — this keeps `agent.ask` stateless and Lambda-friendly, avoids a second state layer beyond the Chat-SDK-style guidance's general caution against ad hoc state, and avoids needing DynamoDB locking for a single-request-per-call API (there's no concurrent-message-to-one-thread problem here, unlike a chat-platform adapter). "That area" resolution works by:
1. Client includes the last ≤4 turns verbatim in `turns[]`.
2. Client includes the last-used `context` (area, radius, thresholds) as structured state, refreshed from the previous response's `query` field and any edited chips.
3. The system prompt instructs the model: "if the question refers to 'that area' or similar, use `context.area` unless the question names a new place."
4. `geocodePlace` is only called when `context.area` is absent or the question names a new place — this also keeps tool-step budget tight on follow-up turns (AC-2's G2 shouldn't re-geocode).

The 10-question-per-session cap (FR per Assumptions) is tracked client-side in `sessionStorage` and sent as `sessionQuestionCount`; the server independently re-validates nothing beyond honoring `outcome: answered` counting rules — only `answered` counts toward the 10, so a `paused`/`throttled`/`timed_out` call doesn't consume a question. This logic belongs in `AiTab.tsx`, not the server, per `docs/02-design.md` ("the 10-per-session count lives in `sessionStorage`; only `answered` counts").

## Timeout layering implementation

Four layers, outside-in, matching AD-09/AD-27 exactly:
1. **23s server abort** — `AbortSignal.timeout(23_000)` passed into the AI SDK call(s) and into every tool's underlying fetch/query. On abort, `ask.ts` catches the `AbortError`, returns `outcome: "timed_out"`, message "Took too long" with `Try again` / `Use Filters instead` actions, **before** Lambda itself would be killed. This is the layer that actually produces the honest typed outcome.
2. **25s Lambda timeout** — CDK `Function` prop `timeout: Duration.seconds(25)`, matching AD-11/AM-06's envelope for this Lambda (note: AM-06's 15s figure is the *separate* query/explore API Lambda, not this one — `agent.ask` keeps AD-09's 25s). This is the backstop if the 23s abort itself hangs (e.g., a stuck SDK promise); it ensures Lambda never silently runs past the HTTP API ceiling.
3. **25s client-visible stop** — the web client's own request timeout mirrors 25s so the UI shows "Took too long" even if the HTTP response never arrives (covers Lambda cold-start-plus-throttle edge cases where the 23s abort response itself doesn't make it back in time).
4. **29–30s HTTP API ceiling** — API Gateway's hard integration timeout; this is a safety net only, never the layer that should fire in normal operation — if it does, that's a bug in layer 1, worth alarming on separately (a CloudWatch metric filter or Gateway 5xx alarm, flagged as a risk below since AD-16 doesn't explicitly cost this one).

Code shape:
```ts
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 23_000);
try {
  const result = await generateText({ model: getModel(), tools, abortSignal: controller.signal, ... });
  return { ...shapeResponse(result), outcome: "answered" };
} catch (e) {
  if (isAbortError(e)) return { outcome: "timed_out", message: "Took too long", ... };
  if (isThrottleError(e)) return { outcome: "throttled", message: "...", ... };
  throw e; // unexpected — Lambda error, not swallowed as a fake outcome
} finally {
  clearTimeout(timer);
}
```

## Spend-cap + alarm design (CDK resources)

- **DynamoDB table** `CountyLensAiSpend` (on-demand billing, no provisioned capacity — zero idle cost per AD-13): one item per UTC day, key `date` (e.g. `2026-10-22`), attribute `spendCents` (or `callCount` × a fixed per-call cost estimate if real per-token billing isn't queryable in real time — token-based estimate is more honest; use output+input token counts × the Bedrock/Gateway per-token rate for the active provider, summed via a conditional `UpdateItem` with `ADD spendCents :delta`).
- Before each model call, `budget.ts` does a `GetItem` for today's key; if `spendCents >= $3.00 equivalent`, return `outcome: "paused"` immediately without calling the model (never a half-run). After each successful call, `UpdateItem` with the delta.
- **CloudWatch alarm**: a custom metric (`Metrics.addMetric("aiSpendCents", ...)` via Powertools, or an EMF-derived metric from the Lambda logs) compared against 80% of $3.00 ($2.40); alarm action per constitution IX (PagerDuty Events API v2 or documented substitute — likely just an SNS→email given this is a take-home, documented as the substitute).
- `ai.status` tRPC procedure (already in `docs/02-design.md`) reads the same DynamoDB item to return `{ paused, resetsAt }` to the client for a pre-emptive "limit reached" banner, so the UI doesn't have to wait for a failed `agent.ask` call to learn it's paused.
- This is the same DynamoDB-per-UTC-day-item pattern named in `docs/02-design.md` § "Hosted state, $0.00 fixed per month" — no new infra pattern invented.

## Outcome taxonomy and how to trigger each for testing

| Outcome | Trigger condition | How to produce it on the deployed endpoint for real (no fake test data) |
| --- | --- | --- |
| `answered` | Normal path | Any golden query G1–G5 |
| `failed` | Unexpected error (bad tool input rejected by Zod, model returns something unparseable) | Send a malformed `context` object that fails Zod validation server-side (real validation failure, not a mocked one) |
| `paused` | Daily spend cap reached | Drive the real DynamoDB counter to the cap by issuing enough real golden-query calls against the deployed endpoint in one UTC day (document the token math so the count is reproducible and cheap — e.g. run G1–G6 repeatedly until the $3 counter trips), or temporarily lower `AI_DAILY_CAP_CENTS` via an env var for a verification run and restore it after — this is a config change, not synthetic data, and should be logged in the evidence file as "cap temporarily lowered to $0.05 for this verification, restored after" |
| `throttled` | Bedrock's real 10 req/min limit | Fire 11+ real concurrent golden-query requests at the deployed endpoint within one minute; Bedrock's `ThrottlingException` surfaces as `outcome: throttled` — this is a genuine provider throttle, not simulated |
| `timed_out` | 23s abort fires | Ask a real but deliberately broad/slow question (e.g. a countywide multi-filter query forcing more tool steps/larger scans) against the deployed endpoint and let the real 23s abort trip; alternatively, temporarily set the abort to 1s via env var for one verification call (documented the same way as the spend-cap test) then restore — again a config change on real infra, not fabricated output |
| `cancelled` | User clicks Cancel during Working… | Playwright: click the Cancel button shown during the real Working… state on the hosted AI tab |

All of these are triggered by manipulating real config/timing against the live deployed Lambda — never by hand-crafting a fake `outcome` value in a mock, consistent with "no synthetic data presented as real" (CLAUDE.md) and the design-sample-data-not-reviewed memory rule, which is about prototype sample data, not about this kind of real-infra fault injection.

## AI tab states

Mapped 1:1 to prototype screens already named in the story (`ExploreQ-ai`, `ExploreQ-aiworking`, `ExploreQ-aicontractor`, `ExploreQ-aislow`, `ExploreQ-ailimit`, `ExploreQ-aipaused`, `HelperStates`) and to `outcome`:

| UI state | Driven by |
| --- | --- |
| Working… | request in flight; elapsed timer + Cancel button (Cancel = abort the fetch client-side, no server outcome needed, or surfaces as `cancelled` if the server already responded) |
| Answered | `outcome: "answered"` — answer, "How I read this" editable chips, citations [n] ↔ `matches[]` rows |
| No results | `outcome: "answered"` with empty `matches[]` and non-empty `missing[]` (AC-3, AC-4 G6) |
| Throttled | `outcome: "throttled"` |
| Paused | `outcome: "paused"` (daily cap) — also proactively shown from `ai.status` |
| Timed out | `outcome: "timed_out"` — "Took too long", Try again / Use Filters instead |
| Limit reached | client-side `sessionQuestionCount >= 10`, blocks the call before it's even sent |

Because A-13's shell isn't merged yet, this response contract is the thing AiTab.tsx will bind to once it lands — no component code assumed here, only field names and the outcome enum, which already match `docs/02-design.md`'s `Explore · AI` row verbatim.

## Risks

- **Lambda concurrency (flagged per this run's environment check).** The account's `ConcurrentExecutions` **and** `UnreservedConcurrentExecutions` are both 10, account-wide, not per-stack. AD-11 says reserved concurrency only if the account allows it; it does not here — reserving even 3 for `agent.ask` would starve every other Lambda in the account (query/explore API, MCP server, admin, pipeline bridge) down to 7 shared slots, and CDK would need to budget reserved concurrency across *all* functions summing to ≤10, which this account cannot safely do with a single-digit margin. **Recommendation: no reserved concurrency on `agent.ask`** (matches AM-06's existing precedent for the query API Lambda — "no reserved concurrency, account limit 10"). Rely instead on: API Gateway stage throttle (burst/rate limit) in front of `agent.ask`, the DynamoDB spend cap as a cost backstop, and Bedrock's own 10 req/min limit as the natural concurrency ceiling for the only expensive part of this path. Document this as consistent with the existing AM-06 decision rather than a new deviation.
- **Token-budget truncation vs honesty.** A hard `maxOutputTokens` cut could in principle land mid-citation-list; mitigated by prompting for a bounded answer shape and verifying against golden queries, but worth a dedicated test case (ask a maximally broad question and confirm the answer is never truncated mid-sentence/mid-citation).
- **23s abort racing Lambda's 25s.** If the model call's internal retry/backoff ignores `abortSignal` (some SDK paths), the 23s layer could fail to fire cleanly; verify the AI SDK's Bedrock/Gateway providers honor `abortSignal` end-to-end in Stage 0, not assumed.
- **HTTP API 29-30s ceiling firing in practice** would present as a raw Gateway timeout (likely a 503) rather than a typed outcome — this is explicitly supposed to never happen per AD-27, so any real occurrence should alarm, which isn't currently budgeted; flagged for `oracle`/`alakazam`/metagross to confirm whether an extra Gateway-5xx alarm is in scope or accepted as an untested edge.
- **Provider parity edge case.** Gateway fallback requires a paid top-up per CLAUDE.md; the "no visible change in behavior" requirement (edge case) can only be verified once that top-up exists — until then this is config-verified by code inspection (one `getModel()` switch point) rather than a live A/B, which should be stated plainly in evidence rather than implied as fully tested.

## How to verify on the hosted URL

1. **Golden queries G1–G6** (`checks.md` § 7.1) as Vitest against the deployed `agent.ask` endpoint (not localhost) — groundedness (every `property_cid` exists in published data), correctness (≥80% recall vs re-run `query-core` SQL), honesty (assumptions + missing data stated in `answer`/`missing[]`), G6 empty + out-of-scope message. Commit results + trace IDs to `docs/evidence/A-14-agent.md`.
2. **Provider confirmation** — one live call with `AI_PROVIDER=bedrock` showing a real Bedrock trace in LangSmith/Powertools (Bedrock quota is new-account-fresh per CLAUDE.md, so Stage 0 must re-check it with a real call, not assume quota from the support case ticket).
3. **Conversation memory** — run G1 then G2 in the same session (reusing `turns[]` + `context`) and confirm G2's answer references "that area" correctly without a fresh `geocodePlace` tool step (check `steps[]` in the response).
4. **Outcome taxonomy** — exercise `paused`, `throttled`, `timed_out` per the table above against the live endpoint with documented, reversible config changes; capture request/response pairs + the restored config value in the evidence file.
5. **Limits** — confirm via Powertools-logged metrics (`toolSteps`, `modelCalls`, `outputTokens`, `durationMs`) across the G1–G6 run that no call exceeded 6 steps / 3 model calls / 1,500 tokens, and p95 duration < 20s.
6. **Spend cap + alarm** — confirm the DynamoDB daily item increments correctly across the verification run, and that the CloudWatch alarm's 80% threshold is reachable and fires (can be checked by temporarily lowering the cap, as above).
7. **AI tab states** — Playwright against the hosted URL, one test per state (Working…, Answered, No results, Throttled, Paused, Timed out, Limit reached), per `responsive-design-tests`/`smeargle` conventions once A-13's shell lands; until then, contract-level tests (direct `agent.ask` calls asserting `outcome` values) stand in.
8. **Cross-surface agreement (FR-011)** — compare `agent.ask`'s `matches[]` `property_cid`s against the Explore page's `explore.search` result for the same question/run, and against the MCP server's `search_properties` result once `oracle`'s MCP Lambda is live, per AC-8.
