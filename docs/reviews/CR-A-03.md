---
id: CR-A-03
type: code-review-log
story: A-03
branch: 003-walking-skeleton
reviewed_commit: 327c11f (oracle and metagross re-scores; /code-review high and the final reviews at 570285d; early review 071eb1b)
tools: [soofi-xyz-team-kit:oracle, soofi-xyz-team-kit:metagross, /code-review]        # /code-review ultra once per repo before G8
created: 2026-10-21
---

# Code Review Log: A-03 Walking skeleton

Run `/code-review` (with `--fix` if you want it to apply fixes) on the story branch before the G7 pre-check. Record every finding. Run `/code-review ultra` once per repo, on the feature branch, before G8. It runs in the cloud and uses paid credits, so you have to start it yourself.

## Runs

| Run | Tool | Effort | Date | Commit | Findings | Score |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `soofi-xyz-team-kit:oracle` (read-only, early review of the publish track; W3 G-R1 T045) | n/a | 2026-10-21 | `071eb1b` | 13 (0 Critical, 2 Major, 10 Minor, 1 note) | **84 / 100** (pass) |
| 2 | `/code-review` (whole branch, read-only) | high | 2026-10-21 | `570285d58c27ee33866a36460e6fda0800913415` | 10 (0 Critical, 4 Major, 6 Minor) | n/a (all 4 Majors fixed in `327c11f`; see "Fixes (/code-review)") |
| 3 | `soofi-xyz-team-kit:oracle` (final review, whole branch) | n/a | 2026-10-21 | `570285d` | F-1 to F-7 (1 Critical: F-1) | 72 / 100 (fail: F-1 open) |
| 4 | `soofi-xyz-team-kit:metagross` (final review, whole branch) | n/a | 2026-10-21 | `570285d` | M1–M6, m7–m11 | 70 / 100 (fail until findings 1–4 fixed) |
| 5 | `soofi-xyz-team-kit:oracle` (re-score, whole branch) | n/a | 2026-10-21 | `327c11f0972ad5574252766250924335d882f543` | N-1 to N-4 (0 Critical, 0 Major) | **88 / 100** (pass) |
| 6 | `soofi-xyz-team-kit:metagross` (re-score, whole branch) | n/a | 2026-10-21 | `327c11f0972ad5574252766250924335d882f543` | N1–N4 (0 Critical, 0 open Major) | **81 / 100** (pass) |

## Findings

OR-n = oracle reviewer (run 1). Later runs append their own prefixes (CR-n, DP-n, …).

| # | Severity | File:line | Finding | Resolution | Commit |
| --- | --- | --- | --- | --- | --- |
| OR-1 | Major (before D-8) | `pipeline/publish/src/sequence.ts:434`, `pipeline/publish/src/upload.ts:228`, `pipeline/publish/src/cli.ts:206-222` | The D-8 approval artifact is not pinned: `build` prints roots, sizes and SHA-256s to stdout only; `upload` re-runs phase 1 (`hash` fetches the live lexicon) and overwrites `reports/sequence.json`, and nothing compares the re-made phase-1 outputs with what the PO approved. The first public upload is the one irreversible act (published CIDs never change). | Open | — |
| OR-2 | Major (before G7) | `pipeline/publish/test/publish-order.test.ts:251-268`, `pipeline/publish/src/sequence.ts:501`, `tests/e2e/build-checks.spec.ts:68-82` | G6-approved TC-002(b) ("calls `upload` before `export-tables` → an out-of-order error naming both steps") is not asserted anywhere; only sub-case (a) is. The harness passes on any test name matching `/skip\|fail/`. The orchestrator has a one-sided guard (`upload-tables` only). | Open | — |
| OR-3 | Minor | `pipeline/publish/src/sequence.ts:450-457` | The six CAR check counts the pinned CLI prints ("CAR Validation Report", `dist/commands/validate.js`) are not kept: `StepRecord` has no stdout, so the required per-group evidence ("six CAR checks") must be copied by hand. | **Re-targeted → A-11** (G7, 2026-10-21; see "OR-3 and OR-11 at G7") | — |
| OR-4 | Minor | `pipeline/publish/src/upload.ts:270-280` | The `carCid` adds (AM-05) get a node-side Hash check but no gateway readback before the manifest and index are written; FR-001 says each upload is followed by readback. `verify-manifest` covers it only after `runs/` exists. | Open | — |
| OR-5 | Minor (before A-11) | `pipeline/publish/src/sequence.ts:492` | `dataGroupCids` is recorded but never asserted to be exactly {seed root, group root}; A-11's `export-tables --atlas-page` requires exactly one non-seed schema. | Open | — |
| OR-6 | Minor | `pipeline/publish/src/verify.ts:209` | `fetch` follows redirects by default; the request log (TC-040 step 3) records the pre-redirect URL only, so a gateway redirect to a non-allowlisted host would pass unseen. | Open | — |
| OR-7 | Minor | `pipeline/publish/src/sequence.ts:414`, `:444` | The redaction set for `reports/sequence.json` is `secretValues(env)` only; the composed Filebase bearer (base64 of key:secret:bucket) that `upload.ts:207` and `kubo-add.ts:90` do redact is missing here. | Open | — |
| OR-8 | Minor | `pipeline/publish/src/cli.ts:134` | A stray `IPFS_API_TOKEN` in the operator env satisfies the credential check while argv pins `--api https://rpc.filebase.io` (`sequence.ts:38,258`); a local-kubo token would reach Filebase and fail only after phase 1. | Open | — |
| OR-9 | Minor | `pipeline/oracle-runtime/travis/adapters/socrata/socrata.ts:15-16`, `pipeline/oracle-runtime/travis/lib/source-client.ts:6-7` | A timeout is mapped to `blocked` and exit 2. `contracts/cli.md` defines exit 2 as "the first HTTP 403 or bot challenge"; a timeout is not evidence of a block and would be reported as one. | Open | — |
| OR-10 | Minor | `pipeline/publish/src/manifest.ts:275-285`, `pipeline/oracle-runtime/travis/runs/run-month.ts:702` | `sources[0].records` is the count of ok lines in the shared `jobDir/receipts.jsonl` (appended across runs, `socrata.ts:25`); a permit re-captured after its body changed is counted twice, so `records` can differ from `summary.counts.captured`. | Open | — |
| OR-11 | Minor | `pipeline/publish/src/readback.ts:144-229`, `pipeline/publish/src/verify.ts:196-242` | Two gateway-GET implementations with different policies (404 retried in readback, not in verify; 2 s vs 1 s base). Drift risk. | **Re-targeted → A-11** (G7, 2026-10-21; see "OR-3 and OR-11 at G7") | — |
| OR-12 | Minor (evidence) | agent-design oracle § 4 | The determinism proof asked for (`export-tables` twice on the same CAR → same tables root) has no test or evidence yet; A-11 relies on it. | Open | — |
| OR-13 | Note | ARD AD-22, § 8 | Second pin and GitHub Release CARs are not in A-03 (oracle risk 5). Not a code defect; the evidence must say "one pin" and the release step must schedule them. | Open | — |

### OR-3 and OR-11 at G7

Both were deferred "to G7" (early review fixes, final review, re-score at `327c11f`). Neither is fixed: no commit in `327c11f..fe2b26a` touches `pipeline/publish/src/sequence.ts`, `readback.ts` or `verify.ts`. At `fe2b26a`, `StepRecord` (`sequence.ts:90-100`) still has no stdout, and `readback.ts` `getDigest` and `verify.ts` (`redirect: "manual"`) still have separate GET policies; there is no shared `gateway-get.ts`. Both are Minor and block no A-03 acceptance criterion: TC-001–006 and TC-040–043 pass on the hosted runtime. They are re-targeted, not carried over silently:

| # | New target | Reason |
| --- | --- | --- |
| OR-3 | **A-11** (Publish the full county as verifiable CIDs, branch `011-full-publish`, builder and reviewer `oracle`) | A-11 AC-1 makes every data group of the full county pass the six publish steps in order, with a test. A-11 reworks `sequence.ts` for those groups, so the step record is the place to keep the six CAR check counts. A-03 has two groups, and their counts are recorded by hand in `docs/evidence/A-03.md`. |
| OR-11 | **A-11** (same story) | A-11 AC-3 and AC-5 define the gateway policy that one shared `gateway-get.ts` must carry: verify on two gateways, retry with backoff on 429, 504 or timeout, and report `unverified` without a digest match. Merging the two GET paths now would change `verify-manifest` behaviour after TC-040–043 passed on the hosted runtime. A-11 re-tests it at full scale. |

## Constitution and architecture check

| Rule | Result | Note |
| --- | --- | --- |
| Zod on every tRPC input; no `any` | ✅ | No tRPC in this track. External inputs are Zod-parsed: `summary.json` (`upload.ts:54`), upload summaries (`readback.ts:33,43`), manifest and index (`verify.ts:287`, `cid-copy.ts:282`, `runs-index.ts:60`), receipts (`manifest.ts:145`). No `any`, `@ts-ignore` or `eslint-disable` in the reviewed sources. |
| LLM calls only through the Vercel AI SDK | n/a | No LLM call in the publish track. |
| Powertools logger, tracer and metrics in every Lambda | n/a | No Lambda in this track (operator CLIs and the local run script). |
| No secrets or PII in code or logs | ✅ | Credentials reach the CLI only through the child env (`sequence.ts:8-9,186-196,210`); every printed line passes `redact()` (`cli.ts:157-173`); the bearer is only a header (`kubo-add.ts:97`); tests assert no secret in argv or any report (`publish-order.test.ts:305`, `upload.test.ts:600`). See OR-7 for one gap. |
| P0 rules in `docs/architecture-constitution.md` | ✅ | P0-1/-2/-3/-4/-7/-9/-14/-15/-17 checked below; no breach found. |

**Open Critical findings:** 0

---

## Early review: publish (W1–W2, oracle)

Reviewer: `soofi-xyz-team-kit:oracle`, read-only, 2026-10-21, commit `071eb1b`. Skills loaded: `use-oracle` (with `reference/car-publication.md`), `apply-engineering-guidelines`. Scope: `git diff feature/oracle-pipeline...HEAD -- pipeline/ packages/shared packages/query-core scripts/verify-manifest.ts scripts/grep-gates.sh` plus the files themselves (`pipeline/oracle-runtime/travis/adapters/**`, `travis/runs/run-month.ts`, `pipeline/publish/src/**`, `pipeline/publish/test/**`, `scripts/verify-manifest.ts`). Judged against ARD A1/A2/A6, AD-01/03/04/22/24–26, P0-1/2/3/4/14/15, § 7–9, § 16 AM-01/04/05; the constitution's Task A addendum; spec FR-001/006/012/014 and "Fixed texts"; `contracts/cli.md`; `agent-design.md` (oracle section and Spike delta); test cases AC-1 and AC-6.

### Score: 84 / 100 (pass; the bar is 75)

### Verdict

The services and seams are the ones I would choose. `sequence.ts` is a pure plan (`planBuild`/`planPublish` read no input, `sequence.ts:249-351`) run by an executor that stops on exit code, missing output or an unparseable root (`:459-481`); `readback.ts`, `kubo-add.ts`, `manifest.ts`, `runs-index.ts`, `verify.ts` and `cid-copy.ts` are single-purpose, take injectable `fetch`/`run`/`sleep`/`random`, and the AWS SDK is loaded only by `cid-copy` (`cli.ts:275-277`). The Socrata adapter is split as designed: generic `socrata.ts` plus an `austin-3syk-w9eu.ts` that holds only coordinates and the month window, with the include predicate generated by the profile (`austin-3syk-w9eu.ts:33`). `run-month.ts` drives the adapter directly per PO decision D-5 and records why (`run-month.ts:2`). Nothing publishes outside `elephant-cli` output plus the descriptive manifest and index.

### Guardrails, with evidence

