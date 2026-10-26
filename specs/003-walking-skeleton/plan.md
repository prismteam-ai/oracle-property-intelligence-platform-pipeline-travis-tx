---
id: PLAN-A-03
type: implementation-plan
parent: A-03
spec: specs/003-walking-skeleton/spec.md
design: specs/003-walking-skeleton/agent-design.md
decisions: [docs/decisions/0001-read-path.md, docs/architecture-constitution.md § 16]
gate: G5
created: 2026-10-21
---

# Implementation Plan: Publish one month of Austin roofing permits by CID and show them in the hosted UI

**Branch**: `003-walking-skeleton` | **Date**: 2026-10-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-walking-skeleton/spec.md`; technical direction from [agent-design.md](agent-design.md) (oracle + metagross answers and the Disagreements table), PO decisions D-1…D-5 ([run-log.md](run-log.md)), [ADR-0001 read path](../../docs/decisions/0001-read-path.md) (Accepted) and ARD § 16 amendments AM-01…AM-06.

## Summary

A thin, real, end-to-end slice: capture the September 2026 Austin reroof permits (`3syk-w9eu`) through a Socrata adapter module in the vendored kit runtime's Travis folder, classify them only with the frozen profile `travis-austin@1.0.0`, publish the `county` and `property_improvement` groups only as `elephant-cli` output (validate → hash + CAR → validate CAR → export-tables `--part-size 48m` → upload with readback), write `runs/{runId}/manifest.json` (JCS, CIDv1) and `runs/index.json`, copy every artifact byte-for-byte into an S3 + CloudFront CID copy, and serve a hosted Runs page and Permits list (React SPA on Amplify) that read the CID copy first and the Filebase gateway as the labelled fallback. The browser runs DuckDB-WASM (range reads on, Brotli WASM) for the Permits list; radius and roof-age move to a Lambda DuckDB fallback (ADR-0001), proved in-region with 20 direct invocations on a private, non-CloudFront prefix. Five CDK stacks (Data → Api → Web → Ops → Cert), Powertools observability, SNS email alarms and a $10 budget complete AC-7. `verify-manifest` checks every artifact on Pinata + Filebase.

## PO decisions carried into this plan (copied from run-log.md)

| # | Round | Decision (PO words) | What the plan does |
| --- | --- | --- | --- |
| D-1 | R1 | AC-3 "Use contract columns (Recommended)"; AC-5 "Labels + Runs count (Recommended)"; NFR traces "Add to AC-2/3 and AC-7 (Recommended)"; TCAD scope "Yes, show both sources (Recommended)"; G4 "Ready (Recommended)" | Permits list shows the frozen `v_roofing_permit` columns (`improvement_status`, `status_class`, `contractor_resolution`) with labelled `missing` reasons; Runs shows `coverage.permits_no_tcad_geoid` labelled "No TCAD id on source record"; both sources (Austin first, then `tcad-2026-certified-json`). |
| D-3 | R2 | Scale "Full Austin table, keep AC-4 (Recommended)"; spike stack "Yes, deploy and remove (Recommended)"; gateway legs "Public CIDs now, ours later (Recommended)" | Spike done (ADR-0001). The gateway legs on A-03's own CIDs are re-measured after D-8 (T-task in Phase 6). |
| D-4 | R3 | Read path "Accept (Recommended)"; verify gateways "Pinata + Filebase (Recommended)"; Lambda proof "Private prefix + direct invoke (Recommended)" | CloudFront CID copy first, Filebase labelled fallback; `--part-size 48m`; Filebase Free; radius + roof-age on the Lambda DuckDB fallback; DuckDB-WASM opened with `{ allowFullHTTPReads: true, forceFullHTTPReads: false, reliableHeadRequests: false }`; WASM served Brotli; `verify-manifest` on `gateway.pinata.cloud` + `ipfs.filebase.io` (plain GETs); Lambda proof = 20 direct `aws lambda invoke` runs over `private/` prefix copy of the 48m Austin Parquet, deleted afterwards with the deletion in evidence. |
| D-5 | R4 | Kit runtime "Adapter module now (Recommended)"; CAR check "Approve additive carCid (Recommended)"; infra "Approve both (Recommended)" | Adapter at `pipeline/oracle-runtime/travis/adapters/socrata/`, driven by `travis/runs/run-month.ts` (Restate wiring in A-05/A-06); each `.car` also Kubo-`add`ed as a raw-leaves file and its `carCid` recorded on `car` artifacts; deploy order Data → Api → Web → Ops → Cert; query log = HTTP API JSON access log, 30 days. |
| D-2 | R4 | Spec "Approve all three (Recommended)" | Fallback when the CID copy errors, returns non-200 or takes > 4 s; "Contractor not printed on permit" only for contractor fields with reason `source_missing`; the 21 labels in spec.md as written. |

### Fixed texts and config keys (from `testplans/A-03-test-cases.md` § 3, G6 v1.1)

The build emits these strings verbatim; tests assert them. The same list is test plan § 3 (verbatim in both; a change is made in both or not at all).

| Where | Exact text | Emitted by |
| --- | --- | --- |
| Playwright localhost guard | `RUNTIME_URL must be a hosted URL, not localhost: {value}` | `tests/e2e/playwright.config.ts` (TC-060) |
| Playwright unset guard | `RUNTIME_URL is not set; set it to the hosted URL` | `tests/e2e/playwright.config.ts` (TC-060) |
| `verify-manifest` host allowlist | `Refused gateway {host}: verify-manifest only uses {PINATA_GATEWAY_HOST}, {FILEBASE_GATEWAY_HOST}` | `pipeline/publish/src/verify.ts` (TC-042) |
| Fallback label | the word `fallback` followed by ` · ` and the gateway host from config (`fallback · ipfs.filebase.io`) | `apps/web/src/components/FallbackChip.tsx` (TC-032…034) |
| Both hosts down | `Data could not be reached from the CID copy or the Filebase gateway` | `apps/web/src/data/fetch-by-cid.ts` → error banner (TC-032 step 5) |
| Run index unreadable | `Run index could not be read from this site` (missing, non-JSON or schema mismatch) | `apps/web/src/data/runs-index.ts` → error banner (TC-014) |
| Run index empty | `No runs published yet` (`runs: []`) | `apps/web/src/data/runs-index.ts` → error banner (TC-014) |
| Engine line | `DuckDB-WASM in your browser · read-only` | `apps/web/src/components/EngineLine.tsx` (TC-023) |
| Engine failure | `Query engine could not start` | `apps/web/src/routes/Permits.tsx` → error banner |
| Permit rows unreadable (ERR-11) | `Permit rows could not be read from this run` (a listed row fails the contract/v1 `v_roofing_permit` check; the detail goes to `console.error` only) | `apps/web/src/engine/permit-list.ts` → error banner |
| Empty Permits list | `No permits published in this run` (only when `coverage.permits_emitted.count` = 0 and 0 rows) | `apps/web/src/routes/Permits.tsx` empty state (TC-029) |
| Count mismatch | `Row count does not match the manifest: {rows} listed, {count} published` | `apps/web/src/routes/Permits.tsx` → error banner (TC-029 contrast case) |
| Coverage label | `No TCAD id on source record` | `packages/shared/src/labels.ts` `COVERAGE_LABELS.permits_no_tcad_geoid` (TC-031) |
| Published-count label | `Permits published` | `packages/shared/src/labels.ts` `COVERAGE_LABELS.permits_emitted` (TC-012) |
| Derivation labels (AD-28) | `published_rows` → `Counted from published rows`; `capture_receipt` → `From the capture receipt`; `aggregate_match` → `From the run's internal match (not recomputable from public data)` | `packages/shared/src/labels.ts` `DERIVATION_LABELS` (TC-031) |
| Publication state (P0-4) | `Public by CID · Atlas registration pending` (the phrase `published to Atlas` never appears; grep gate) | `packages/shared/src/labels.ts` `PUBLICATION_STATE_TEXT` (TC-010) |
| Progress bar accessible names | `Loading run` (Runs), `Loading permits` (Permits); `aria-valuetext` = the stage text | `apps/web/src/components/LinearProgress.tsx` (TC-024) |
| Manifest limitation notes | `sources[0].limitations` ∋ `Comptroller baseline not loaded (A-07)`; `sources[1].limitations` ∋ `Confidential owner records redacted (Texas Tax Code §25.025): {n}` | `pipeline/publish/src/manifest.ts` (TC-003) |
| Verify success | `ALL ARTIFACTS VERIFIED` | `scripts/verify-manifest.ts` (TC-040) |

