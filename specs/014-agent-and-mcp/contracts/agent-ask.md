# Contract: `agent.ask` (tRPC procedure, Lambda)

Owner: `ash`. Full detail: `../design-ash.md`. Shared types: `../data-model.md`.

## Request

```ts
{
  prompt: string;                 // the plain-language question
  turns?: { prompt: string; outcome: string }[]; // last ≤4 turns, client-sent (no server conversation store)
  overrides?: Record<string, unknown>;            // from an edited "How I read this" chip, e.g. { tenure_years_min: 3 }
  manifest_cid?: string;           // CIDv1; pins the run this conversation compares against. Omitted on turn 1 → latest.
}
```

## Response (one response, no streaming — AD-09)

```ts
{
  answer: string;                 // model-written prose, citing [n]
  how: string;                    // server-built: centre label + source, radius, thresholds from `applied`
  steps: { tool: string; input: unknown; summary: string }[]; // ≤ 6
  matches: Match[];                // server-built from tool provenance, never from model text
  query: Record<string, unknown>;  // the resolved applied filters (echoes query-core's `applied`)
  missing: { field: string; reason: string }[];
  outcome: "answered" | "failed" | "paused" | "throttled" | "timed_out" | "cancelled";
  // Optional; present on every response produced after the run was bound (answered, no results,
  // failed/timed_out/throttled after bind). Absent on paused and on failures before the bind.
  // The UI shows it as one provenance line, so an empty answer is visibly about one named run.
  run?: { run_id: string; manifest_cid: string; as_of: string };
  // Optional observability fields (ERR-63; absent on paused/throttled/timed_out except durationMs/traceId):
  modelCalls?: number;   // model calls this turn (AC-5 ceiling 3)
  outputTokens?: number; // output tokens this turn (AC-5 ceiling 1,500)
  durationMs?: number;
  traceId?: string;      // X-Ray trace id (`_X_AMZN_TRACE_ID` Root), no secrets
}
```

## Limits (enforced server-side, not by the model)

- ≤ 6 tool steps, ≤ 3 model calls, ≤ 1,500 output tokens per answer (AC-5).
- Timeout layering (AD-27): 23 s `AbortSignal.timeout` → `outcome: "timed_out"`; 25 s Lambda timeout; 25 s client stop; 29–30 s HTTP API ceiling (should never fire).
- $3/day spend cap (DynamoDB counter, checked before each model call) → `outcome: "paused"` with a `resetsAt` (next UTC day).
- Bedrock throttling (10 req/min account-wide) → `outcome: "throttled"`.
- Never a 5xx; never a partial answer returned as `"answered"`. A loop that ends without a final text answer (budget spent on tool calls, token cut-off) returns `outcome: "failed"` with `answer` stating which calls were tried, `matches = []` and `missing = [{field:"result", reason:"incomplete"}]`; planning text is never surfaced.
- Filters are never changed silently: if the model changed a filter between calls (or widened `open` to `open_or_stalled`), `answer` and `how` state the change.
- `how` also states `Run <run_id>, as of <date>` and, when a tool envelope's `area` carries a `gazetteer` stamp, `Gazetteer travis-places@<version> (sha256 <first 12 hex>…)` read from the envelope (never a constant). The system prompt tells the model to say "in this run", never "in the published dataset" or "in the data" as a general claim.
- `missing[]` response-level entries use `field: "result"` with a reason that documents why the result is empty or partial. These are not row-level contract reasons; the UI renders them as plain words: `no_match` (complete search, zero rows), `not_found` (exact lookup, no such record), `out_of_scope` (place or area outside Travis County), `field_not_published` (a filtered field is not in the export), `truncated` (more rows than the cap), `incomplete` (no final answer within the budget), `run_not_found`, `unknown` (a filtered field was null for some rows). Counts the tool reports in `unknown_excluded` appear as one entry per non-zero key: `roof_age_years`-style filtered fields use `unknown`; `property_link` uses "permit has no matching property row"; `coordinates` uses "property has no coordinates". The answer then also says in one plain sentence how many records could not be placed in the radius.
- A match with a real `bbb_status` (`rated`, `not_found`, `blocked`) adds no `bbb_status` entry; for `not_checked`, `unavailable` or no BBB data there is exactly one `bbb_status` entry (the match's `bbb_status_reason` when it has one, else `no_lexicon_carrier`).
- `missing[]` uses contract names: `contractor.name_as_printed`, `bbb_status`, `owner_is_out_of_area` (`not_in_export`; the owner mailing location is not in the published export).

## Error / empty behavior

- Every citation `[n]` in `answer` must correspond to `matches[n-1]`; any out-of-range or unregistered citation is stripped server-side before the response is sent (never shown to the user as a broken reference).
- `matches = []` with `outcome: "answered"` and `query.empty_reason`/`missing[]` set is the correct shape for "nothing found" / "out of scope" / "can't tell" — never `"failed"`.

## Verify on the hosted URL

See `../design-ash.md` § "How to verify on the hosted URL" and `../quickstart.md`.