| Guardrail | Result | Evidence |
| --- | --- | --- |
| Only `elephant-cli` output becomes public (A2, P0-1, P0-2, AD-01) | ✅ | `publicFiles` = archive CAR, `tables.car`, parts (`upload.ts:123-129`); the manifest is built from CLI outputs, receipts and `summary.json` only (`manifest.ts:1-3`); `pipeline/publish` has no `pg`/`postgres`/`DATABASE_URL` (test `manifest.test.ts:507`, gate `grep-gates.sh:121-124`). |
| Fixed step order, no skip on any size (P0-2, FR-001) | ✅ | 12-step plan, phase 1 for both groups before any upload (`sequence.ts:341-351`); plan identical for an empty and a 2,000-file group (`publish-order.test.ts:294`); no skip/dry-run flag or env switch (`cli.ts:92-103`, `publish-order.test.ts:270`); each of the 12 steps failing stops every later call (`publish-order.test.ts:251`). |
| CIDv1 only (A3, P0-3) | ✅ | Printed roots must match `b[a-z2-7]+` (`sequence.ts:131-132`); contract `CidV1` on every artifact; `cidCopyKey` refuses non-CIDv1 (`cid-copy.ts:89-93`); `kubo add` with `cid-version=1&raw-leaves=true` and Hash must equal the local CID (`kubo-add.ts:17,110-112`). |
| No IPNS, no `coverage.json` (AD-03, AD-04) | ✅ | Contract superRefine rejects IPNS keys and gateway URLs (`packages/contract/src/manifest.ts:99-112`); counts live only in manifest `coverage` (`run-month.ts:635-694`); `runs/index.json` is append-only (`runs-index.ts:29-48`, tests `manifest.test.ts:591-658`). |
| Secrets never on argv or in logs (P0-17) | ✅ (OR-7) | `assertCleanArgv` refuses `--token`, `--pinata-jwt`, `--atlas-page` and any secret value (`sequence.ts:186-196`); env file loaded into the child env only (`cli.ts:131-150`); `Printer.protect` redacts the composed token (`cli.ts:163-166`). |
| Query DB never imported (P0-1, § 9) | ✅ | `grep-gates.sh:119-124`; `manifest.test.ts:507-531`; `pipeline/publish/package.json` adds only `@aws-sdk/client-s3`/`client-ssm`. |
| Polite capture, stop on 403, no evasion (A6, P0-7, FR-014) | ✅ (OR-9) | 1 request/s including retries (`socrata.ts:289-304`), no app token whatever the env (`socrata.ts:333`, `source-client.ts:493`), backoff only on 429/5xx, 403/challenge → `blocked` receipt and stop (`socrata.ts:504`), exit 2 (`socrata.ts:141-143`, `run-month.ts:785`), nothing under `groups/` on a stop (`run-month.ts:403-405` before `:550`). Tests `socrata-adapter.test.ts:421-528`. |
| Profile-only classification (P0-9, AD-26) | ✅ | The adapter carries no term (`socrata.ts:9-10`); include predicate from `toSoqlInclude()` (`austin-3syk-w9eu.ts:33`); `strictProfileApi` (`run-month.ts:152-170`); profile digest and commit stamped (`run-month.ts:715-734`); gate `grep-gates.sh:104-108`; test `socrata-adapter.test.ts:599-607`. |
| `carCid` additive (AM-05, D-5) | ✅ (OR-4) | `car` and `directory` both carry `carCid` (`manifest.ts:252-266`); every `carCid` must be one of the adds (`upload.ts:320-329`); the manifest's own bytes are added and the Hash must be `cidOfBytes` (`upload.ts:333`). |
| Verify on Pinata + Filebase with an allowlist (AM-01, FR-006, P0-14) | ✅ (OR-6) | Allowlist and exact refusal text (`verify.ts:23-46`); manifest first, byte compare, stop on a differing gateway (`verify.ts:296-339`); tables by `cid`, car/directory by `carCid`, never a dag-json root as a file (`verify.ts:266-270`); plain GET, no Range (`verify.ts:209`, test `:432`); `ALL ARTIFACTS VERIFIED` only with both gateways (`verify.ts:385-390`). |
| CID copy refuses overwrite (FR-012, AD-02) | ✅ | HeadObject → same size/sha/cid skip, different → throw (`cid-copy.ts:233-247`); `IfNoneMatch: "*"`, `ChecksumSHA256`, immutable Cache-Control, readback with `ChecksumMode` (`cid-copy.ts:249-269`); `ipfs/<cid>` keys only, CloudFront origin path `/ipfs` matches `copyUrl` (`infra/src/data-stack.ts:96`, `packages/shared/src/urls.ts`); region from the profile, no literal (`cid-copy.ts:72`, gate `grep-gates.sh:126-145`). |
| P0-15 redaction before `validate` | ✅ | The County transform withholds owners before `groups/` is written (`run-month.ts:549-591`); `owners_redacted` is required, never defaulted (`upload.ts:69`, `manifest.ts:326-331`); note text verbatim (`manifest.ts:43-45`). |
| P0-4 wording | ✅ | `PUBLICATION_STATE_TEXT` in `packages/shared/src/labels.ts`; gate `grep-gates.sh:147-151`; no `--atlas-page` in A-03 (`sequence.ts:191`). |
| Gateway URLs derived, never stored (P0-3) | ✅ | `packages/shared/src/urls.ts` builds every URL at call time from configured bare hosts; contract refinement rejects stored ones. |
| Kit runtime, not reimplemented (A1, AD-17) | ✅ with recorded deviation | The adapter is a `county-permit-adapter` vendor module driven directly (D-5; Restate wiring A-05/A-06); the publish sequence wraps the pinned CLI (`sequence.ts:146-168`, commit 44bb182 asserted before the first step). |

### Strengths

1. The plan/executor split makes P0-2 structural rather than procedural: the order is a value, not a control flow, and the tests prove it (`publish-order.test.ts:143-360`).
2. Fail-closed everywhere it matters: a missing output with exit 0 fails (`sequence.ts:460-463`); a part that re-derives to another CID fails (`manifest.ts:236-241`); a readback mismatch writes no manifest (`upload.ts:256-262`); the index refuses a re-publish or an altered `manifestCid` (`runs-index.ts:29-43`); a dirty tree refuses to build a manifest (`manifest.ts:350-351`).
3. The pinned CLI is verified from the pnpm store path, and I confirmed from `dist/commands/validate.js` that both `validate <dir>` and `validate <car>` exit 1 on any lexicon or CAR-check error, so gating on exit code is sound.
4. `cid.ts` uses `ipfs-unixfs-importer` with `cidVersion 1, rawLeaves true` and the default 256 KiB balanced layout, and `kubo-add.ts:17` asks the node for the same (`chunker=size-262144`); the test at `kubo-add.test.ts:121` covers the multi-chunk (dag-pb root) case.
5. Credentials are handled the way the design asked: child env only, argv asserted clean, every printed line redacted, token never in a URL or form.
6. The adapter's politeness is testable and tested: pacer, identical UA, no app token, 429 retried, 403 and a 200 challenge page stopped at first sight.

### What must be fixed before PO decision D-8 (first public upload)

- **OR-1.** Pin the approval artifact. Write the build report under a phase-specific name (`reports/sequence-build.json`) and, in `publishRun`, require every phase-1 `outputs[].sha256`, `carRoot` and `tablesRoot` of the fresh run to equal the build report before the first `upload` step; print the compared digests. Also write the `build` listing to `reports/public-files.json` so the D-8 evidence is a file, not a terminal scrollback.
- Operational prerequisites I would check at D-8 (not code defects): the tree is clean (`specs/003-walking-skeleton/run-log.md` is currently modified and would make `buildManifest` refuse); `~/.config/assessment/filebase.env` holds the three `FILEBASE_*` names and no `IPFS_API_TOKEN` (OR-8); the Filebase Free plan can hold both groups' CARs and tables (AM-04); the lexicon manifest URL and the CLI commit are recorded in the evidence.

### What can wait (before G7 unless stated)

- **OR-2** (G7): add `assertOrdered(plan)` in `execute` that throws `"<step> of <group> before <earlier step>"` naming both steps, and a test that feeds a reordered plan (export an internal `executePlan` for tests, or test `assertOrdered` directly) so TC-002(b) is asserted by name.
- **OR-3**: keep the redacted stdout of `validate` and `validate-car` in `StepRecord` (or parse the per-check lines) so the six CAR check counts land in `sequence.json`.
- **OR-4**: after each `kuboAddFile`, GET `https://{FILEBASE_GATEWAY_HOST}/ipfs/{carCid}` through readback's `getDigest` and compare size + SHA-256 before the manifest is built.
- **OR-5** (before A-11): assert `dataGroupCids.length === 2` and that one equals the seed schema CID from `capture/lexicon/receipt.json`.
- **OR-6**: `redirect: "manual"` in `fetchBytes`, treat 3xx as a failure, or record `new URL(res.url).host` and refuse it unless allowlisted.
- **OR-7**: compute the Filebase token inside `sequence.ts` (avoids the import cycle with `kubo-add.ts`) and add it to `secrets` for the stderr redaction.
- **OR-8**: in `uploadEnv`, require the three `FILEBASE_*` names explicitly and refuse `IPFS_API_TOKEN` when the API is pinned to Filebase.
- **OR-9**: map `blocked_reason: "timeout"` to `error` (exit 1, still a stop) and keep exit 2 for 403/challenge, or amend `contracts/cli.md` to say so.
- **OR-10**: dedupe receipts by `key` keeping the latest ok line, or point `sources[0].receipts` at a per-run file; assert `records === summary.counts.captured`.
- **OR-11**: one `gateway-get.ts` with explicit retry policy parameters used by both readback and verify.
- **OR-12**: at D-8 time, run `export-tables` twice on the kept CAR and record both tables roots in the evidence.
- **OR-13**: evidence says "one pin (Filebase); second pin and GitHub Release at release".

### Confidence note

Static read of the sources, tests and the pinned CLI's compiled `validate` command; no test suite, CLI or network call was run (read-only brief). Line numbers are from commit `071eb1b`. I did not review `packages/query-core` SQL builders or `packages/shared` labels beyond their publication touch points (`urls.ts`, `sources.ts`, the generated-SQL seam), which belong to metagross's review. The AM-01 assumption that Pinata's public gateway serves Filebase-pinned objects by bare CID rests on the 0001 spike evidence, not on anything I re-verified.

### Fixes (early review)

Fixer: `soofi-xyz-team-kit:oracle`, 2026-10-21, on top of `071eb1b` (uncommitted). Tests first: each test below failed before its fix (19 publish failures plus `upload.test.ts` failing to import `approval.js`; 2 `run-month` failures) and passes after. Suites: `pnpm vitest run pipeline/publish` 171 passed / 1 skipped; `pipeline/oracle-runtime` `npm test` 633 passed, `typecheck`, `lint`, prettier clean; root `tsc`, `tests/e2e` `tsc` and eslint clean.

