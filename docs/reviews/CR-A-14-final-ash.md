---
id: CR-A-14-final-ash
story: A-14
reviewer: soofi-xyz-team-kit:ash (read-only)
reviewed_commit: 3be4ff9
previous: 88 on cf741bd
score: 84
---

# CR-A-14 final review, ash (agent runtime and AI tab)

Score: **84 / 100** (gate needs 75: PASS). No Critical finding. Two Major findings, both about spend accounting, not about outcomes or honesty.

## Scope read
apps/api/src/agent/{ask,abort,spend,model,router,observability,citations,tools}.ts, handlers/agent.ts, apps/web/src/data/agent-ask.ts, apps/web/src/routes/ExploreAi.tsx and ExploreAi.state.ts, tasks.md Phase 6, CR-A-14.md. Recorded exceptions (full-county timeout, ERR-64) were not scored as defects.

## What improved since cf741bd
- Real 23 s abort: `raceAbort(execute(), signal)` (ask.ts:774, abort.ts:19) covers every await, and tools race the signal too (tools.ts:131,150,166,180). A hung tool ends as `timed_out`.
- Never a 5xx: the catch (ask.ts:775-791) maps abort, throttle and everything else to fixed-text outcomes; the error detail goes to the log only. Input Zod errors stay a 4xx, which is correct.
- Reservation release in `finally` for held reservations (ask.ts:792-803), release uses `reservedAt`, so a midnight crossing hits the right day. `settled` is set before the true-up await, so the normal path cannot release and settle twice.
- Incomplete loops never surface planning text (ask.ts:689-711). Citations are post-checked; `how`/`query`/`missing` come from tool envelopes only.
- Vercel AI SDK only: model.ts is the single `AI_PROVIDER` site. Powertools logger/tracer/metrics are the same singleton used by the middy stack.

## Findings

### Major
1. **Real model spend is erased on timeout, throttle and late failure (ask.ts:793-803, spend.ts:150-166).** The reservation is released in full whenever the request did not finish. A request that ran 2 of 3 steps and was aborted at 23 s, or throttled on step 2, has already been billed for tokens, but the cap and the `AiSpendUsd` alarm see $0. A client that triggers slow or aborting prompts can spend without limit against the $3 cap. Fix: release only when no model call returned usage. Otherwise keep the reservation as the cost estimate.
2. **Cost estimate is not conservative (ask.ts:115, 623).** It is a flat $3 per million on `totalTokens`. Sonnet-class output tokens cost about 5x input, so a long answer is under-counted by roughly 2x or more. The comment says "conservative", which is false. The cap and the alarm therefore fire later than $3 / $2.40 of real spend. Fix: price input and output separately (usage has both) or use a higher blended rate.

### Minor
3. **Reservation leaks in two corners (ask.ts:577-585).** (a) If the abort fires while `reserveSpend` is in flight, `finally` runs with `reservation === "none"`, and the DynamoDB write lands afterwards and is never released. (b) If the reservation itself pushes `spent_usd` to or over the cap, the code returns `paused` with the reservation kept, and a request that was under the cap before it is refused. Both are small ($0.05) but are exactly the "failed/timed_out must release" case. Fix: set `reservation = "held"` before awaiting `reserveSpend` and treat the result after, and release when `paused` came from a successful reservation.
4. **The losing `execute()` keeps running after the abort (abort.ts:13-14).** `finally` can release while the background body later reaches `reservation = "settled"` and `recordSpend`. With the real `generateText` and an aborted signal this cannot happen, but with a tool or custom loop that ignores the signal it would double-adjust (release plus true-up, a net negative). A `settled`/`released` guard on the shared flag, checked after each await in `execute`, would close it.
5. **A DynamoDB failure after a good answer discards the answer (ask.ts:624-632).** `recordSpend` throwing turns an answered request into `failed` after tokens were spent. Also, `isThrottleError` (ask.ts:265-268) matches any "throttl" message, so a DynamoDB or S3 throttle is reported as "The model is busy right now", which is wrong about the cause.
6. **Deterministic honesty sentences can overstate (ask.ts:370-373, 738-751, 729-737).**
   - The BBB sentence "BBB status is not available in the published data" is added whenever any match carries a `bbb_status`, because the row-level status is pushed into `missing` as `bbb_status`. If a row carries a real status, the sentence contradicts it. Not reproduced; depends on the data.
   - "I read the open-time threshold as at least N years" fires on "many years" even when the question is about owner tenure, if `open_years_min` was set for another reason.
   - "Permit X was not found in this run" (ask.ts:674) is stated after a `limit: 1` exact lookup without checking `truncated` or `empty_reason`.
   - `asksContractorOrBbb` is a keyword match, so "permits with no contractor listed" gets the "not printed" claim. T049 (derive flags from filters and results) covers this and is deferred; I agree with the deferral for the demo.
7. **Client-sent text goes to the model unbounded (ask.ts:51-60, 482-484).** `turns[].prompt`, `turns[].outcome` and `overrides` have no length limit and `overrides` is JSON-stringified into the system prompt. This is prompt-injection surface and token cost the reservation does not cover. T040 (overrides applied deterministically) is deferred. Cheap interim fix: `.max(500)` on turn prompts, an enum on `outcome`, and a key allowlist on `overrides`.
8. **Doc drift (model.ts:32-34).** The comment says a bad `AI_PROVIDER` "fails at cold start". `getModel` is called inside `execute`, so it fails per request as `failed`. Behaviour is safe, wording is wrong.

### Checked and found sound
- No internal text in responses: `failed`, `timed_out`, `throttled` and `paused` use fixed strings. The web client shows `unreachable` without the server error message.
- Web: the 25 s client stop and Cancel are separate from the server 23 s; `used` counts only `answered`; `turns` are capped at 4; stale responses after cancel or timeout are ignored (ExploreAi.tsx:189).
- Deferred tasks T038-T040, T042-T050 are honest gaps, none touches a gate-critical path. T043 (SpendAlarm to the Ops SNS topic) means the alarm cannot notify yet. That raises the weight of findings 1 and 2.

## Verified by running
`pnpm exec vitest run` in apps/api: 19 files, 294 passed, 1 skipped. In apps/web: 44 files, 533 passed, 1 skipped. Release tests exist (agent-ask.test.ts:298-330: answered trues up, abort/throttle/failure/bind-failure release once).

## Not verified
Deployed behaviour (not allowed): real Bedrock token usage versus the estimate, the 23 s abort on the hosted route, API Gateway limits. The corner cases in findings 3-5 are from reading the code, not reproduced by a test.