Config keys (same names in the web build env, the Lambda env, CDK outputs and the test harness): `CID_COPY_HOST` (CloudFront domain), `FILEBASE_GATEWAY_HOST` (`ipfs.filebase.io`), `PINATA_GATEWAY_HOST` (`gateway.pinata.cloud`), `READPATH_PRIVATE_PREFIX` (`private/bench/`). The web build reads them as `VITE_CID_COPY_HOST` / `VITE_FILEBASE_GATEWAY_HOST` (not secrets).

Test layout (G6 matrix § 7): one Playwright test per TC, tagged `@scenario:A-03-TC-nnn`, in the spec file the matrix names (`tests/e2e/{build-checks,manifest,runs,permits,fallback,verify-manifest,cid-copy,observability,config-guard,perf,responsive,lambda-fallback.perf,read-path-record}.spec.ts`). Build-time cases (TC-001, 002, 027, 052, 053) live in `tests/e2e/build-checks.spec.ts`: step 0 opens `{RUNTIME_URL}/build.json`, checks out nothing but asserts the local HEAD equals the deployed `sha`, then spawns the Vitest/CDK suite and asserts its result.

Still to come in this story: 🛑 D-6 (G5), 🛑 D-7 (G6), 🛑 **D-8** (first public upload to Filebase), 🛑 D-9 (reviewer < 75, if any), 🛑 **D-10** (first `cdk deploy` + push), ✋ A-3 (SNS email confirmation), ✋ A-4 (Namecheap CNAMEs), 🛑 D-11 (G7).

## Technical Context

**Language/Version**: TypeScript 6.0 (tsc 7 for typecheck), Node.js 22 (Lambda `nodejs22.x`), ES modules. The vendored kit runtime stays `.mjs` as provided (D-03); all new code is TS.

**Primary Dependencies**:
- Web: React 19, Vite, react-router (lazy routes), TanStack Query via `packages/api-client` (the only tRPC client, `AppRouter` type-only, `splitLink`), `@duckdb/duckdb-wasm` 1.33.1-dev57.0 (self-hosted eh bundle, Brotli-precompressed WASM), CSS Modules + Atlas `tokens.css`. No UI library.
- API: tRPC v11 + Zod 4, `@duckdb/node-api` 1.5.6-r.2 (linux-arm64, httpfs extension bundled, autoinstall off), `@aws-lambda-powertools/{logger,tracer,metrics}` with middy, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`.
- Publish: `elephant-cli` pinned `github:elephant-xyz/elephant-cli#44bb182` (`node_modules/.bin/elephant-cli`, asserted at start; never Homebrew), `multiformats`, `@ipld/car`, `@ipld/dag-json`, `ipfs-unixfs-importer`, AWS SDK v3 S3 client (CID-copy uploader).
- Infra: AWS CDK v2 (TypeScript), L1 `CfnApp`/`CfnBranch`/`CfnDomain` for Amplify, `aws-cdk-lib/aws-apigatewayv2`, cdk-nag AwsSolutions.
- Tooling: pnpm 10 workspaces + Turborepo, Vitest 5, Playwright 1.64, ESLint 10 flat config, Stylelint (`declaration-strict-value`), Prettier, gitleaks, dependency-cruiser.

**Storage**: No database in the hosted plane. Public data: IPFS (Filebase Free, Kubo RPC). Read path: S3 bucket (SSE-S3, Block Public Access, RETAIN) with CID-copy keys `ipfs/<cid>` behind CloudFront (OAC, origin path `/ipfs`), plus one private prefix `private/bench/` (not served by CloudFront) for the Lambda proof only. `runs/index.json` committed in git and copied into `apps/web/public/` at build. Local gitignored run workspace `pipeline/data/runs/<runId>/`.

**Testing**: Vitest (unit, contract, CDK assertions, pipeline order/readback, verify host allowlist, label coverage); Playwright against the hosted URL only (config throws on localhost/127.0.0.1); smeargle responsive suite at 390/768/1440; `verify-manifest` CLI; direct-invoke perf harness for the Lambda fallback.

**Target Platform**: Browser (evergreen, mobile-first) on Amplify Hosting; AWS Lambda arm64 in `eu-north-1` (region from `CDK_DEFAULT_REGION`, never hard-coded); operator macOS for the pipeline.

**Project Type**: Web application in a Turborepo monorepo (SPA + serverless API + CDK infra) plus a local publication pipeline.

**Performance Goals**: Browser first DuckDB load ≤ 8 s with progress bar (spike: p95 3.3 s with Brotli); COUNT / listing p95 < 3 s in the browser; radius and roof-age p95 < 3 s on the Lambda fallback in-region (20 direct invocations); API warm p95 < 1 s; cold start incl. DuckDB init < 3 s.

**Constraints**:
- Lambda: arm64, **1,769 MB**, **timeout 15 s** (ADR-0001 sizing; within the 25 s ARD cap of AD-11/AD-27; A-03 has no agent, so the 23 s abort does not apply), DuckDB `threads = 2`, result ≤ 1,000 rows, **no reserved and no provisioned concurrency** (account limit 10, AD-11); HTTP API stage throttle 10 rps / burst 20.
- $0.00 fixed idle cost: no Route 53 zone, Secrets Manager, KMS CMK, WAF, RDS, Function URL, provisioned concurrency; $10 budget alert.
- Source etiquette: the Austin capture stays polite: ≤ 50,000 rows per page, one pass, identified UA, no app token, ≤ 1 request/s incl. retries, backoff only on 429/5xx (1 s base, 60 s cap, 5 attempts, full jitter), **stop on the first 403 or challenge** with a `blocked` receipt.
- Public = `elephant-cli` output + manifest + run index only (A2, P0-1/2). CIDv1 only; published CIDs never change.
- Atlas tokens and components only; no inline style literals.