| Finding | State | What changed | Tests (file › name) |
| --- | --- | --- | --- |
| OR-1 | Fixed | `build` writes `reports/sequence-build.json` (every phase-1 step, exit code, roots, every output file's path/size/SHA-256; directories listed file by file) and `reports/public-files.json` (exactly the CARs, `tables.car` and every part: path, size, SHA-256, CID; group roots; SHA-256 of the build report; no timestamp). `upload --run <id> --approved <sha256 of public-files.json>` is required; `publishRun` calls `verifyApprovedBuild` before the first upload step (`ApprovalError` on a wrong/missing approval or no build; `BuildDriftError` naming the file on any size/SHA-256/CID/root/extra-file difference), never re-runs phase 1 (`runUpload`, phase 2 only) and writes `reports/sequence-upload.json`; the build report is never rewritten. New `src/approval.ts`. | `upload.test.ts` › "the D-8 approval…": "writes sequence-build.json with every phase-1 step…", "writes public-files.json listing exactly the CARs…", "uploads the approved build without re-running phase 1 and never rewrites sequence-build.json", "refuses an approval that is not the SHA-256 of public-files.json…", "refuses when no build exists for the run…", "refuses with BuildDriftError naming a part…", "…a public file the approval does not list", "…when sequence-build.json (its roots) changed…", "…a CAR swapped after the approval…"; `cli.test.ts` › "cli build › runs phase 1 only…" (prints the listing SHA-256 and the `--approved` command), "cli usage" (`upload` without `--approved` exits 1) |
| OR-2 | Fixed | `assertOrdered(plan)` throws `PlanOrderError` "`<step> of <group> before <step> of <group>`" (also "… missing", "… twice"); `executePlan` asserts before any directory or CLI call. Test titles carry `A-03-TC-001` / `A-03-TC-002`; `tests/e2e/build-checks.spec.ts` filters by those exact IDs and requires ≥ 1 passed per TC (4 and 17 locally). | `publish-order.test.ts` › "A-03-TC-002 refuses upload-car before export-tables, naming both steps", "A-03-TC-002 runs no step of a reordered plan…", "A-03-TC-002 refuses an upload of one group before another group's build step", "A-03-TC-002 refuses a plan that skips a step, naming it", "A-03-TC-001 accepts the fixed build, upload and publish plans" |
| OR-4 | Fixed | Each `.car` add is read back from `FILEBASE_GATEWAY_HOST` by `carCid` (size + SHA-256, `readbackFile`) before the manifest; stage `car-readback`. | `upload.test.ts` › "carCid readback (OR-4)": "reads every .car add back…", "writes no manifest when the gateway serves other bytes for a carCid" |
| OR-6 | Fixed | `verify.ts` `fetchBytes` uses `redirect: "manual"`; a 3xx (or a response that was redirected) fails the check naming the Location host. `scripts/verify-manifest.ts` is unchanged (thin CLI over `verify.ts`). | `verify.test.ts` › "redirects (OR-6) › does not follow a redirect off the allowlisted host…" |
| OR-7 | Fixed | `filebaseToken` moved into `sequence.ts`; `secretValues` adds the composed token and `Bearer <token>` (and `Bearer <IPFS_API_TOKEN>`); every sequence report is redacted as a whole. | `publish-order.test.ts` › "redaction of the composed Filebase bearer (OR-7)": "counts the composed token and its Authorization value…", "keeps the composed token out of a failed step's stderr and the sequence report" |
| OR-8 | Fixed | `filebaseEnvProblem`: all three `FILEBASE_*` names required, `IPFS_API_TOKEN` refused beside the Filebase RPC; enforced in `cli.ts uploadEnv`, `publishRun` pre-flight and `kuboAdd`. | `cli.test.ts` › "cli upload credentials fail closed (OR-8)" (2 tests); `upload.test.ts` › "Filebase credentials fail closed (OR-8)" (2 tests) |
| OR-9 | Fixed | `run-month.ts` labels a timed-out capture `error` (exit 1, still a stop, nothing under `groups/`); exit 2 stays for 403/challenge, per `contracts/cli.md`. | `run-month.test.ts` › "labels a timed-out permit GET an error (exit 1), not blocked (exit 2)…", "keeps exit 2 for a 403 (blocked)" |
| OR-10 | Fixed | `run-month.ts` writes this run's receipts to `<runDir>/capture/austin-receipts.jsonl`; `sources[0].receipts` points there, so `records` equals `counts.captured`. | `run-month.test.ts` › "counts sources[0].records from this run's receipts only…" |
| OR-14 | Fixed | Preflight ordering. Before this fix, `publishRun` ran the four uploads, the readback and the carCid adds before `buildManifest` checked the working tree, so a dirty tree published files and then stopped with no manifest. Nothing had been uploaded when this was found. The new `preflight()` in `upload.ts` runs first in `publishRun` and in `cli.ts upload`. Before any CLI call or network write, it checks the summary and profiles, that the run is not already in the index, all three `FILEBASE_*` names (names only), a clean tree (`git status --porcelain --untracked-files=no`; `workTreeStatus` can be injected), that the recorded `profiles[].gitCommit` equals HEAD (`headCommit` can be injected), and the D-8 approval and build drift. A failure throws `PreflightError` with `check` set to `filebase-env`, `work-tree` or `commit`, or throws `ApprovalError`/`BuildDriftError`, and the command exits 1. `buildManifest` still runs its own clean-tree check. Red: 4 failures (the CLI exited 0 on a dirty tree; `PreflightError` did not exist). Green: 176 passed, 1 skipped. | `upload.test.ts` › "preflight before the first network write (OR-14)": "refuses a dirty working tree before any upload: zero upload calls, no add, no manifest", "refuses a build whose recorded gitCommit is not HEAD, naming both commits, before any upload", "refuses incomplete Filebase credentials before any upload, naming the variables only", "proceeds as before on a clean tree whose HEAD is the recorded commit"; `cli.test.ts` › "cli upload preflight before any upload (OR-14)": "refuses a dirty working tree before publishRun: zero CLI calls, a named error, exit 1" |
| OR-3 | Deferred (G7) | CAR check counts in the step record. | — |
| OR-5 | Deferred (before A-11) | `dataGroupCids` length and seed-CID assertion. | — |
| OR-11 | Deferred (G7) | One shared `gateway-get.ts`. | — |
| OR-12 | Deferred (D-8 evidence) | Second `export-tables` run on the kept CAR. | — |
| OR-13 | Deferred (release) | "One pin (Filebase)" wording in the evidence. | — |

Re-build of `travis-202609-permits-20261021t093125z` (phase 1 only, pinned CLI 44bb182b, nothing uploaded): exit 0; roots equal the earlier build (county archive `baguqeeraqc3y3bh65rbd42zgdrkctaulckvvidmgb52pghyansb43vumoh6q`, tables `baguqeeramjzy4a3oqe5sldka4hdbbm65xkbjh2yaxkb2j4dtqqkctodfxayq`; property_improvement archive `baguqeeraraakl5mdoba2lz4zgn4wtiuqiw6qfpez3dhimgfc6b7tkacv2gfq`, tables `baguqeerauingvk5n6ow4zjjn3zgj57by6ef6jpfzetcz4j7qphu4gbsl5hhq`). `reports/public-files.json` lists 27 files (county 18, property_improvement 9), 212,217 bytes, SHA-256 `ae2f47bbe86b3f84c0f4e4273be42eaf047767eec8f08fe1f49ff9256f318697`; `verifyApprovedBuild` with that digest passes on disk. That digest is the D-8 input.

---

## Final review: oracle (whole branch)

Reviewer: `soofi-xyz-team-kit:oracle`, read-only, 2026-10-21, commit `570285d`. Skills loaded: `use-oracle`, `county-permit-adapter`, `apply-engineering-guidelines`. Scope: `git diff feature/oracle-pipeline...HEAD`, limited to `pipeline/oracle-runtime/travis/**` (adapter, `run-month.ts`), `pipeline/publish/**`, `scripts/verify-manifest.ts`, `scripts/grep-gates.sh`, the `packages/query-core` and `packages/shared` changes, and how `apps/web` and `apps/api` read the published data. Judged against ARD A1/A2/A6, AD-01–04, AD-22, AD-24–26, P0-1–4/14/15, § 16 AM-01/04/05; the Task A addendum; spec, plan and tasks; `contracts/cli.md`; `agent-design.md` (oracle and Spike delta); and `testplans/A-03-test-cases.md`. No test, CLI or network call was run.

### Score: 72 / 100. Fails the bar (75) because of one open Critical, F-1.

On its own, the publish track now scores **91 / 100**, up from 84: OR-1, OR-2, OR-4, OR-6, OR-7, OR-8, OR-9, OR-10 and OR-14 are fixed, and the D-8 approval is now a file with a hash. The whole-branch score is held down by F-1, which is in the producer (`run-month.ts`). Once F-1 is fixed and has a test, I expect about 88.

### Are the services what I would choose?

Yes. The services are unchanged from the early review and are still right:
- a pure plan/executor around the pinned CLI;
- single-purpose readback, Kubo add, manifest, index, verify and CID-copy modules;
- a generic Socrata adapter plus a coordinates-only Austin module;
- the web and API read the manifest **by CID** and check that the bytes hash to it (`apps/web/src/data/manifest.ts:22`, `apps/api/src/s3-read.ts`), then read the parts by their manifest CIDs (`fetch-by-cid.ts` `partUrl`, `presignPart`).

Nothing public comes from outside `elephant-cli` output, the descriptive manifest and the index. No Query DB is imported anywhere in scope.

### Strengths

1. **The D-8 gate is now structural.** `build` writes `reports/public-files.json`. `upload --approved <sha256>` checks the listing hash, the build-report hash, every phase-1 output, every public file (size, SHA-256 and CID) and both CAR header roots, and it never re-runs phase 1 (`approval.ts:237-309`, `upload.ts:257-309`).
2. **Every refusal comes before the first network write** (OR-14): Filebase env names, clean tree, recorded commit equals HEAD, and approval/drift (`upload.ts:257-309`, `cli.ts:282`).
3. **Order is enforced as data.** `assertOrdered` names both steps and runs before any directory or CLI call (`sequence.ts:468-488`, `:558`). TC-001 and TC-002 are asserted by ID (`publish-order.test.ts:151-648`).
4. **Contractor guardrail.** `run-month.ts:24-26` and `:759`, together with the transform, write no contractor, person or license from the permit. All five AD-24 states are recorded, every one `contractor_unresolved` until A-07.
5. **Consumers fail closed.** A CID mismatch is never shown (`fetch-by-cid.ts:183-185`). One load never mixes hosts. The fallback is labelled. `bindManifest` refuses a run classified under another profile digest.

### Deviations (with paths)

- `pipeline/oracle-runtime/travis/runs/run-month.ts:728-746`: its `profiles[]` drops `travis-places`, which `run-pilot.ts:545` writes and the A-02 contract requires. See F-1.
- `pipeline/publish/src/readback.ts:302-315`: the archive and tables roots are checked against the CLI's upload summary (the node's claim), not fetched by root CID through a gateway. Parts and `carCid` files are read back through the gateway. The kit asks for archive-root and tables-root readback before the Atlas PR. See F-3.
- `pipeline/publish/src/sequence.ts:698` and `index.ts:29`: `runPublish` (all 12 steps, no approval) is still exported. No CLI path reaches it. See F-4.

### Findings

| # | Severity | File:line | Finding | Fix |
| --- | --- | --- | --- | --- |
| F-1 | **Critical (blocks the upload)** | `pipeline/oracle-runtime/travis/runs/run-month.ts:728-746`; `packages/query-core/src/bind-manifest.ts:155-156` | `run-month` records only the `travis-austin` and `travis-austin-roof-profile` profiles. `bindManifest` throws `manifest has no travis-places profile`, so a manifest built from any run-month run cannot be bound by the web engine (`apps/web/src/engine/duckdb-wasm.ts:202`) or the Lambda (`apps/api/src/engine/duckdb-node.ts:84`), and the Permits page and API fail. I confirmed it on disk: `pipeline/data/runs/travis-202609-permits-20261021t093125z/summary.json` has no `travis-places`. The A-02 pilot wrote it (`run-pilot.ts:545-548`); the tests pass only because their fakes add it (`apps/api/test/helpers/fakes.ts:103`). Published CIDs never change and `runs/index.json` is append-only, so an unbindable run would stay in the public history for good. | Add `{name:"travis-places", version, sha256: GAZETTEER.sha256 (or the committed DIGEST), path:"packages/query-core/gazetteer/travis-places@1.0.0", gitCommit}` to `run-month.ts` `profiles`. In `publishRun`, before `kuboAddBytes` of the manifest, run `bindManifest(built.bytes, tablesDir, nodeEngine)` against the local tables, or at least assert that the profile names and digests equal the `query-core` constants. Add a `run-month.test.ts` case that builds the manifest from a run-month summary and binds it. Then re-run the capture and the build, and get a new D-8 approval. |
| F-2 | Major (operational, before the upload) | `pipeline/publish/src/upload.ts:276-288` | Preflight requires `profiles[].gitCommit === HEAD`. Any commit made after the capture forces a new capture, and a new approval with it. That includes committing this review or the build evidence. The kept run (`…093125z`) was captured at `071eb1b`, but HEAD is `570285d`, so it is already refused. Fail-closed is correct; the trap is in the order of work. | Treat this as the D-8 runbook rule: commit every doc, run `run-month`, run `build`, approve, upload, and only then commit `runs/`, with no commits in between. Optionally relax the check so it passes when `git diff --quiet <recorded> HEAD -- profiles packages/query-core packages/contract pipeline` is clean, and print that comparison. |
| F-3 | Minor (before A-11) | `pipeline/publish/src/readback.ts:302-315` | The archive and tables roots are compared with `upload --output-json`, not read back through a gateway by root CID. | GET `https://{FILEBASE_GATEWAY_HOST}/ipfs/{root}?format=raw`, compute the block's CID, and compare it with `sameDigest`. Record the result in `readback.json`. |
| F-4 | Minor | `pipeline/publish/src/sequence.ts:698`, `pipeline/publish/src/index.ts:29` | `runPublish` runs phase 1 and phase 2 with no D-8 approval and is part of the package API. | Remove it from `index.ts`, so only tests import it from `sequence.ts`, or make it require an `ApprovedBuild`. |
| F-5 | Minor | `pipeline/publish/src/approval.ts:292-304`; `readback.ts:228-246` | There is a gap between `verifyApprovedBuild` and `upload-car`. Tables parts are read back against the current local file, not the approved SHA-256. A CAR swap is caught by the root check, but a changed part is not. | Pass the approved `PublicFile` digests into `readbackGroup` and compare served bytes with the approved SHA-256. |
| F-6 | Minor | `pipeline/oracle-runtime/travis/runs/run-month.ts:407-413` | The timeout-vs-block decision matches the receipt's `blocked_reason` or the reason prefix `"list query blocked (timeout"`. The adapter (`lib/source-client.ts:48`) still labels a timeout `blocked`, so A-05/A-06 will see the same mislabel. | Make the adapter return `status: "error"` for `timeout` and drop the string match. |
| F-7 | Note | `apps/web/src/data/fetch-by-cid.ts:183-185` | The browser verifies only the manifest by CID. Table parts are range-read without per-part CID checks, so part integrity rests on the CID copy's `IfNoneMatch` and `ChecksumSHA256` PUT and on `verify-manifest`. | Acceptable for A-03. State it in the evidence. |

### Early-review findings: status

| Finding | Status | Evidence I re-checked |
| --- | --- | --- |
| OR-1 | **Fixed (verified)** | `approval.ts:106-147` (listing), `:237-309` (verify); `upload.ts:290`; `runUpload` is phase 2 only (`sequence.ts:680-691`); the build report is never rewritten (phase-specific name, `sequence.ts:144`). |
| OR-2 | **Fixed (verified)** | `sequence.ts:468-488`, called at `:558` before `mkdirSync`; tests `publish-order.test.ts:604-648`. |
| OR-3 | Open (deferred to G7) | `StepRecord` still has no stdout (`sequence.ts:90-100`). The six CAR check counts are still copied by hand. |
| OR-4 | **Fixed (verified)** | `upload.ts:389-407` (`readbackFile` per `.car`, stage `car-readback`). |
| OR-5 | Open (before A-11) | `dataGroupCids` is recorded but not asserted (`sequence.ts:644`). |
| OR-6 | **Fixed (verified)** for verify | `verify.ts` `redirect: "manual"`, 3xx and redirected responses refused. `readback.ts` `getDigest` still follows redirects (see OR-11). |
| OR-7 | **Fixed (verified)** | `sequence.ts:237-247` adds the composed token and `Bearer` forms; `finish` redacts the whole report (`:583-586`). |
| OR-8 | **Fixed (verified)** | `filebaseEnvProblem` (`sequence.ts:224-230`) is enforced in `cli.ts:161`, `upload.ts:265-269` and `kubo-add.ts:91-94`. |
| OR-9 | **Fixed (verified) at the run level** | `run-month.ts:407-413` gives exit 1 for a timeout; the residual is F-6. |
| OR-10 | **Fixed (verified)** | `run-month.ts:417-419` writes this run's receipts to `capture/austin-receipts.jsonl`; `records: captures.length` (`:714`). |
| OR-11 | Open (G7) | There are still two GET policies: readback retries 404 and follows redirects, while verify does neither. |
| OR-12 | Open (D-8 evidence) | No second `export-tables` determinism run is recorded. |
| OR-13 | Open (release) | Evidence wording "one pin (Filebase)". |
| OR-14 | **Fixed (verified)** | `upload.ts:257-309`; `cli.ts:282`; tests `upload.test.ts:969`, `cli.test.ts:376`. |

### Before the first upload (D-8 re-confirm)

1. Fix F-1, add its test, and bind the built manifest locally. **This blocks the upload.**
2. Follow the F-2 order: commit everything, capture, build, approve the new `public-files.json` SHA-256, then upload. The `ae2f47bb…` approval recorded above is for a run at `071eb1b`; preflight now refuses it, and F-1 changes the manifest anyway.
3. Check `~/.config/assessment/filebase.env`: the three `FILEBASE_*` names are present and `IPFS_API_TOKEN` is absent.
4. Record the lexicon manifest URL, the CLI commit `44bb182` and the OR-12 determinism pair in the D-8 evidence.

### Before G7

F-3 to F-6, OR-3 and OR-11. Also: A-03 makes no Atlas, IPNS or MCP claim (P0-4 wording); keep it that way until A-11.

### Confidence

High on F-1: I traced it statically through `run-month.ts`, `bind-manifest.ts` and the on-disk `summary.json`. High on the re-verification of the fixes, which I read in the code and matched to named tests. I did not run the tests. Medium on F-3's weight, which depends on how strictly A-11 reads "root readback". Line numbers are at `570285d`. I did not review UI rendering, tRPC procedures, CDK stacks or query-core SQL semantics beyond the bind seam; those belong to other reviewers.

## Final review: /code-review (whole branch, high)

Scope: `git diff feature/oracle-pipeline...HEAD` at `570285d`, effort high. This review was read-only: no tests, network or AWS calls were run. The Major findings were checked against the code. Counts: 0 Critical, 4 Major, 6 Minor.

### Major

1. **Major: `infra/src/data-stack.ts:248` (with `apps/api/src/s3-read.ts:156`).** `grantApiRead` grants only `s3:GetObject`, but `presignPrefix` calls `ListObjectsV2`, which needs `s3:ListBucket` on the bucket ARN.
   *Failure:* invoking the bench (`{kind:'bench', prefix:'private/bench/<name>/'}`) on the deployed Lambda gets AccessDenied, so TC-NF-05 and the ADR-0001 Lambda measurement can never pass. Unit tests mock S3 with `aws-sdk-client-mock`, so they miss it.
   *Fix:* add an `s3:ListBucket` statement on `bucket.bucketArn`, conditioned on `s3:prefix` in [`ipfs/*`, `private/bench/*`]. Add a CDK assertion test that the API role has this statement.

2. **Major: `apps/api/src/s3-read.ts:89`.** `isAbsent` accepts only `NoSuchKey`, `NotFound` or 404. Without `s3:ListBucket`, S3 answers a GetObject on a missing key with 403 AccessDenied.
   *Failure:* `runs.summary({manifestCid})` with a well-formed CIDv1 that isn't in the copy rethrows the raw error. tRPC returns 500 instead of NOT_FOUND, and a bad client input fires the `countylens-api-5xx` alarm. The writer role already documents this need (`data-stack.ts:190`); the reader grant does not include it.
   *Fix:* the same ListBucket grant as finding 1, scoped to `ipfs/*`, so S3 returns 404. Add a CDK assertion, and a hosted test (TC level) that an unknown CID returns NOT_FOUND.

3. **Major: `amplify.yml:41`.** `cp ../../runs/index.json public/runs/index.json` fails hard because `runs/index.json` has never been committed. It is in no commit on any branch.
   *Failure:* every Amplify build (production and each `0*` preview) fails in preBuild until the first publish commits the index. No hosted URL means no evidence, and the Runs page's empty or unreadable-index states (FR-002, TC-014) can never be shown live.
   *Fix:* `if [ -f ../../runs/index.json ]; then cp ...; else echo '{"version":1,"runs":[]}' > public/runs/index.json; fi`, using the real empty `RunsIndexV1` shape. Alternatively, commit the first index before any branch build.

4. **Major: `apps/api/src/engine/duckdb-node.ts:84` (with `packages/query-core/src/bind-manifest.ts:253,274`).** `bindOnce` rebinds a different manifest on the same long-lived DuckDB instance. `bindManifest` creates emitted tables as `CREATE OR REPLACE VIEW group.table` and absent required tables as `CREATE OR REPLACE TABLE group.table`. DuckDB refuses to replace an object of the other type.
   *Failure:* a warm sandbox binds manifest A, where a required table was emitted (VIEW). A request for manifest B, which lacks that table, raises "Existing object ... is of type View". Every bind of the other shape then fails until the sandbox is recycled. Extra views from A, built over presigned URLs that expire, also stay behind.
   *Fix:* at the start of `bindManifest`, `DROP SCHEMA IF EXISTS <group> CASCADE` for every group, or open a fresh connection or in-memory database per bind. Add a query-core unit test that binds manifest A, then B (with a required table missing), then A again on one engine.

### Minor

5. **Minor: `pipeline/oracle-runtime/travis/adapters/socrata/socrata.ts:458`.** The list loop deduplicates repeated `permit_number`s (`seen`, l.428), but the per-permit GET requires `xs.length === 1`.
   *Failure:* a reissued or amended permit that appears twice in the source makes the GET return 2 rows. The outcome is `error` and the whole month run exits 1.
   *Fix:* accept `xs.length >= 1` where every row has `s.key === n`, and record the duplicate count in the receipt. Alternatively, mark that permit as `error` and continue instead of aborting the run.

6. **Minor: `pipeline/oracle-runtime/travis/adapters/socrata/socrata.ts:450` (`safePermitName`, l.134).** The resume skip never checks `done.permit_number === n`, and `safePermitName` is lossy: `2026-1 BP` and `2026-1/BP` both become `2026-1_BP`.
   *Failure:* the second permit is skipped as already captured. Later, `loadCaptures` throws, or the wrong body is attributed to that permit.
   *Fix:* compare `done.permit_number === n` before skipping, and make the key collision-free (for example `safe + "-" + sha256(n).slice(0,8)`).

7. **Minor: `apps/api/src/config.ts:25`.** The Lambda requires `CID_COPY_HOST` and `FILEBASE_GATEWAY_HOST`, which no Lambda code reads, and it re-declares the `BARE_HOST` regex owned by `packages/shared/src/urls.ts`.
   *Failure:* a deploy that leaves out an unused key fails every request at `getConfig()`.
   *Fix:* drop the unused keys, or validate them through `@countylens/shared`.

8. **Minor: `apps/web/src/engine/load-permits.ts:68`.** `readPathUrlsFromEnv` and `envHost` duplicate `apps/web/src/data/config.ts`.
   *Failure:* a validation change made in one copy drifts from the other.
   *Fix:* import from `../data/config`.

9. **Minor: `apps/web/src/engine/load-permits.ts:96`.** DuckDB-WASM startup is awaited before the run-index and manifest fetches start, although they are independent.
   *Failure:* first-visit time-to-rows is slower than it needs to be.
   *Fix:* `Promise.all([openEngine(), loadRunsIndex().then(loadManifest)])`, then bind.

10. **Minor: `apps/web/src/data/manifest.ts:22`.** The manifest bytes are CID-checked in `fetchByCid` (`fetch-by-cid.ts:183`) and hashed again in `parseManifest`.
    *Failure:* the SHA-256 work is done twice on every load. This is a cost, not a correctness problem.
    *Fix:* verify in one place.

**Tests' ability to detect regressions:** findings 1–3 all pass CI today. S3 is mocked, and no CDK assertion or hosted test covers the IAM grant or a build without an index. Finding 4 needs a multi-manifest bind test. Adding the CDK assertion and the two unit tests named above would close these gaps.

## Final review: metagross (whole branch)

**Reviewer:** `soofi-xyz-team-kit:metagross` (read-only), 2026-10-21, branch `003-walking-skeleton` at `570285d`, scope `git diff feature/oracle-pipeline...HEAD` restricted to monorepo/turbo, CI, `infra/**`, `apps/web`, `apps/api`, `tests/e2e`, `amplify.yml`. Skills: build-frontend-backends, integrate-ci-cd, responsive-design-tests, apply-engineering-guidelines.

**Score: 70 / 100** (below the 75 bar until findings 1–4 are fixed; 5–6 are G7 work already planned).

### Are these the services I would choose?

Yes. Turborepo + pnpm workspace with shared `packages/{shared,query-core,contract,tsconfig}`; tRPC on one arm64 Lambda behind an HTTP API (stage throttle, JSON access log, X-Ray active, Powertools) with no reserved or provisioned concurrency; Amplify Hosting (L1 `CfnApp`, GitHub App token flow) with a same-origin `/api/<*>` rewrite so previews need no CORS; S3 + CloudFront (OAC) CID copy; SNS email + three self-clearing alarms; native GitHub OIDC provider with a deploy role that can only assume the `cdk-hnb659fds-*` roles; Amplify-managed certificate with DNS at Namecheap (no Route 53, no ACM in us-east-1, no Secrets Manager, no KMS CMK, no WAF). Idle cost is $0 for everything instantiated. This matches agent-design § 1–7 and ARD § 16 AM-02/AM-03/AM-06.

### Strengths

- Region comes only from `CDK_DEFAULT_REGION` (`infra/src/config.ts:24-37`), enforced by `scripts/grep-gates.sh` region-literal gate; `synth` throws without it.
- Five stacks with explicit AM-02 dependencies and reasons (`infra/src/app.ts:76-80`); cdk-nag AwsSolutions on the whole app with suppressions written to the template; assertions files per stack.
- Deploy role trust limited to `0*` and the production branch, `maxSessionDuration` 1 h, no own permissions (`infra/src/ops-stack.ts:183-224`).
- Amplify rule order is correct (API rewrite before the SPA regex), `/build.json` no-cache header, and CI waits for `/build.json.sha == GITHUB_SHA` before Playwright (`.github/workflows/ci.yml:264-286`).
- Hosted-only harness: `tests/e2e/lib/runtime-url.ts` refuses unset/loopback/non-URL values; build-time cases first prove local HEAD == deployed sha (`tests/e2e/build-checks.spec.ts`).
- `@needs-aws` exclusion is honest: excluded cases are filtered by `grepInvert` and announced, never reported as passed (`tests/e2e/lib/needs-aws.ts`, `playwright.config.ts:20-30`).
- Atlas tokens only: stylelint strict-value rule plus a clean scan (only `1px` hairlines on token colors and the 600 px breakpoint); `Provenance`/`MissingReason` used on both routes; no CIDs or sample rows in app source (only a doc-comment example in `CidDisplay.tsx`).
- Lambda asset built from the same lockfile for linux-arm64 (`pnpm-workspace.yaml` `supportedArchitectures`).

### Deviations