**Scale/Scope**: 42 September 2026 reroof-term matches → 38 accepted by the profile (2026-10-20) → ~37 emitted (1 without `tcad_id`); matched TCAD parcels for the `county` group; 2 data groups, ~2 CARs + ~30 table parts + 2 tables directories + manifest. Proof table: 2,380,939-row Austin Parquet, 48m variant (40 parts, 196.6 MB). 2 pages, 3 tRPC procedures, 5 stacks.

## Kit Agent Ownership *(mandatory, constitution XIII–XVII)*

Copied from the story front matter (`stories/A-03-walking-skeleton.md`) and [agent-design.md](agent-design.md). Ownership split (walkthrough § 3, ARD § 1 rule: oracle wins on what becomes public and how; metagross wins on hosting, API, infra and UI).

| Role | Agent(s) | Skills loaded | What it decided (cite agent-design.md) |
|------|----------|---------------|----------------------------------------|
| Design consult | `oracle` | use-oracle, county-permit-adapter, apply-engineering-guidelines | Promote the A-02 pilot capture into a Socrata vendor module (§ 1); publish `county` + `property_improvement` only (§ 2); two-phase sequence, credentials in child env only, readback by `sameDigest` + per-part SHA-256 (§ 3); no `--atlas-page` (§ 4); manifest/index as JCS bytes, `permits_no_tcad_geoid` in `coverage` (§ 5); CID-copy uploader with HeadObject + `IfNoneMatch:"*"` + `ChecksumSHA256` (§ 6); `verify-manifest` thin CLI over `verify.ts` (§ 7); Query-DB ban in `pipeline/publish` (§ 8); risk 1 → additive `carCid` on `car` artifacts (D-5). |
| Design consult | `metagross` | build-frontend-backends, integrate-ci-cd, responsive-design-tests, apply-engineering-guidelines | Keep `pipeline/oracle-runtime` outside the pnpm graph (§ 1); one `ci.yml` with `workspace`, `oracle-runtime` (parity with `pipeline-ci.yml`), `gitleaks`, `deploy`, `e2e-hosted` (§ 1, § 7); five stacks + assertions (§ 2); L1 Amplify app, `noEcho` token parameter (§ 3); CID copy with OAC, immutable cache, Range CORS (§ 4); HTTP API (not Function URL), Powertools middy, `duckdb.query` subsegment, `QueryDurationMs` (§ 5–6); browser-safe query-core (`sql.generated.ts`, `partUrl`) (findings); Runs/Permits state machine, `<Provenance/>`, `<MissingReason/>`, `MISSING_REASON_LABELS` (§ 8). |
| Builder (app, hosting, infra, CI, UI, observability) | `metagross` | build-frontend-backends, integrate-ci-cd, responsive-design-tests + apply-engineering-guidelines | Tracks A, C, D (tasks.md). |
| Builder (publication) | `oracle` | use-oracle, county-permit-adapter + apply-engineering-guidelines | Track B: Socrata adapter, publication sequence, manifest, run index, CID-copy uploader, `verify-manifest`. |
| Reviewer(s) | `metagross`, `oracle` | — | metagross: monorepo layout, tRPC/api-client, CDK assertions and banned resources, Powertools, Atlas-only UI, responsive. oracle: P0-1/2/3 (only CLI output public, order, CIDv1), adapter etiquette, manifest/coverage derivations, no Query DB import, CID-copy immutability, verify allowlist. Each scores 0–100 (≥ 75) in `docs/reviews/CR-A-03.md`. |
| Verify | Playwright demo line 1 + `verify-manifest` | responsive-design-tests (smeargle) | Playwright on the hosted URL (`https://countylens.aldarraj.com` or the Amplify branch URL, named in evidence) for every TC in `testplans/A-03-test-cases.md`; smeargle at 390/768/1440; `npx tsx scripts/verify-manifest.ts runs/<runId>/manifest.json` → `ALL ARTIFACTS VERIFIED` on Pinata + Filebase. |