- Budget (NFR-02, FR-007, TC-052) is not deployed: `BudgetStack` exists but is not instantiated (`infra/src/ops-stack.ts:61-110`, `:175-176`); the TC-052 budget assertion is `skipIf(!BUDGET_REGION)` (`infra/test/stacks.test.ts:465`), so TC-052 passes without a budget.
- `@aws-cdk/core:defaultCrossStackReferences: "weak"` (`infra/cdk.json:92`) renders every cross-stack value as `Fn::GetStackOutput` (10 uses: Api←Data, Web←Api/Data, Ops←Api, Cert←Web). Not named in the ARD or agent-design; needs an ARD note.
- Observability, perf, responsive and Lambda-fallback specs named by the G6 matrix are absent (T061, T068 open).

### Budget-placement verdict

The G-A4 claim "AWS::Budgets::Budget exists only in us-east-1" is **not correct**. I ran CDK's own bundled validator (`@aws/cloudformation-validate`, the source of F3006, with `pseudoParameterOverrides.region` exactly as `aws-cdk-lib` calls it) on a one-resource template: F3006 fires for **eu-north-1** and eu-south-1 only; us-east-1, us-east-2, us-west-2, eu-west-1, eu-west-2, eu-west-3, eu-central-1 and ap-southeast-1 all accept the type. So the type is missing from the project region's CloudFormation registry, not "us-east-1 only". A N. Virginia (or any other region) stack is not compliant anyway: CLAUDE.md allows us-east-1 only for CloudFront, WAF and CloudWatch Logs.

Compliant option: keep the budget in `CountyLensOps` (eu-north-1) as an `AwsCustomResource` that calls the Budgets API (`CreateBudget` on create, `UpdateBudget` on update, `DeleteBudget` on delete, `physicalResourceId` = budget name). A budget is an account-level object with no region; the Budgets API's global endpoint is not a regional resource, so no stack or resource lives outside eu-north-1. Idle cost stays $0 (the provider Lambda runs only on deploy; give its log group a retention). Scope the IAM to `budgets:ModifyBudget`/`budgets:ViewBudget` on `arn:aws:budgets::<account>:budget/countylens-monthly` and suppress cdk-nag IAM4/L1 with reasons. First, a read-only PO check settles whether the native type is usable after all: `aws cloudformation describe-type --type RESOURCE --type-name AWS::Budgets::Budget --region eu-north-1 --profile assess`; if it returns the type, acknowledge F3006 with that evidence and put `CfnBudget` back into `OpsStack`.

### Findings

1. **Major: the bench branch cannot list its prefix.** `apps/api/src/s3-read.ts:157` calls `ListObjectsV2`, but `grantApiRead` gives only `s3:GetObject` on `ipfs/*` and `private/bench/*` (`infra/src/data-stack.ts:248-256`). TC-NF-05 will get AccessDenied on the first direct invoke; unit tests use fakes and cannot catch it. *Fix:* add `s3:ListBucket` on the bucket ARN with `Condition: StringLike s3:prefix = private/bench/*`, plus a CDK assertion for it (or pass explicit keys in the bench event and drop the listing).
2. **Major: no budget is deployed and TC-052 hides it.** See the verdict above (`infra/src/ops-stack.ts:61-110,175-176`; `infra/test/stacks.test.ts:465-468`). *Fix:* the `AwsCustomResource` budget in `OpsStack`; make the TC-052 assertion unconditional (no `skipIf`).
3. **Major: no guard against synthesising or deploying to the wrong region.** The most recent local synth (`infra/cdk.out/manifest.json`, 13:06) targets `aws://515618610572/us-east-1`, and every `Fn::GetStackOutput` in it carries `"Region": "us-east-1"`, although the `assess` profile says eu-north-1. Any shell with a stray `CDK_DEFAULT_REGION`/`AWS_REGION` would put all five stacks in us-east-1 at D-10. *Fix:* add an allow-list key outside `infra/src` (for example `countylens:allowedRegions` in `infra/cdk.json` context or a `COUNTYLENS_REGION` repository variable) and make `loadConfig` throw when `CDK_DEFAULT_REGION` differs; assert it in `stacks.test.ts`; re-synth before D-10 and check the manifest environment.
4. **Major: the `e2e-hosted` job lacks the environment its specs need.** `.github/workflows/ci.yml:247-248` sets only `AMPLIFY_APP_ID`. `build-checks.spec.ts` TC-052/TC-053 spawn the infra Vitest suites, which throw without `CDK_DEFAULT_REGION`; `fallback.spec.ts` TC-032/033/034 and `cid-copy.spec.ts` call `requireCidCopyHost()` and throw without `CID_COPY_HOST`. *Fix:* add `CDK_DEFAULT_REGION: ${{ vars.AWS_REGION }}`, `CID_COPY_HOST: ${{ vars.CID_COPY_HOST }}`, `FILEBASE_GATEWAY_HOST`, `PINATA_GATEWAY_HOST` to that job; keep it credential-free so `@needs-aws` stays excluded.
5. **Major (likely, verify at D-10): the Amplify token flow breaks later Web updates.** `infra/src/web-stack.ts:120-129` asks the PO to revoke the PAT after the first build, while CI keeps re-using the NoEcho previous value. The CloudFormation Amplify App handler sends `AccessToken` on every App update, so any change to custom rules, env vars or headers (for example a new HTTP API URL or CID host) will fail in the CI `deploy` job once the token is revoked. *Fix:* keep a short-expiry fine-grained token valid until the PR is final and document "pass `--parameters CountyLensWeb:GitHubAccessToken=…` again on any Web change", or test one no-op App update after revocation and record the result in the run log.
6. **Major (G7): G6-matrix specs are missing.** `tests/e2e/observability.spec.ts` (TC-050, TC-051, TC-NF-04), `perf.spec.ts` (TC-NF-01, TC-NF-02), `responsive.spec.ts` (TC-NF-03, smeargle at 390/768/1440), `lambda-fallback.perf.spec.ts` (TC-NF-05), `read-path-record.spec.ts` (TC-NF-06). Only `cid-copy.spec.ts` TC-044 carries `@needs-aws`; TC-050 and TC-NF-05 must carry it when written. *Fix:* complete T061/T068 after D-10; run the `@needs-aws` cases from an `assess` session and attach their reports as evidence.
7. **Minor: weak references can go stale silently.** With `Fn::GetStackOutput`, a consumer template's text does not change when a producer output value changes (for example HttpApi or distribution replacement), so `cdk deploy` reports "no changes" for Web/Ops/Api and keeps old values. *Fix:* record the choice in the ARD with this caveat; after a producer replacement run `cdk deploy --force` on the consumers; add a hosted check that `/api/trpc/runs.summary` answers through the rewrite. Also confirm with one eu-north-1 changeset that the intrinsic is accepted before D-10.
8. **Minor: pre-compressed wasm relies on Amplify honouring a `Content-Encoding: br` custom header** (`infra/src/web-stack.ts:178-186`, `amplify.yml` compress step). If Amplify's CDN re-negotiates or strips it, DuckDB init fails with a compile error. *Fix:* first hosted check after D-10: `curl -sI …/duckdb-eh.wasm` shows `content-encoding: br` and `content-type: application/wasm`, and the Permits page reaches `ready`; keep a fallback (uncompressed wasm) ready.
9. **Minor: CountyLensCert may wait on DNS.** `AWS::Amplify::Domain` can sit in `PENDING_VERIFICATION` while the stack is in progress, and stack outputs are only readable after completion. *Fix:* in the D-10 runbook, read both CNAMEs from `aws amplify get-domain-association` while the stack is creating, and deploy Cert separately from `--all` until the domain is AVAILABLE so a DNS wait never blocks CI.
10. **Minor: turbo cache keys miss two switches.** `turbo.json` `test.env` lacks `BUDGET_REGION` and `COUNTYLENS_BUNDLE`, which change what the infra suites assert; a cached pass can be replayed. *Fix:* add both (or drop `BUDGET_REGION` once finding 2 is fixed).
11. **Minor: the `deploy` job is red on every push until D-10** (`ci.yml:216-221`). This is intended, but the PR will show failing checks. *Fix:* note it in the PR body until the first laptop deploy sets `AWS_DEPLOY_ROLE_ARN`.

### Confidence

High for findings 1, 3 (manifest and template inspected), 4 and 6 (files read), and for the budget verdict (reproduced with the exact validator CDK uses; the live CloudFormation registry was not queried because this review made no AWS calls). Medium for 5 and 9 (CloudFormation handler behaviour for Amplify, to be confirmed at D-10). Not reviewed: `pipeline/**` and `packages/**` internals beyond their use by the apps.

### Fixes (final review)

Fixer: oracle, 2026-10-21, on top of `570285d` (uncommitted). Tests first: each new test was run red, then the fix, then green. No network, upload, AWS or `pipeline/data` access; the only real engine is a local DuckDB bind over a tiny Parquet export written inside the test.

| # | Status | Change | Tests |
| --- | --- | --- | --- |
| F-1 | **Fixed** | `run-month.ts` now writes a third profile `{name: "travis-places", version: "1.0.0", sha256: GAZETTEER_SHA256, path: packages/query-core/gazetteer/travis-places@1.0.0, gitCommit}`. The digest is query-core's generated constant, and it is checked against the repo's `DIGEST` file when that file is present. Defence: `pipeline/publish/src/bind-guard.ts` `assertBindable` binds the built manifest bytes against the LOCAL tables with the real query-core `bindManifest`. The binder is `pipeline/publish/scripts/local-bind.ts`: a node DuckDB with `partUrl` mapped to the run directory, kept outside `src/` because of the AD-19 DuckDB ban and loaded lazily. It runs `listRoofingPermitsSql()` and `runSummarySql()` and requires rows = `coverage.permits_emitted`, plus a matching run id and manifest CID. In `publishRun` this is the new stage `bind`, which runs after the carCid adds and before the manifest add, so a failure means no add and no `runs/`. `cli.ts build` ends with `bindBuild` (the draft manifest), prints `bind: N roofing permit rows bound`, and exits 1 with "do not approve" on failure. | `run-month.test.ts` "records travis-austin, the roof profile and travis-places with their digests (CR-A-03 F-1)"; `bind-guard.test.ts` (real DuckDB): "binds a manifest with travis-austin, the roof profile and travis-places: 2 rows = permits_emitted", "refuses a manifest without the travis-places profile with BindGuardError", "refuses a bound row count that is not coverage.permits_emitted"; `upload.test.ts`: "binds the built manifest after the carCid adds and before the manifest add, with its exact bytes", "refuses a manifest without travis-places (real local bind): stage bind, 0 manifest adds, no runs/ files", "refuses a bound row count that is not permits_emitted: no manifest add", "binds the draft manifest of a finished build and reports the rows", "fails a build whose manifest would lack travis-places (real local bind), before any approval"; `cli.test.ts`: "fails the build when the draft manifest does not bind: exit 1, no approval line (CR-A-03 F-1)" and the build happy path (prints the bind line before the approval line). |
| F-2 | **Kept** | The strict `profiles[].gitCommit === HEAD` preflight stays. The D-8 runbook order applies: commit everything, run `run-month`, `build`, approve, `upload`, and only then commit `runs/`. | (existing) `upload.test.ts` "refuses a build whose recorded gitCommit is not HEAD…" |
| F-3 | **Deferred** (before A-11) | Archive and tables roots are still checked against the CLI upload summary. A gateway root-CID GET is not added. | n/a |
| F-4 | **Fixed** | `index.ts` no longer exports `runPublish`. It also no longer exports `runUpload` or `executePlan`, which would upload a build that `verifyApprovedBuild` never checked. The order tests import these from `sequence.ts`. | `index.test.ts` "does not export runPublish, the 12-step path without the D-8 approval", "does not export runUpload or executePlan, which upload a build no approval verified", "exports the approval-gated publishRun, the build-only runBuild and the bind guard" |
| F-5 | **Fixed** | `preflight` returns the approved `public-files.json` entries. `readbackGroup` and `readbackFile` take `approved`: each part is fetched by its APPROVED CID and compared with the approved size and SHA-256. A local file that differs from its approval, or is missing from it, fails, and so does a carCid that differs from the approved one. | `upload.test.ts` "fails a part changed on disk after the approval even when the gateway serves the changed bytes" (red on the old readback, checked), "reads each part back by its approved CID and records the approved SHA-256" |
| F-6 | **Fixed** | The adapter labels a timeout `error` (exit 1) and keeps `blocked_reason: "timeout"` on the receipt. A 403 or a challenge stays `blocked` (exit 2). `run-month.ts` passes the adapter's label through, and the string match is gone. | `socrata-adapter.test.ts` "F-6: labels a permit GET timeout `error` (exit 1), not `blocked`, keeping blocked_reason timeout", "F-6: labels a list-query timeout `error` (exit 1), before any permit GET"; existing TC-006 403/challenge cases still exit 2; `run-month.test.ts` "labels a timed-out permit GET an error (exit 1)…" still green |

/code-review Minor #5 and #6 (adapter, same files):
- **#5 Fixed.** A per-permit GET that returns several rows of the same number no longer aborts the run. The raw body is kept byte for byte. `pickPermitRow` keeps one row: identical rows give `identical_rows`; differing rows keep the latest watermark field, then the greatest canonical JSON, giving `differing_rows_kept_latest`. The receipt records `duplicate_rows` and `duplicate_reason`, and `job.json` records `duplicates` and `list_rows_repeated`. `run-month` writes `duplicates_by_reason` and a limitation line. Tests: "#5: de-duplicates identical rows…", "#5: keeps the latest of differing rows…", "#5: counts a permit number repeated in the list query…", and in run-month "does not abort when a permit GET returns the same permit twice; counts it in the summary (code-review #5)".
- **#6 Fixed.** `safePermitName` is the sanitised number plus `-` and the first 8 hex characters of its SHA-256. A resume skips a permit only when `status.permit_number === n`, and `loadCaptures` checks the same. Tests: "safePermitName is collision-free for numbers that sanitise alike (CR-A-03 code-review #6)", "#6: two numbers that sanitise alike get two status files, and a resume never skips the wrong one", "#6: a status file whose permit_number differs is not taken as done". Note: job directories written before this change use the old key names, so a resume re-captures them once.

`apps/api/test/helpers/fakes.ts` was not changed. Its `travis-places` profile is part of a correctly formed manifest fixture, not a mask, and the producer is now pinned by the F-1 tests above.

Suites: `pnpm vitest run` 955 passed / 7 skipped (60 files + 1 skipped); `pipeline/oracle-runtime` `npm test` 643 passed (45 files), `typecheck`, `lint` and `format:check` clean; `pnpm turbo run typecheck lint` 9/9; `pnpm format:check` clean.

Before D-8: re-run `run-month` (the kept run's `summary.json` has no `travis-places`), then `build`. Its new last step must print `bind: N roofing permit rows bound`. Then approve the new `public-files.json`. The guard requires the `v_roofing_permit` rows (Roofing/Replacement) to equal `permits_emitted`. If the profile ever emits a roofing permit with another action, the build will refuse it by name.

## Fixes (/code-review): infra, API, query-core, amplify.yml, CI

**Fixer:** `soofi-xyz-team-kit:metagross`, 2026-10-21, branch `003-walking-skeleton` on `570285d` (uncommitted). Tests were written first and run red, then the fix turned them green. No deploy, no AWS calls, no network.

| Finding | Status | Test (red → green) | Fix |
| --- | --- | --- | --- |
| /code-review Major 1 + metagross 1: bench can't list | Fixed | `infra/test/api.test.ts` › "reads only ipfs/* and private/bench/* … lists private/bench/* only". Red: `lists` had length 0. | `DataStack.grantApiRead` adds `s3:ListBucket` on the bucket ARN with `StringLike s3:prefix = private/bench/*`. GetObject stays on `ipfs/*` and `private/bench/*`. No listing of `ipfs/`. |
| Major 2: missing CID → 500 | Fixed | `apps/api/test/runs.test.ts` › "returns NOT_FOUND, never a 500 … AccessDenied (403…)" and "…(404)", plus "still rethrows a server-side S3 failure (500)". Red: the 403 case rethrew. | `s3-read.ts` `isAbsent` treats NoSuchKey, NotFound, 404, AccessDenied and 403 as absent, so the client gets NOT_FOUND. A 5xx from S3 is still rethrown. |
| Major 3: Amplify build fails without index | Fixed | New `infra/test/amplify-build.test.ts`: YAML structure, one guarded step, and the step run with bash in a temporary tree with and without `runs/index.json`. Red: the bare `cp` exited non-zero. | The `amplify.yml` step copies the index only `if [ -f ../../runs/index.json ]`. If there is no index, nothing is written: `/runs/index.json` returns 404 (the SPA fallback excludes `.json`), and the Runs page shows `RUN_INDEX_TEXTS.unreadable`. No placeholder data. |
| Major 4: VIEW↔TABLE rebind | Fixed | New `packages/query-core/test/rebind.test.ts`: real DuckDB with tiny Parquet, binding A, then B, then A on one engine. Red: `Catalog Error: Existing object person is of type Table, trying to replace with type View`. | `bindManifest` starts with `DROP SCHEMA IF EXISTS meta/county/property_improvement CASCADE`, so A's extra views are gone too. `fixture-export.ts` `bindFixture` takes an optional engine. |
| BIND_TTL flake (coordinator) | Fixed (root cause) | `runs.test.ts` › "re-binds after BIND_TTL_MS": 3,895 ms → 24 ms. The test already used a faked `Date` and the fake engine. | Root cause in `bind-manifest.ts`: the ZCTA grouping re-spread an array for every row, which is O(n²) over about 33k ZCTAs and took about 1.9 s of CPU per bind (Lambda and browser alike). It now pushes. The bind takes about 20 ms. |
| Minor 7: unused required keys, duplicate BARE_HOST | Fixed | `apps/api/test/config.test.ts` (5 red → green) | The API requires only `CID_COPY_BUCKET` and `READPATH_PRIVATE_PREFIX`. The duplicated regex is removed; host validation stays in `@countylens/shared`. |
| Minor 10 / API double hash | Not changed | n/a | The finding is in `apps/web` (not in my scope). On the API side the second `rawCid` is a sub-millisecond SHA-256 of about 1.4 KB. |
| Minor 8 (`apps/web` config duplication) | Not in my scope | n/a | Belongs to the `apps/web` owner. |
| Minor 9 (slow first load) | **Deferred → A-13** | n/a | The O(n²) bind fix above also removes about 1.9 s of CPU from the browser bind. |
| metagross 2: budget | Fixed | `infra/test/stacks.test.ts` › TC-052 budget cases, now unconditional (no `BUDGET_REGION` skip). Red: no `Custom::CountyLensBudget`. | `OpsStack` uses an `AwsCustomResource` (`Custom::CountyLensBudget`): Budgets `CreateBudget` / `UpdateBudget` / `DeleteBudget`, physical id `countylens-monthly`, 10 USD MONTHLY COST, 80 % ACTUAL and 100 % FORECASTED to EMAIL, project tag. The IAM grant is `budgets:ModifyBudget/ViewBudget/TagResource` on `budget/countylens-monthly` only. The provider has 14-day logs, X-Ray Active and `Logging.withDataHidden()` (the email is in the parameters). `BudgetStack` is removed. The singleton provider Lambda runs on deploy only, so it costs **$0 idle**. |
| metagross 3: wrong-region synth | Fixed | `stacks.test.ts` › three "metagross M3" cases. Red: `RegionNotAllowedError` was undefined and synth did not throw. | `loadConfig` throws `RegionNotAllowedError` when `CDK_DEFAULT_REGION` is not in the required context key `countylens:allowedRegions`. `infra/cdk.json` = `["eu-north-1"]` (outside `infra/src` because of the region-literal gate). us-east-1 and us-east-2 are refused. |
| metagross 4: e2e-hosted env | Fixed | New `infra/test/ci-workflow.test.ts` (YAML parse, env from `vars.*` only, credential-free). Red: env had only `AMPLIFY_APP_ID`. | `ci.yml` `e2e-hosted` gets `AWS_REGION`, `CDK_DEFAULT_REGION`, `OPERATOR_EMAIL`, `CID_COPY_HOST`, `FILEBASE_GATEWAY_HOST` and `PINATA_GATEWAY_HOST` from repository variables. It has no AWS step and no id-token, so `@needs-aws` stays excluded. |
| metagross 5: token revocation vs later Web updates | **Deferred → D-10 check** | n/a | Test one no-op App update after revocation and record it in the run log. |
| metagross 6: G6-matrix specs | **Deferred → wave W4** (T061/T068) | n/a | n/a |

**Suites:** root `pnpm vitest run` passed twice with the same counts, 60 files passed and 1 skipped (955 tests passed, 7 skipped); infra `COUNTYLENS_BUNDLE=1` 76/76; `pnpm turbo run typecheck lint` 9/9; `pnpm format:check` clean; `scripts/grep-gates.sh` OK.

**Follow-ups outside my files:** `infra/src/api-stack.ts` still says "no List action is granted" in the role description and the IAM5 acknowledgement reason, and both should name the bench-prefix ListBucket. `turbo.json` `test.env` should drop `BUDGET_REGION` and add `COUNTYLENS_BUNDLE`. Add `yaml` as an infra devDependency: the two new tests currently resolve the workspace copy through `pipeline/oracle-runtime`. Update `docs/reports/A-03-unit-test-report.md` (the BUDGET_REGION skip note). Add the budget provider ($0 idle) to the idle-cost table in plan.md. `infra/cdk.json` got one context key (`countylens:allowedRegions`).

## Re-score: oracle (whole branch, 327c11f)

Reviewer: `soofi-xyz-team-kit:oracle`, read-only, 2026-10-21, commit `327c11f` (tree clean). Skills: `use-oracle`, `apply-engineering-guidelines`. Static review only: no tests, CLI, network or AWS calls. Same bar as the final review: ARD incl. § 16 AM-01…AM-06, the Task A addendum, spec/plan/tasks, `contracts/cli.md`, and the oracle guardrails.

### Score: 88 / 100 (pass; the bar is 75)

The final review's 72 was held down by F-1 alone. F-1 is now fixed: the producer writes the profile, a real-engine guard runs on the publish path, and named tests cover both. F-4, F-5 and F-6 are also fixed. Points still off: F-3 (root readback against the node's claim, not through a gateway) is deferred; OR-3, OR-5, OR-11, OR-12 and OR-13 stay open on their agreed targets; and a few Minor items are listed below. No Critical or Major finding is open.

### Final-review findings: status

| # | Status | Evidence at 327c11f |
| --- | --- | --- |
| F-1 | **Fixed (verified)** | `run-month.ts:91-92` (`GAZETTEER_PATH`, `GAZETTEER_PROFILE`), `:750-756` (third profile in `profiles[]`), `:794-803` (`gazetteerDigest` checks the generated constant against the on-disk `DIGEST`). Guard: `pipeline/publish/src/bind-guard.ts` `assertBindable` checks the run id, the manifest CID, roofing rows = `coverage.permits_emitted`, and that the list query and the summary agree. `upload.ts:540-551`: stage `bind` runs before `kuboAddBytes` of the manifest. `upload.ts:387-409`: `bindBuild` runs at the end of `build`. Binder: `pipeline/publish/scripts/local-bind.ts`, which is the real query-core `bindManifest` over node DuckDB and stays outside `src/` (AD-19). Tests: `run-month.test.ts:295` "records travis-austin, the roof profile and travis-places with their digests (CR-A-03 F-1)"; `bind-guard.test.ts:150` "refuses a manifest without the travis-places profile with BindGuardError"; `cli.test.ts:248` "fails the build when the draft manifest does not bind…". Operational: no run on disk carries `travis-places` yet. A fresh `run-month` → `build` (which must print `bind: N … bound`) → new D-8 approval is required. |
| F-2 | **Kept** (accepted) | The strict `gitCommit === HEAD` preflight stays. The D-8 runbook order is the mitigation. This is correct fail-closed behaviour. |
| F-3 | **Deferred → before A-11** | `readback.ts` still checks the archive and tables roots against the CLI upload summary. Parts and carCid files are read back through the gateway. |
| F-4 | **Fixed (verified)** | `pipeline/publish/src/index.ts` no longer exports `runPublish`, `runUpload` or `executePlan`. Test: `index.test.ts:8` "does not export runPublish…". |
| F-5 | **Fixed (verified)** | `readback.ts:145-167`: with `approved`, the expected size, SHA-256 and CID come from `public-files.json`, and a local drift is a problem. `:313-315`: a carCid that differs from the approved one is refused. Test: `upload.test.ts:1167` "fails a part changed on disk after the approval even when the gateway serves the changed bytes". |
| F-6 | **Fixed (verified) at the adapter** | `socrata.ts:368-374`: `adapterOutcome` maps a timeout to `error` (exit 1); a 403 or a challenge stays `blocked` (exit 2). `run-month.ts:413-416` passes the label through and the string match is gone. Test: `socrata-adapter.test.ts:657`. Residual: see N-1. |
| F-7 | Note (unchanged) | Browser part integrity rests on the CID copy and `verify-manifest`. Acceptable for A-03; it must be stated in the evidence. |

Early-review items: OR-3 open (G7), OR-5 open (before A-11), OR-11 open (G7), OR-12 open (D-8 evidence), OR-13 open (release). All other OR items remain fixed.

/code-review #5 and #6 (adapter): fixed. The changes are in `socrata.ts` (`pickPermitRow`, collision-free `safePermitName`, `permit_number` check on resume), with the named tests in `socrata-adapter.test.ts`. I verified them by reading the diff summary and the test names, not line by line.

### New findings