**Patterns the code must show** (from the builders' answers):

| Pattern | Owner | Where |
| --- | --- | --- |
| Turborepo layout `apps/*`, `packages/*`, `infra`, `tests/e2e`; `turbo.json` tasks build/typecheck/lint/test/synth | metagross | `turbo.json`, `pnpm-workspace.yaml` |
| One tRPC client, `AppRouter` type-only, `splitLink` | metagross | `packages/api-client/src/` |
| Zod-validated env config; synth throws without region | metagross | `infra/src/config.ts`, `apps/api/src/config.ts` |
| Powertools Logger/Tracer/Metrics via middy, correlation ID, `duckdb.query` subsegment, `QueryDurationMs`, `ItemsProcessed`, `ItemsFailed` (article VIII) | metagross | `apps/api/src/handlers/trpc.ts`, `apps/api/src/observability.ts` |
| Module-scope DuckDB instance bound once per manifest CID | metagross | `apps/api/src/engine/duckdb-node.ts` |
| CDK assertions for banned resources, retention, alarms, budget, tags, no reserved concurrency | metagross | `infra/test/*.test.ts` |
| Atlas-only CSS Modules, render-only `<Provenance/>`, `<MissingReason/>` | metagross | `apps/web/src/components/` |
| Kit `county-permit-adapter` contract: list → per-permit GET → raw + receipt → `status/<key>.json`; StopOnBlocked | oracle | `pipeline/oracle-runtime/travis/adapters/socrata/` |
| Classification only in the profile; no reroof terms in the adapter (CI grep gate) | oracle | `profiles/travis-austin@1.0.0`, `scripts/grep-gates.sh` |
| Exact `car-publication` sequence, fail-closed, no skip switch, two phases | oracle | `pipeline/publish/src/sequence.ts` |
| Run manifest (JCS, CIDv1, `carCid`), run index, watermarks | oracle | `pipeline/publish/src/manifest.ts`, `runs-index.ts` |
| Immutable CID copy (conditional PUT, checksum, readback) | oracle | `pipeline/publish/src/cid-copy.ts` |
| Verify on Pinata + Filebase only | oracle | `pipeline/publish/src/verify.ts`, `scripts/verify-manifest.ts` |

### Agent-design points superseded after the consult

The consults ran while the spike was still going (agent-design.md header). These points are replaced by later PO decisions:

| agent-design.md said | Now | Source |
| --- | --- | --- |
| oracle § 7 / metagross "Verification": verify on `ipfs.io` + `{cid}.ipfs.dweb.link`; reject Filebase | Verify on `gateway.pinata.cloud` + `ipfs.filebase.io`; reject CloudFront and `w3s.link` | D-4, AM-01 |
| metagross § 2: API assertion "25 s" timeout | 15 s (ADR-0001 sizing, within the 25 s cap) | ADR-0001 Lambda sizing; ARD § 16 AM-06 |
| metagross § 5: Lambda downloads manifest and parts to `/tmp` | Range reads over presigned S3 URLs with the bundled `httpfs` extension (metagross "If the spike shows p95 ≥ 3 s"); `/tmp` cache kept for the manifest only | ADR-0001 Decision 2, research R-03 |
| metagross § 8: Permits list may use the browser for every query | Browser keeps first load, COUNT, listing and free-form SQL; radius + roof-age are Lambda procedures | D-4, AM-04 |
| oracle § 3 table: `--part-size` open | `48m` | D-4 |
| oracle § 6 keys `ipfs/<cid>` vs metagross § 4 paths `/{cid}` | Both: bucket key `ipfs/<cid>`, CloudFront origin path `/ipfs`, public URL `https://<dist>/<cid>`; `private/` is outside the origin path | research R-02 |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design (below the table). Every ❌ needs a row in Complexity Tracking.*

| # | Article | Check for this plan | Status |
|---|---------|---------------------|--------|
| I | Outcome first | Done = hosted Runs + Permits on `countylens.aldarraj.com` or the Amplify branch URL with the real September 2026 Austin slice; Playwright config throws on localhost; evidence names the URL (FR-010). | ✅ |
| II–IV | Stack | All new code TS (vendored `.mjs` as provided, D-03); CDK only, region from `CDK_DEFAULT_REGION` (Zod-checked, source scan for region literals), tag `project_name=oracle-travis` asserted on every resource; Turborepo with `apps/web`, `apps/api`, `packages/{contract,query-core,api-client,shared,tsconfig,eslint-config}`; one api-client. CDK in top-level `infra/` (D-02, Complexity Tracking). | ✅ |
| V–VI | Contracts and LLM | Zod on every tRPC input (`CidV1`, radius/roof-age params with bounds), on env config, on the direct-invoke bench event, on manifest/index reads (`RunManifestV1`, `RunsIndexV1`). No LLM call in A-03; the provider-SDK ESLint ban is added anyway. | ✅ |
| VII–IX | Operations | No queue in A-03 (synchronous read, AD-27); the CDK rule "every `AWS::SQS::Queue` has a DLQ with exactly one alarm" is in place for later stories. The source boundary is bounded (concurrency 1, ≤ 1 req/s, idempotent per-permit keys, backoff with full jitter, StopOnBlocked); Restate wiring deferred by D-5 (Complexity Tracking). Powertools Logger/Tracer/Metrics, X-Ray active + sampling rule `FixedRate 1`, JSON logs; business metrics `ItemsProcessed`, `ItemsFailed`, `QueryDurationMs` (FR-007; TC-050). Log lines, trace annotations and evidence excerpts carry identifiers and counts only (correlation ID, trace ID, manifest CID, procedure, durations, row counts): never row values, presigned URLs or credentials (FR-007; T071 asserts it, T073 implements it). Alerting: SNS email on Lambda Errors/Throttles and HTTP API 5xx, `OKActions` set, `notBreaching` (PagerDuty substitute D-04). | ✅ |
| X | Quality gates | Vitest (unit, contract, CDK assertions, pipeline), Playwright on the hosted URL, ESLint (incl. `@typescript-eslint/no-explicit-any`, article V, T080), Stylelint, Prettier, `tsc`, gitleaks in `ci.yml`; bundle gate ≤ 300 KB gz excl. DuckDB; CI waits for hosted `/build.json` SHA. NFR-09 gates (T022): every merge-blocking job (`workspace`, `oracle-runtime`, `gitleaks`) has `timeout-minutes: 15`; Vitest `coverage.thresholds` ≥ 80 % lines and branches on `packages/query-core` and `packages/contract` fail the `workspace` job below that; the post-deploy `e2e-hosted` job has its own 30-minute budget (Complexity Tracking). Tests first with a named red run per phase (tasks.md). Company shared workflows unreachable → local workflow (D-05, Complexity Tracking). | ✅ |
| XI | Data honesty | Every Permits row shows `<Provenance/>` (source URL, capture time, table CID, run); each `missing` reason shows its label as visible text (21/21, test fails on a gap); counts only from the manifest with their `derivation` label (FR-009, AD-28); "fallback" label; publication state exactly `Public by CID · Atlas registration pending` with a grep gate on "published to Atlas" (FR-002, P0-4, T020); nothing padded. Form of every element: § "Atlas element map". | ✅ |
| XII | Secrets | Filebase keys only in the child-process env (never argv, never `reports/`); Amplify GitHub token as `noEcho` parameter from SSM SecureString, typed by the PO in their own terminal and revoked on GitHub after the first successful Amplify build (TZ02 [PO] step); CID-copy writer via assumed role (no access keys); operator email from CI variable; gitleaks in CI as a required status check that blocks merge (NFR-04), every `.gitleaksignore` line with a `# reason:` comment naming the file, the false-positive kind and the PO decision (T022); `elephant-cli.log` and `reports/*.json` secret-scanned before any excerpt leaves the run directory (T046/T047). | ✅ |
| XIII–XV | Owner agents | Kit Agent Ownership filled; [agent-design.md](agent-design.md) has both answers word for word; builder patterns listed with paths; every implementation task in tasks.md is tagged `[metagross]` or `[oracle]` and run by that subagent. | ✅ |
| XVI | Owner review | `metagross` and `oracle` score the branch read-only in `docs/reviews/CR-A-03.md`, threshold 75 (TZ01); early reviews after waves 1 and 2. | ✅ |
| XVIII–XXIII | Delivery | G4 passed (D-1); G5 (this plan + tasks, D-6) and G6 (`testplans/A-03-test-cases.md`, D-7) before `/speckit-implement`; tests first in every phase and must fail first; branch `003-walking-skeleton` merged `--no-ff` into `feature/oracle-pipeline`; commits `A-03: …`; failing hosted tests → `docs/defects/ERR-{n}.md`. | ✅ |
| Addendum | Task A (A1–A8) | **A1** adapter module in the vendored runtime's Travis folder through the kit `county-permit-adapter` contract, profile-only classification (D-5: run script now, Restate in A-05/A-06). **A2** only `elephant-cli` output (+ manifest, index) public; fixed order with an order test; no Query DB import in `pipeline/publish` (ESLint + grep test). **A3** CIDv1 only, refinements reject others; CID copy and IPFS never overwritten. **A4** manifest with cid/name/size/codec/sha256, `carCid` on directories and `car` artifacts, verified on Pinata + Filebase (AM-01). **A5** no contractor identity written: all permits `contractor_unresolved`; the note `Comptroller baseline not loaded (A-07)` goes in manifest `sources[0].limitations` and the evidence (FR-001, TC-003). **A6** polite capture, stop on the first 403 or challenge with a `blocked` receipt and exit 2, no CAPTCHA/UA rotation (FR-014, TC-006). **A7** nothing that bills while idle (assertions + D-10 diff review against § "Idle-cost justification per resource"). **A8** kit-bundled skills only. | ✅ |

**Post-design re-check (after Phase 1):** unchanged, all ✅. The design adds no new violation: the private `private/bench/` prefix is not public (outside the CloudFront origin path, deleted after the proof); the bench event is reachable only through `lambda:InvokeFunction` IAM, not the HTTP API; the Brotli WASM is a web build asset served by Amplify, not data.

## Read-path scope (from ADR-0001 and the G6 test plan)

| Query | Where it runs | Proved by |
| --- | --- | --- |
| First load (DuckDB-WASM init + `DESCRIBE`) | Browser | TC-NF-01 on the hosted Permits page (published slice); spike p95 3.3 s (Brotli) |
| Listing + COUNT on the published slice | Browser | TC-NF-02 (20 runs) |
| COUNT on the full-size Austin table | **Not in the browser at part size 48m**: ADR-0001 measured browser COUNT p95 11,668 ms on the 48m variant (40 parts), above NFR-001. Recorded on the Lambda fallback instead (bench `count`, T066). | T066 evidence; PO note in tasks report |
| Radius, roof-age | Lambda DuckDB fallback | TC-NF-05: one untimed warm-up invocation per query, then 20 timed direct invocations (all warm; `queryDurationMs`, engine init excluded), preset `TC_NF_05` (30.2672, −97.7431, 1 mi, ≥ 15 y); also preset `ADR_0001` (Pflugerville 5 mi) for comparison with the spike (contracts/cli.md) |

## Atlas element map (Runs page and Permits list)

Referenced by spec FR-002, FR-003, FR-008, FR-009, NFR-003, tasks T007, T042, T055, T056, T060 and TC-NF-03. The spec and § "Fixed texts" fix the **content** of every element; this section fixes its **form**: the Atlas § 7 component, the § 2.4 status where there is one, and the § 9 state. Reuse first (Atlas § 13): exact matches are used unchanged; close matches are extended with tokens only and listed under "Extensions" below.

### Shell (both pages)

| Element | Atlas component | Rule for A-03 |
| --- | --- | --- |
| Top app bar | § 7 Top app bar: 64 px, `surface`, title-large "CountyLens" | Left: nothing (no drawer). Right: nothing in A-03 (no search, theme toggle or avatar); the § 15 app switcher belongs to the hub story. Elevation 2 on scroll. |
| Navigation, compact (< 600 px) | § 7 Bottom navigation: 80 px, `surface-container`, pill indicator | Two destinations, Runs and Permits. No locked "Coming soon" items in A-03 (A-13 adds them). |
| Navigation, ≥ 600 px | § 7 Navigation rail: 80 px | Same two destinations; no drawer. |
| Theme | Atlas § 2.1 light roles only | `<html data-theme="light">` and `color-scheme: light`; the `prefers-color-scheme: dark` block of `tokens.css` ships unchanged but is never active in A-03 (dark theme is A-13). TC-NF-03 runs with `colorScheme: 'light'`. |
| Fonts | Atlas § 3; design-system README "Fonts" | Roboto, Roboto Mono and Material Symbols from Google Fonts, linked from `index.html` as `tokens.css` expects; Google Sans is not bundled; the layout must look right with Roboto alone (smeargle takes one extra screenshot set with Google Fonts blocked, kept in evidence, not a pass criterion). Font hosts (`fonts.googleapis.com`, `fonts.gstatic.com`) and the app's own static assets are outside TC-023's "data requests only" assertion. |
| Progress (page load) | § 7 Progress: linear 4 px under the app bar, indeterminate | `role="progressbar"`, `aria-label` = `Loading run` / `Loading permits`, `aria-valuetext` = the stage text. |
| Error banner | § 9 Error: `error-container`, `error` icon, what failed, "Retry" | Texts from § "Fixed texts" (both hosts down, run index unreadable / empty, count mismatch, engine failure). The app bar and navigation keep working. |
| CID display | § 3: `--md-ref-typeface-mono`, middle-truncated (`bafy…q4xa`: first 4 characters, `…`, last 4), copy icon button with a 48 × 48 target | The visible text is truncated; the full CID is the element's `data-cid` and `title` attributes and is what the copy button copies. Tests read `data-cid` or the clipboard, never the visible text (TC-010). |
| Token check (TC-NF-03, Atlas § 13 rule 4) | stylelint + smeargle | Build time: stylelint `declaration-strict-value` on `/color/`, `font-family`, `font-size`, `/^(margin\|padding\|gap\|inset)/` and `border-radius` in every CSS Module (T007). Run time: smeargle reads `getComputedStyle` for the same properties on every rendered element, builds the allowed value set once per width from the `:root` custom properties of `tokens.css` (light theme) plus `0`, `auto`, `inherit`, `transparent`, `currentColor`, and lists every value outside the set with selector and property; zero violations pass. |

### Runs page (`/runs`)

| Element | Atlas component | Rule for A-03 |
| --- | --- | --- |
| Run card | § 7 Card: `corner-medium`, `surface-container-lowest` on `surface-container-low`, padding 16 | One card per run (A-03: one run). Title-medium = run ID (mono). Body-medium with `tabular-nums`: `Started {startedAt} UTC` · `Finished {finishedAt} UTC`. |
| Card provenance line | § 8 Provenance line: body-small, `on-surface-variant`, leading `description` icon | `Index: this site (/runs/index.json) · Manifest: {CID, truncated + copy}`; directly under the title; visible without scrolling at 390 (§ 9 Populated). |
| Publication state | § 7 Badge / status pill, § 2.4 Info / pending (`schedule` icon + text) | Exactly `Public by CID · Atlas registration pending` (P0-4). |
| Sources | § 7 List item, two lines | Line 1 title-small: `SOURCE_LABELS[name]` (the TCAD item also shows `tcad-2026-certified-json`); line 2 body-small `on-surface-variant`: `{records} records · collected {captured_at} UTC · {url as link}`; manifest order (Austin first). |
| Coverage rows | Card rows: label title-small · count body-medium `tabular-nums` · derivation body-small `on-surface-variant` | `Permits published` = `coverage.permits_emitted.count`; `No TCAD id on source record` = `coverage.permits_no_tcad_geoid.count`; each with `DERIVATION_LABELS[derivation]` as **visible** helper text (not a tooltip; TC-031). A true count of 0 is shown as `0` with its label (Atlas § 8 "never 0 without a reason" is met by the derivation label). Not a status pill: these are counts, not availability states. |
| Data groups | § 7 List item, two lines | `county`, `property_improvement`; line 2 = the tables directory CID (truncated + copy) from the `directory` artifact (TC-013). |
| Server check | Body-small, `on-surface-variant`, below the coverage rows, leading `cloud_done` icon | `Server check: {roofingPermitRows} rows · {queryDurationMs} ms · from the API (runs.summary)`; secondary text with its own provenance, never title or headline style; the counts above come only from the manifest (FR-009). Pending: `Server check: pending`; API error: `Server check: unavailable` (not a page error). |
| Fallback chip | § 7 Badge / status pill, § 2.4 Warning / partial (`warning` icon + text) | `fallback · {FILEBASE_GATEWAY_HOST}` in the card header; absent when the copy served the page. |

### Permits list (`/permits`)

| Element | Atlas component | Rule for A-03 |
| --- | --- | --- |
| Engine line | Body-small, `on-surface-variant`, leading `memory` icon | Exactly `DuckDB-WASM in your browser · read-only`; above the list; the fallback chip sits beside it. |
| List, ≥ 600 px | § 7 Data table: header 56 px `surface-container-high` title-small; rows 52 px with outline-variant dividers; `tabular-nums` | Columns: permit number (mono), `improvement_status`, status class, issue date, contractor, provenance. Ordered by `permit_number`, paged at 200 rows per page (`PERMITS_PAGE_SIZE`; PO 2026-10-25, A-11): below the table a `nav` "Permits pages" holds the range line `data-testid="permits-range"` ("Showing 1–200 of 15,025", with `data-first`, `data-last`, `data-total`) and Previous page / Next page buttons; only the current page's rows are in the DOM, all rows stay in memory and the total is still checked against `permits_emitted`. **No** sorting, column visibility, sticky header or sticky first column in A-03 (A-13 adds them with the Explorer and reuses the pager). |
| List, < 600 px | § 7 Card per permit: title-small permit number; body-medium `label · value` rows; provenance line last | Same content as a table row; the switch is `@media (min-width: 600px)` (Atlas compact bound). |
| Row provenance | § 8 Provenance line: body-small, `on-surface-variant`, `description` icon | `Source: {source_url as link} · collected {captured_at} UTC · table {table_cid truncated + copy} · run {run_id}`; last cell of the row / last line of the card; the first row's line is inside the first viewport at 390. |
| Status class cell | Body-medium text `open` / `stalled` / `closed` | Not a pill (no § 2.4 status maps to a lifecycle class); `needs_review` renders the Missing-reason element. |
| Contractor cell | § 7 Badge / status pill: `resolved` → § 2.4 Verified (`check_circle`, text `resolved`); `unresolved` → § 2.4 Not available (`do_not_disturb_on`, text `unresolved`) | The reason label (`Contractor not matched to a company`, or `Contractor not printed on permit` for `source_missing`) follows the pill as visible body-small text in the same cell (TC-025). |
| Missing-reason element | § 8 Not-available pill (§ 2.4 colours, `do_not_disturb_on` icon), **extended**: the reason label is visible text after the icon, not only a tooltip | Every absent displayed value and every entry of the row's `missing` list renders this way (TC-022 reads visible cells); never a blank, `—`, `N/A` or a raw code. |
| Skeleton (loading) | § 9 Loading: linear progress under the app bar plus 5 skeleton rows (table) or cards | Skeletons live in a `role="status" aria-busy="true"` container, carry no data cells and are not a `<table>`; the data table / cards mount only in `ready` (FR-008, TC-024). |
| Empty state | § 9 Empty, **reduced**: headline-small `No permits published in this run`, one body-medium sentence with the run ID and manifest CID; no illustration, no action | Only when `coverage.permits_emitted.count` = 0 and 0 rows (TC-029); any other zero is the count-mismatch error. |
| Count-mismatch / engine failure | § 9 Error banner | Fixed texts; "Retry" re-runs the load. |

### States (Atlas § 9) per page

| State | Runs | Permits | Test |
| --- | --- | --- | --- |
| Loading | linear progress (`Loading run`) + card skeleton | linear progress (`Loading permits`) + 5 skeleton rows/cards; never a zero-row table | TC-024, TC-NF-01 |
| Populated | card with its provenance line visible without scrolling | table (≥ 600) / cards (< 600); the first provenance line inside the first viewport at 390 | TC-010, TC-021, TC-NF-03 |
| Fallback | Warning pill `fallback · host` | same | TC-032…034 |
| Error | both-hosts-down banner; run-index-unreadable banner | both-hosts-down banner; count-mismatch banner; engine-failure banner | TC-032 step 5, TC-014, TC-029 |
| Empty | `No runs published yet` banner for an index with zero runs | `No permits published in this run` | TC-014, TC-029 |
| Partial | **excluded in A-03**: both manifest sources are always present; first used in A-08 (BBB) | excluded (same) | — |
| Rate-limited | **excluded in A-03**: a 429 from the Filebase gateway on the fallback path is a non-200 → Error state (both hosts down); the § 9 countdown banner arrives with the Verify UI (A-04) | same | TC-032 step 5 |
| Offline | **excluded in A-03**: nothing is cached; offline → both-hosts-down Error | same | — |

### Extensions (Atlas § 13 rules 2–3; copied to the Atlas Extensions log at delivery)

| Date | Component | Change | Why | Screens |
| --- | --- | --- | --- | --- |
| 2026-10-21 | Badge / status pill → `FallbackChip` | Warning / partial pill with the fixed text `fallback · {host}` | AC-5 label; no Atlas element names the read path | Runs, Permits |
| 2026-10-21 | Provenance line → `EngineLine` | body-small line with a `memory` icon and the fixed engine text | AC-3 engine line | Permits |
| 2026-10-21 | Not-available pill → `MissingReason` | reason label as visible text, not only a tooltip | "missing data says why" must be readable and testable without hover (TC-022) | Permits |
| 2026-10-21 | § 9 Empty (reduced) → `EmptyState` | no illustration, no action | nothing to widen in A-03; A-13 restores the full pattern | Permits |

## Architecture (this story)

```text
Austin Socrata 3syk-w9eu ──(adapter, ≤1 req/s, stop on 403)──► pipeline/data/artifacts/permits/travis/<jobId>/
TCAD 2026 certified zip (local, sha256-checked) ─► capture-tcad-subset ─┐
                                                                       ▼
              run-month.ts → groups/{county,property_improvement} (seed inside both, confidentiality applied)
                                                                       ▼
pipeline/publish sequence (phase 1, both groups): validate → hash+CAR → validate CAR → export-tables --part-size 48m
                       🛑 D-8 ─► phase 2: upload CAR, upload tables (Filebase Kubo RPC) → readback (root + every part SHA-256)
                                  → Kubo add each .car as raw-leaves file (carCid) → manifest (JCS) → Kubo add manifest
                                  → runs/index.json (committed) → CID-copy uploader (S3 ipfs/<cid>, conditional PUT)
                                                                       ▼
 Browser (Amplify SPA)  ── /runs/index.json (same origin) ── manifest by CID (CloudFront → Filebase fallback >4 s/non-200/error)
        │                                                    DuckDB-WASM range reads over table parts (Permits list)
        └── /api/trpc/* (Amplify rewrite) ─► HTTP API (access log 30 d) ─► Lambda trpc.ts (Powertools, X-Ray)
                                                                           runs.summary · query.radius · query.roofAge
                                                                           @duckdb/node-api over presigned S3 ipfs/<cid>
 Operator ── aws lambda invoke (bench event) ─► same Lambda over private/bench/<file> (20 runs) → delete → evidence
 verify-manifest ── plain GET ─► gateway.pinata.cloud + ipfs.filebase.io (size + SHA-256)
```

Deploy order (AM-02): `CountyLensData` → `CountyLensApi` → `CountyLensWeb` → `CountyLensOps` → `CountyLensCert`.

## Project Structure

### Documentation (this feature)

```text
specs/003-walking-skeleton/
├── plan.md              # This file
├── agent-design.md      # Design consults (oracle, metagross) + Disagreements
├── run-log.md           # PO decisions and step log
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── api.md           # tRPC procedures + bench direct-invoke event
│   ├── cli.md           # run-month, publish, cid-copy, verify-manifest, bench-lambda
│   └── storage.md       # CID-copy bucket layout, headers, CORS, private prefix
├── checklists/
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
apps/
├── web/                              # metagross · React 19 + Vite SPA on Amplify
│   ├── public/                       # runs/index.json copied at build; build.json written by amplify.yml
│   ├── src/
│   │   ├── routes/{Runs,Permits}.tsx
│   │   ├── components/{Provenance,MissingReason,EngineLine,FallbackChip,LinearProgress,AppShell}.tsx (+ .module.css)
│   │   ├── engine/duckdb-wasm.ts     # lazy import, range-read flags, Brotli WASM
│   │   ├── data/{fetch-by-cid,runs-index,manifest}.ts
│   │   └── styles/tokens.css         # Atlas tokens (copied)
│   ├── scripts/compress-wasm.ts      # Brotli level 11 → *.wasm (Content-Encoding: br)
│   └── test/                         # Vitest (jsdom) unit tests
├── api/                              # metagross · tRPC on Lambda
│   ├── src/
│   │   ├── handlers/trpc.ts          # API Gateway handler + direct-invoke bench branch
│   │   ├── routers/{runs,query,index}.ts
│   │   ├── engine/duckdb-node.ts
│   │   ├── observability.ts
│   │   ├── s3-read.ts                # manifest GET + rawCid check, presigned part URLs
│   │   └── config.ts
│   └── test/
packages/
├── contract/                         # frozen contract/v1 (unchanged)
├── query-core/                       # + sql.generated.ts, partUrl, listRoofingPermitsSql, runSummarySql, radiusSql, roofAgeSql, bench SQL
├── api-client/                       # only tRPC client
├── shared/                           # MISSING_REASON_LABELS, missingLabel, SOURCE_LABELS, copyUrl, gatewayUrl
├── tsconfig/                         # base/node/react
└── eslint-config/
pipeline/
├── oracle-runtime/                   # own npm project (outside pnpm graph)
│   └── travis/
│       ├── adapters/socrata/{socrata.ts,austin-3syk-w9eu.ts}
│       └── runs/run-month.ts
└── publish/
    └── src/{sequence,upload,readback,kubo-add,manifest,runs-index,cid-copy,verify}.ts
infra/                                # metagross · CDK app (D-02)
├── bin/countylens.ts
├── src/{config,data-stack,api-stack,web-stack,ops-stack,cert-stack}.ts
└── test/{app,data,api,web,ops}.test.ts
runs/                                 # committed: index.json, <runId>/manifest.json (JCS bytes)
scripts/{verify-manifest.ts,bench-lambda.ts,bundle-size.ts,grep-gates.sh}
tests/e2e/                            # Playwright (hosted only) + smeargle responsive; file names per G6 matrix
├── playwright.config.ts              # throws "RUNTIME_URL must be a hosted URL, not localhost: {value}"
├── lib/{runtime,manifest,aws}.ts     # RUNTIME_URL, manifest CID from /runs, build.json sha, AWS helpers
├── build-checks.spec.ts · manifest.spec.ts · runs.spec.ts · permits.spec.ts · fallback.spec.ts
├── verify-manifest.spec.ts · cid-copy.spec.ts · observability.spec.ts · config-guard.spec.ts
└── perf.spec.ts · responsive.spec.ts · lambda-fallback.perf.spec.ts · read-path-record.spec.ts
.github/workflows/ci.yml              # replaces pipeline-ci.yml after parity
amplify.yml · turbo.json · .stylelintrc.json
```

**Structure Decision**: Turborepo per AD-23 with CDK in top-level `infra/` (D-02). `pipeline/oracle-runtime` stays an npm project outside the pnpm/turbo graph (A-02 R-11; metagross § 1). `pipeline/publish`, `packages/*`, `profiles/*`, `apps/*`, `infra`, `tests/e2e` are pnpm workspace members.

## Risks (from the consults and the spike)

| # | Risk | Mitigation / fallback | Owner |
| --- | --- | --- | --- |
| R1 | Lambda in-region p95 for radius/roof-age ≥ 3 s | Two-step query (lat/lon first, then matching rows' columns, ADR-0001); then ephemeral storage `/tmp` download of the parts. Result recorded in evidence either way. | metagross |
| R2 | Amplify may not honour `Content-Encoding: br` on a pre-compressed `.wasm` (custom headers) or has a file-size limit for the 35.9 MB raw WASM | Checked on the first branch preview (T-task); fallback recorded and raised to the PO if it needs a new resource. **2026-10-21: fallback taken.** The first CountyLensWeb deploy failed (CREATE_FAILED, rolled back): Amplify rejects read-only headers (content-length, transfer-encoding, content-encoding, warning, via) in `customHeaders`. The build now writes `duckdb-eh-<hash>.wasm.gz` (gzip -9) and deletes the raw `.wasm`; the engine fetches the .gz, gunzips it with `DecompressionStream` into an `application/wasm` Blob and instantiates from its object URL. Self-hosted, no CDN, no new resource, no special header; TC-028 now asserts the .gz transfer < 12 MB and no raw `.wasm` request. | metagross |
| R3 | Amplify `/api/<*>` rewrite drops query string or response headers | Check on first preview; fallback HTTP API CORS for exact origins. | metagross |
| R4 | `AWS::Amplify::Domain` waits on Namecheap DNS | Isolated in `CountyLensCert` (deployed last); branch URL is the hosted runtime meanwhile (FR-010). | metagross + PO |
| R5 | Gateway warm-up slow after the first upload; Pinata TTFB ~5 s; the Pinata public gateway's rate and size limits are unpublished (assumption, spec Assumptions) | `verify-manifest` timeout 120 s, backoff on 429/5xx honouring `Retry-After` (5 attempts), concurrency ≤ 2 per gateway. Demo day: run `verify-manifest` ≥ 1 h before the demo and keep the full output in the evidence (ARD § 8 "warm CIDs before demo"); if Pinata throttles live, show the recorded run while the Filebase lane completes live. A second gateway is never substituted for Pinata (AM-01). | oracle |
| R6 | Cross-platform DuckDB binary/httpfs extension in the Lambda asset | `afterBundling` installs `--os=linux --cpu=arm64 --libc=glibc`; a synth test asserts the binary and extension files are in the asset. | metagross |
| R7 | `query-core` test flake under load (198/198, one 71 s timeout seen) | Watch; raise per-test timeout only if it recurs. | metagross |

## Idle-cost justification per resource (A7, NFR-002)

"$0.00 fixed cost while idle" means no resource bills by existing. Usage-priced resources are listed with the allowance they sit in at zero traffic. The account is on the AWS Free plan (credits until 2027-04-16, CLAUDE.md); the allowances below are the published free-tier offers, and where an offer does not apply under the Free plan the charge comes out of the credits and A-16's bill shows the true figure. The 🛑 D-10 diff review (T076) checks `cdk diff` against this table.

| Resource (stack) | Bills by | Idle charge | Allowance relied on |
| --- | --- | --- | --- |
| S3 CID-copy bucket (Data) | GB stored, requests | ≈ 0.2 GB stored (2 CARs, ~30 parts, manifest); the 196.6 MB bench copy is deleted after TC-NF-05 | S3 Standard 5 GB free for the account's first 12 months; beyond it ≈ $0.005/month at 0.2 GB. The only usage-priced storage, stated here rather than hidden. |
| CloudFront distribution (Data) | requests, egress | $0 at zero requests; no WAF, PriceClass_100 | Always free: 1 TB egress and 10 M requests per month |
| Lambda `countylens-api` (Api) | invocations, GB-s | $0 at zero invocations; no provisioned or reserved concurrency | Always free: 1 M requests and 400,000 GB-s per month |
| HTTP API + stage (Api) | requests | $0 at zero requests | 1 M calls per month free for 12 months |
| CloudWatch log groups ×2 (Api) | GB ingested, GB stored | $0 ingested at zero requests; stored bytes age out at 14 / 30 days | 5 GB ingestion and 5 GB storage free per month |
| X-Ray active tracing + sampling rule `FixedRate 1` (Api) | traces recorded and retrieved | $0 at zero requests; the rule itself is free | 100,000 traces recorded free per month |
| CloudWatch alarms ×3 (Ops) | per alarm-month | $0: standard-resolution alarms | 10 alarms free per month (always free); 3 used |
| SNS topic + email subscription (Ops) | notifications | $0 | 1,000 email notifications free per month |
| AWS Budget ×1 (Ops) | per day for action-enabled budgets | $0: notifications only, no budget actions | Budgets without actions are free; the first two action-enabled budgets are free |
| SSM parameters (Data, Web) | advanced-tier parameters | $0: standard tier (`String`, `SecureString` ≤ 4 KB) | Standard parameters are free |
| GitHub OIDC provider + IAM roles (Ops) | — | $0 | IAM is free |
| Amplify app, branches, domain (Web, Cert) | build minutes, GB served, GB stored | $0 with no builds and no traffic; the managed certificate is free | 1,000 build-minutes, 15 GB served and 5 GB stored free per month for 12 months; then $0.01/min and $0.15/GB served, both usage-priced |
| CDK bootstrap bucket (pre-existing) | GB stored | ≈ $0 (two inert 14.8 KB asset files, run-log 05:18) | S3 free tier |

## Complexity Tracking

| Violation / deviation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| **D-02**: CDK in top-level `infra/` instead of the skill template's `apps/api/cdk/` (ARD § 13, AD-23) | Five stacks: the Amplify app, CID-copy bucket + CloudFront, Ops (alarms, budget, OIDC) and the domain association are not API concerns. | `apps/api/cdk/` would make the API package own hosting and the data bucket and couple their deploys. Accepted deviation. |
| **D-05**: local `.github/workflows/ci.yml` instead of the company shared CI workflows (ARD § 13) | The shared workflows and Lexicon metric registration are not reachable from the fork. | No reachable alternative; the local workflow runs the same stages (install, typecheck, lint, test, synth, gitleaks, deploy, hosted e2e). Listed in `docs/kit-usage.md`. |
| A-03 drives the Socrata adapter from `run-month.ts`, not through Restate durable workflows (article VII "kit runtime's Restate workflows satisfy this locally"; AD-17) | The vendored kit has no Restate PermitHarvest; PO decision D-5 "Adapter module now". The adapter still has bounded concurrency, idempotent keys, backoff and StopOnBlocked. | Vendoring the Restate services now adds a day of work for a ~45-request capture; wiring comes in A-05/A-06. |
| Kit skill-order: no Comptroller identity baseline before permits, no Query DB reconciliation (oracle risk 3) | Comptroller baseline is A-07; no contractor edge is written, so every permit is `contractor_unresolved` with the note "Comptroller baseline not loaded (A-07)". | Loading the baseline now pulls A-07 forward without changing what A-03 shows. |
| D-03: vendored runtime `.mjs` (article II) | Runs as provided; all new adapter/run code is TS. The `oracle-runtime` CI job keeps the Python 3.12 + PyYAML validator step of `pipeline-ci.yml` (A-01, T022): it is the vendored runtime's own kit-provided check and falls under the same article II exception; no Python is written in this repo outside the vendored runtime (the PySpark/Glue rule is untouched). | Rewriting the kit breaks A1. Accepted deviation. |
| AD-22 second independent pin and GitHub Release CARs not in A-03 | Filebase Free is the only pin in A-03 (D-4; agent-design oracle risk 5; ADR-0001). The Filebase plan is chosen at A-11 after the size measurement, so the second pin and the Release CARs go with it. Deferred to **A-11**, recorded in spec Assumptions "Out of scope". | Pinning twice now would be redone at A-11 when the plan and the CAR set change. |
| NFR-09 "CI ≤ 15 min" applies to the merge-blocking jobs; `e2e-hosted` has a 30-minute budget | `e2e-hosted` waits for the Amplify build (`/build.json` poll ≤ 12 min) before Playwright (≤ 15 min); `workspace`, `oracle-runtime` and `gitleaks` each have `timeout-minutes: 15` (T022). | Running Playwright without the wait would test a stale build (localhost is never evidence); the wait is outside the NFR's intent, which is the quality checks on the commit. |
| Lambda timeout 15 s while AD-11 / AD-27 say 25 s | ADR-0001 sizing (Accepted, D-4) sets 15 s for the query Lambda; A-03 has no agent, so AD-27's 23 s abort layering does not apply. 15 s stays inside the 25 s cap and fails fast before the HTTP API's 29–30 s limit. | 25 s would only matter for `agent.ask` (A-14), which will set its own 25 s function. Recorded as ARD § 16 **AM-06** (2026-10-21, PO D-4): AD-11 is amended, not broken. |
| D-04: SNS email instead of PagerDuty (article IX) | No company PagerDuty access. | Documented substitute allowed by article IX. Accepted deviation. |
| **AM-08** (2026-10-21): CI does not deploy infrastructure; NFR-09 deploy-by-CI deviates (ARD § 16 AM-08) | The AWS Organizations SCP `p-qeth25te` denies `iam:CreateOpenIDConnectProvider` in account 515618610572, so the GitHub OIDC provider and deploy role cannot exist (the `CountyLensOps` deploy failed). Infra deploys run from the PO's laptop with profile assess after a PO approval per deploy; Amplify still builds every push from the Git connection and `e2e-hosted` waits for its `/build.json` SHA. PO decision, 2026-10-21 (R6 follow-up): "Laptop deploys only (Recommended)". | Long-lived IAM user keys in GitHub secrets would break constitution XII (no stored credentials) and the SCP may deny them too; no reachable alternative lets CI assume a role in this account. |