| # | Severity | File:line | Finding | Fix |
| --- | --- | --- | --- | --- |
| N-1 | Minor | `pipeline/oracle-runtime/travis/lib/source-client.ts:584-586` | The shared client still sets `outcome: "blocked"` for a timeout. Socrata re-maps it, but every future adapter (A-05/A-06) must remember to do the same, or it will exit 2 on a timeout. | Make the client emit `failed` with `blocked_reason: "timeout"` kept (or add a `timeout` outcome) and drop the per-adapter remap. Alternatively, move `adapterOutcome` into `lib/`. |
| N-2 | Minor | `pipeline/publish/scripts/local-bind.ts:9-14`; `pipeline/publish/package.json` | The binder imports query-core and its DuckDB adapter by relative path, with no workspace dependency declared. DuckDB resolves only through query-core's install, so a filtered install or deploy of `@countylens/publish` alone breaks `build`, though it fails closed. | Declare `@countylens/query-core` (workspace) as a dev or optional dependency, or document that a full-workspace install is required. |
| N-3 | Note | `bind-guard.ts` (rows = `permits_emitted`); `builders.ts:28` ("edges of one permit") | If a permit ever produces two `v_roofing_permit` rows (two edges), or a non-Roofing/Replacement action is emitted, the guard refuses a valid build. This fails closed, so it is safe, and the fixer documented it. | If it fires, count `DISTINCT permit_number` in the guard rather than loosening it. |
| N-4 | Minor (metagross follow-up) | `turbo.json` `test.env` | It lacks `COUNTYLENS_BUNDLE` (and `BUDGET_REGION` is now unused), so a cached infra pass can be replayed across bundle modes. | Add `COUNTYLENS_BUNDLE` and drop `BUDGET_REGION`. |

### Guardrails re-checked

- Public bytes are only `elephant-cli` output plus the descriptive manifest and the index. The Query DB is not imported in `pipeline/publish/**`, `apps/**` or `packages/query-core/src`.
- No contractor, person or license is written from permits (`CONTRACTOR_NOTE` limitation; AD-24 states remain `contractor_unresolved`).
- No Atlas, IPNS or MCP publication claim is made in A-03 (P0-4).
- The D-8 approval gate, refusal before any network write, and order-as-data are unchanged.

### Confidence

High on F-1, F-4, F-5 and F-6: I traced each in the code and matched it to a named test. I did not run the tests; the suite counts are the fixers' (`pnpm vitest run` 955/7 skipped; oracle-runtime 643). Medium on N-2's practical impact, which depends on how CI installs. Not re-reviewed: infra/API/UI internals beyond the publish and read seams (metagross scope). The kept run on disk predates F-1. The upload remains blocked operationally until a fresh capture, a build whose bind passes, and a new D-8 approval exist.

## Re-score: metagross (whole branch, 327c11f)

**Reviewer:** `soofi-xyz-team-kit:metagross` (read-only), 2026-10-21, branch `003-walking-skeleton` at `327c11f`. Skills loaded: build-frontend-backends, integrate-ci-cd, responsive-design-tests, apply-engineering-guidelines. No tests were run, no files were changed, and no AWS or network calls were made. Every status below comes from reading the code and the test names at this commit.

**Score: 81 / 100** (passes the 75 bar; was 70 at `570285d`). There are no open Critical or Major findings. The two remaining Majors (5 and 6) are deferred with named targets (D-10 and W4) and still block G7 evidence, not this re-score.

### Earlier findings: status

| # | Finding | Status | Evidence at 327c11f |
| --- | --- | --- | --- |
| M1 (+ /code-review Major 1) | Bench cannot list its prefix | **Fixed, verified** | `infra/src/data-stack.ts:253-270`: GetObject is limited to `ipfs/*` and `private/bench/*`. A separate statement `ListBenchPrefixOnly` grants `s3:ListBucket` on the bucket ARN with `StringLike s3:prefix = private/bench/*`, and `ipfs/` cannot be listed. Test: `infra/test/api.test.ts:163` "reads only ipfs/* and private/bench/* … lists private/bench/* only" (`:201` asserts exactly `["s3:ListBucket"]`). The IAM5 reason in `infra/src/api-stack.ts:362` now names the bench ListBucket. |
| /code-review Major 2 | A missing CID returns 500 instead of NOT_FOUND | **Fixed, verified (different fix from the one proposed; see N3)** | `apps/api/src/s3-read.ts:99-104`: `isAbsent` treats NoSuchKey, NotFound, 404, `AccessDenied` and 403 as absent, and `:121-127` maps them to `TRPCError NOT_FOUND`. An S3 5xx is still rethrown. Tests: `apps/api/test/runs.test.ts:105` (NOT_FOUND) and `:137` ("still rethrows a server-side S3 failure (500)"). |
| /code-review Major 3 | `amplify.yml` needs `runs/index.json` | **Fixed, verified** | `amplify.yml:44-46`: the step copies the index only `if [ -f ../../runs/index.json ]`, otherwise it logs and writes nothing. Nothing placeholder is served. The SPA fallback regex excludes `.json` (`infra/src/web-stack.ts:41`), so `/runs/index.json` returns 404, and `apps/web/src/data/runs-index.ts:40-54` turns that into `unreadable`. Test: `infra/test/amplify-build.test.ts` runs the step with bash with and without the index. |
| /code-review Major 4 | VIEW↔TABLE rebind | **Fixed, verified** | `packages/query-core/src/bind-manifest.ts:168-175`: `DROP SCHEMA IF EXISTS meta/county/property_improvement CASCADE` runs before the schemas are created, so stale views over expired presigned URLs are removed too. Test: `packages/query-core/test/rebind.test.ts` binds A, then B, then A on one real DuckDB. |
| M2 | No budget deployed; TC-052 hides it | **Fixed, verified (two Minor hardening gaps: N1, N2)** | `infra/src/ops-stack.ts:205-300`: `Custom::CountyLensBudget` is an `AwsCustomResource` inside `CountyLensOps` (eu-north-1; no other stack or region is used). It is 10 USD MONTHLY COST with 80 % ACTUAL and 100 % FORECASTED alerts to EMAIL and no budget action. Create, Update and Delete are wired, and the physical id is `countylens-monthly`. **Least privilege:** the only statement is `budgets:ModifyBudget/ViewBudget/TagResource` on `arn:aws:budgets::<acct>:budget/countylens-monthly`. The ARN format is correct, and TagResource is required because CreateBudget sends `ResourceTags`. X-Ray is on `*` (it has no resource-level form), and the cdk-nag acknowledgements give reasons. **Self-cleaning:** `onDelete` calls `DeleteBudget`, and the provider log group has 14-day retention with `RemovalPolicy.DESTROY`. **$0 idle:** a budget with notifications only is free (the first two action-free budgets in an account cost nothing), and the singleton provider Lambda runs only on deploy. `installLatestAwsSdk: false` and `Logging.withDataHidden()` (the email is not logged) are both good. Tests: `infra/test/stacks.test.ts:539` and `:597`, now with no `skipIf`, and `BUDGET_REGION` is gone from the repo. |
| M3 | No wrong-region guard | **Fixed, verified** | `infra/src/config.ts:23-30` defines `RegionNotAllowedError`. `:69-74` requires a non-empty `countylens:allowedRegions`, and `:118-119` throws when `CDK_DEFAULT_REGION` is not in that list. `infra/cdk.json:8` is `["eu-north-1"]`. Tests: `stacks.test.ts:192`, `:210`, `:221` ("synth for N. Virginia throws"). |
| M4 | CI `e2e-hosted` env | **Fixed, verified** | `.github/workflows/ci.yml:252-259` reads `AMPLIFY_APP_ID`, `AWS_REGION`, `CDK_DEFAULT_REGION`, `OPERATOR_EMAIL`, `CID_COPY_HOST`, `FILEBASE_GATEWAY_HOST` and `PINATA_GATEWAY_HOST` from `vars.*` only. The job is credential-free on purpose (`:247`). Test: `infra/test/ci-workflow.test.ts`. |
| M5 | Amplify token revocation vs later Web updates | **Deferred → D-10** | To be checked at D-10: run one no-op App update after the token is revoked and record the result in the run log. |
| M6 | G6-matrix specs missing | **Deferred → W4 (T061/T068)** | `tests/e2e/` still has no `observability`, `perf`, `responsive` (smeargle 390/768/1440), `lambda-fallback.perf` or `read-path-record` specs. This blocks G7, not this score. |
| m7 | Weak cross-stack refs can go stale | **Open (Minor)** | `infra/cdk.json:93` is still `"weak"`. Neither `docs/architecture-constitution.md` nor the spec mentions it. Add the ARD note and the `--force` caveat before D-10. |
| m8 | `.wasm` Content-Encoding br | **Deferred → D-10 hosted check** | `infra/src/web-stack.ts:184` is unchanged. Check it with `curl -sI` after D-10. |
| m9 | Cert waits on DNS | **Deferred → D-10** | Covered by T050 (`specs/003-walking-skeleton/tasks.md:134`). |
| m10 | turbo test cache keys | **Partly fixed** | `BUDGET_REGION` is gone. `COUNTYLENS_BUNDLE` (`infra/test/api.test.ts:375`) is still missing from `turbo.json` `test.env` (`:33-40`). Add it. |
| m11 | `deploy` job red until D-10 | **Open (accepted)** | `ci.yml:218` guard. State it in the PR body. |
| /code-review m7 | API requires unused keys | **Fixed** (per the fix log; `apps/api/test/config.test.ts`) | n/a |
| /code-review m8, m10 | web config duplication, double hash | **Open (Minor, `apps/web`)** | Not changed. |
| /code-review m9 | slow first load | **Deferred → A-13** | The O(n²) bind fix removes about 1.9 s of CPU in the meantime. |
| follow-up | `yaml` infra devDependency | **Fixed** | `infra/package.json:27`. |

### New findings

- **N1 (Minor): budget delete and create are not idempotent.** `infra/src/ops-stack.ts:260-266`: `onDelete` has no `ignoreErrorCodesMatching`. If the budget is already gone (deleted by hand, or a failed first create rolls back), `DeleteBudget` throws `NotFoundException`, and the stack ends in `DELETE_FAILED` or `ROLLBACK_FAILED`, which needs manual cleanup. In the same way, `CreateBudget` fails with `DuplicateRecordException` if a `countylens-monthly` budget already exists. *Fix:* add `ignoreErrorCodesMatching: "NotFoundException"` to `onDelete`. Add a CDK assertion that the Delete call carries it. Optionally, document that the budget name must be unused before the first deploy.
- **N2 (Minor): `onUpdate` cannot change the email recipient.** `ops-stack.ts:253-258` calls `UpdateBudget` with the definition only (the comment at `:202-203` admits it). A change to `OPERATOR_EMAIL` updates the SNS subscription but leaves the budget alerts going to the old address, with no error. *Fix:* put the email (or a hash of it) into the physical id so a change forces replace (create the new budget, then delete the old). Or document the limitation in the D-10 runbook.
- **N3 (Minor): 403 mapped to NOT_FOUND hides an IAM regression.** `apps/api/src/s3-read.ts:102,104`: if the GetObject grant were ever broken, every `runs.summary` would return NOT_FOUND, and the `countylens-api-5xx` alarm would never fire. This is a reasonable trade-off: a prefix-conditioned ListBucket does not reliably turn a missing-key 403 into a 404, and an unconditioned `ipfs/` list was declined. *Fix:* log a Powertools warning and emit a metric (`ManifestAbsent403`) on the 403 branch, so a wave of them is visible. The CDK assertion at `api.test.ts:163` already guards the grant.
- **N4 (Info): Budgets endpoint from eu-north-1.** The provider's SDK v3 Budgets client in eu-north-1 should resolve to the global `budgets.amazonaws.com` endpoint (signing region us-east-1). This is not a regional resource, so it is compliant. Confirm on the first D-10 deploy (the Ops stack reaches CREATE_COMPLETE, and `aws budgets describe-budget` shows it).

### Confidence

High for M1–M4 and the four /code-review Majors: the code and the tests named above were read at `327c11f`. Medium-high for the budget's correctness. The ARN format, the actions and the delete wiring were read, but the Budgets endpoint resolution and the `ResourceTags` support in the provider's bundled SDK were not exercised (no AWS calls). The N1 failure path follows from AwsCustomResource's default error handling. M5, m8 and m9 can only be settled at D-10. Not reviewed: `pipeline/**` internals and the internals of `packages/**` beyond `bind-manifest.ts`.

## Delta review: oracle (fe2b26a)

Scope: `git diff 327c11f..fe2b26a` in pipeline/**, packages/query-core, packages/shared, scripts/grep-gates.sh, the publication record (runs/), ERR-10…19 data paths in apps/api and apps/web. Read-only; no network, no AWS.

### Score: 90 / 100 (pass; the bar is 75; up from 88)

### What changed since 327c11f
- **View-subset binding (ERR-19).** `packages/query-core/src/view-plan.ts` derives each statement's tables and view dependencies from `VIEWS_SQL` itself (no hand-kept list), and `bindManifest({ views })` binds only those tables and drops all four contract views first, so a subset bind leaves no stale view behind. `test/view-plan.test.ts` shows that `runSummarySql`, `listRoofingPermitsSql`, `radiusSql`, `roofAgeSql` and `v_contractor` return the same rows over a subset bind as over a full bind. The default (no `views`) is unchanged.
- **API parts read once (ERR-19).** `apps/api/src/s3-read.ts` `localPart` fetches each raw part of 256 KiB or less once, checks its raw-leaves CID, writes it atomically to /tmp, and fails the bind if the write fails. Larger parts still use presigned range reads (`PREFETCH_MAX_PART_BYTES` matches `rawCid`'s chunk limit, so the CID check always applies). `bindOnce` re-binds with the union of the bound views and the new ones. `exclusive` runs binds and queries on the connection one at a time.
- **Web parts read once (ERR-15/16/17).** `apps/web/src/data/fetch-parts.ts` reads each part from the same host that served the manifest, with one ranged GET per part, bounded concurrency and retries only on 429, 5xx and network errors. It accepts the bytes only when the length and the raw CID match the manifest (constitution A3). It refuses to prefetch above 16 MiB. A host never changes during a load.
- **Arrow → rows (ERR-11).** `apps/web/src/engine/duckdb-wasm.ts` `arrowToRows` converts by Arrow type: DATE becomes YYYY-MM-DD, TIMESTAMP becomes ISO UTC, and LIST and STRUCT are converted recursively. These are the same JSON shapes as the node adapters, so the browser and the API produce the same rows. Unreadable rows show `PERMITS_TEXTS.rowsUnreadable` instead of a guessed value.
- **Capture exit classes.** `pipeline/oracle-runtime/travis/lib/source-client.ts` `stopClass`/`stopExitCode`: only HTTP 403 or a challenge returns exit 2 (blocked, a human must look). A timeout is exit 1. The receipt itself is unchanged.
- **Publication record.** `runs/index.json` and `runs/travis-202609-permits-20261021t103516z/manifest.json` contain only CLI output references: one CAR per group (county, property_improvement), the CLI-exported tables directories, and raw CIDv1 parts with sha256 and size. Profiles are pinned to 327c11f. The coverage notes are honest: `contractor_unresolved` 35, no contractor/person/license written, roof-age `partial_history` caveat. The record contains no Query DB data, no credentials and no private rows.
- **grep-gates.** Calling grep directly keeps exit codes 0/1/2 on both GNU and BSD (`set -u` only, so exit 1 does not abort the script). `pipeline/publish/scripts/local-bind.ts` now imports `@countylens/query-core` by package name (resolves the earlier N-2 finding).

### New findings
- Critical: none. Major: none.
- **Minor M-1:** `apps/api/src/s3-read.ts:221`. In `localPart`, a GetObject `NoSuchKey`/403 for a part is not mapped the way `getManifest` maps it, so a part missing from the CID copy becomes an unclassified 500 (it trips the 5xx alarm and gives no `ManifestAccessDenied`-style signal). Fix: reuse `isAbsent`/`reportAccessDenied` and throw a typed `NOT_FOUND`/`INTERNAL_SERVER_ERROR` that names the part CID.
- **Minor M-2:** `pipeline/publish/scripts/local-bind.ts:21-58`. This duplicates query-core's node adapter (`plain`, `openDuckDb`), so a change to the value shape in one copy (DATE/TIMESTAMP/BIGINT) can silently break the bind-guard's identical-rows check. Fix: export the adapter from query-core (for example a `./node` subpath) and import it here, or add a test that runs both adapters on the same fixture and compares the rows.
- **Minor M-3:** `apps/api/src/routers/query.ts:42`. `roofAge` works out its views from SQL built with a placeholder `asOf`. This is correct today, but the comment's assumption is not tested. Fix: add a test that `viewsReadBy(roofAgeSql(x))` is the same for any two `asOf` values, or have query-core export a static `ROOF_AGE_VIEWS`.

### Confidence
High for query-core (view-plan.ts and its tests), s3-read.ts, duckdb-node.ts, fetch-parts.ts and the runs/ record, which I read in full. Medium for arrowToRows across every DuckDB type, because I read the type-led converter and the names of the `arrow-rows-real` tests but did not run them. I did not re-check hosted timings or the CI e2e configuration (ERR-14, ERR-18 infra): they are outside my area.

## Delta review: metagross (fe2b26a)

**Reviewer:** `soofi-xyz-team-kit:metagross` (read-only), 2026-10-21, `git diff 327c11f..fe2b26a` on `003-walking-skeleton`. Skills loaded: build-frontend-backends, integrate-ci-cd, responsive-design-tests, apply-engineering-guidelines. No tests were run, no AWS or network calls were made, and no other file was changed. The hosted results (43/43 TCs across runs 2–3) were taken from `docs/reports/A-03-test-report.md` and not re-run.

**Score: 86 / 100** (was 81 at `327c11f`). There are no Critical or Major findings. All four earlier Minors in my area are closed, and the G6 spec gap (M6) is filled. One new Minor (D1) is a latent race in the API re-bind. Three more are small.

### What changed, and the status of the earlier findings

| Item | Status at fe2b26a | Evidence |
| --- | --- | --- |
| AM-08: OIDC and the CI deploy job removed | **Correct and complete** | `.github/workflows/ci.yml` has no `deploy` job, no `id-token`, no `configure-aws-credentials`. `e2e-hosted` now `needs: [workspace, oracle-runtime, gitleaks]` and still waits for `/build.json` SHA. `infra/src/ops-stack.ts` has no `OidcProviderNative` or role, and `app.ts` no longer passes `github`. Recorded in `docs/architecture-constitution.md:437` (AM-08) with the SCP reason. This deviates from integrate-ci-cd's deploy-by-CI path, but the deviation is forced and documented, which is acceptable. |
| CI install order | **Correct** | `ci.yml` `oracle-runtime`: `pnpm/action-setup` → `setup-node` → root `pnpm install --frozen-lockfile` before the unchanged `npm ci` steps. `e2e-hosted`: `npm ci` in `pipeline/oracle-runtime` for TC-006. The new `NO_TCAD_PERMIT_NUMBERS` comes from `vars.*`, with no literals. |
| Cert without `certificateSettings` | **Correct** | `infra/src/cert-stack.ts:56-58`: omitting it gives the Amplify-managed default, and the comment records the failed deploy. |
| N1: budget delete is not idempotent | **Fixed** | `ops-stack.ts:208-219`: `onDelete` sets `ignoreErrorCodesMatching: "NotFoundException"` and uses `PhysicalResourceIdReference`. |
| N2: email change is silent | **Fixed (good design)** | `budgetNameFor` (`ops-stack.ts:321-333`) hashes limit, thresholds and the normalised email into the name. `onUpdate` = CreateBudget, ignoring `DuplicateRecordException`. A new name makes CloudFormation replace the resource, and cleanup deletes the old one. The IAM scope is `budget/countylens-monthly-*`, with the cdk-nag reason. |
| N3: 403 → NOT_FOUND is invisible | **Fixed** | `apps/api/src/s3-read.ts`: `reportAccessDenied` logs a warning with IDs only and emits `ManifestAccessDenied` (Count). Tested in `apps/api/test/s3-read-observability.test.ts`. |
| m7: weak cross-stack refs | **Closed** | ARD AM-07 (`architecture-constitution.md:436`). |
| m8: `.wasm` with `Content-Encoding: br` | **Superseded** | The header was removed (Amplify rejects it). The build ships `duckdb-eh-*.wasm.gz`, and `fetchGzippedWasm` gunzips it with `DecompressionStream`. It skips the double decode when the host already set `Content-Encoding: gzip`. The SPA fallback regex adds `gz` (`web-stack.ts:43`), so a missing `.gz` is a real 404. |
| m10: turbo env | **Fixed** | `turbo.json` `test.env` now includes `COUNTYLENS_BUNDLE`. |
| M6: G6-matrix specs | **Filled** | `tests/e2e/{observability,perf,responsive,lambda-fallback.perf,read-path-record}.spec.ts` exist. `responsive.spec.ts` covers 390/768/1440, matching the real-device/browser lane of responsive-design-tests (tolerant layout and overflow checks, not pixel equality). |
| Lambda 3,008 MB / threads 4 (ERR-18) | **Acceptable** | It costs per invocation only, with $0 idle and no reserved concurrency. The comments mark the AM-06 text change as pending with the PO, so it needs a one-line AM-06 amendment before G7. `DUCKDB_MEMORY_LIMIT` is still 1 GB, which leaves headroom and is fine. |
| `infra/vitest.config.ts` 60 s timeouts | **Acceptable** | Justified by CI run 39616530023. |
| Web: vendored extensions | **Good** | Autoinstall and autoload are off before any statement. parquet, json and icu v1.5.4 `wasm_eh` are Vite assets, LOADed only from `blob:` URLs (`loadExtensionSql` guard). DuckDB's signature check stays on. `manifest.json` pins the raw SHA-256. |
| Web: parts read once | **Good** | `apps/web/src/data/fetch-parts.ts`: concurrency is per host kind (copy 16, Filebase 3). Backoff runs 1/2/4/8 s on 429, 5xx and network errors. Each part's size and raw CID are checked before `registerFileBuffer`, and there is a 16 MiB cap above which the engine range-reads instead. |
| Web: landmark order, error texts, User Timing | **Good** | `AppShell.tsx` DOM order is banner → nav → main, with grid areas keeping the visual order. `PermitRowsError` keeps the detail out of the banner. |
| API: view-subset bind and `/tmp` part cache (ERR-19) | **Good, with one race (D1)** | `packages/query-core/src/view-plan.ts` derives the view→table graph from `VIEWS_SQL`, with no hand-kept list. `localPart` verifies the raw CID before writing atomically to `/tmp`. Caching with `NO_VALIDATION` is safe because the `ipfs/<cid>` bytes are immutable and bench URLs are keyed by ETag. |

### New findings

- **D1 (Minor): concurrent re-binds can leave `bound` and the schema out of step.** `apps/api/src/engine/duckdb-node.ts:149-166` (`bindOnce`) and `:111-136` (`bind`). The shared client uses `httpBatchLink` (`packages/api-client/src/index.ts:56`), so a single invocation can run two procedures with different view sets at the same time. Call 1 starts `bind(cid, A)`. Call 2 sees that A does not cover its views and starts `bind(cid, A∪B)`, setting `bound.views = A∪B`. Only the final `bindManifest` is serialised by `exclusive`, and the S3 fetches before it are not. If call 1's fetches finish last, its `bindManifest(A)` runs after the union bind, and the `DROP SCHEMA … CASCADE` removes B's views. Every later request in that sandbox then trusts `bound` and fails ("view does not exist") until `BIND_TTL_MS` (30 min) passes. This is unlikely, because A's parts are a subset and usually finish first, but nothing guarantees that order. *Fix:* run the whole `bind` (manifest, parts, `bindManifest`) inside `exclusive`, or have `bind` skip its `bindManifest` when `bound.run` is no longer its own promise. Add a unit test with two overlapping `bindOnce` calls whose first fetch resolves last.
- **D2 (Minor): stale test reference.** `apps/web/scripts/vendor-duckdb-extensions.ts:12-13` names `test/duckdb-extensions.test.ts`, which does not exist. The SHA-256 check is in `apps/web/test/read-path-defects.test.ts:241`. *Fix:* correct the comment.
- **D3 (Minor): the 403 reporter's logger has no request context.** `s3-read.ts` creates its own `Logger` and `Metrics` (`s3ReadObservability`). The warning therefore lacks the handler's correlation and request ID, and `publishStoredMetrics()` flushes outside the handler's metrics lifecycle. *Fix:* inject the handler's Powertools instances (as `setQueryObserver` does), or add the request ID through `logger.appendKeys` in the handler.
- **D4 (Info): legacy budget name.** If a budget named exactly `countylens-monthly` was ever created by an earlier Ops deploy, the new IAM scope (`countylens-monthly-*`) cannot delete it during cleanup. The stack would still complete, but an orphan budget would remain. Check `aws budgets describe-budgets` once at D-10 and remove any orphan by hand.

### Confidence

High for the infra, CI and budget changes: I read the full diff, and the logic matches CloudFormation custom-resource replacement semantics. High for the web gzip, extension and part-prefetch paths, from the code (browser behaviour was not executed here, but the hosted runs report it green). Medium-high for D1: the interleaving follows from the code, but whether the hosted client actually batches two query procedures in one request was not traced. Not reviewed: `pipeline/**`, the `tests/e2e` assertion bodies beyond `lib/evidence.ts`, and the `.module.css` details.
