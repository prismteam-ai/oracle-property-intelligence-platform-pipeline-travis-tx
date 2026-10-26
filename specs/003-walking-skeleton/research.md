---
id: RESEARCH-A-03
type: research
parent: PLAN-A-03
---

# Research: A-03 walking skeleton (Phase 0)

No `NEEDS CLARIFICATION` remained in Technical Context: the read path was settled by the spike ([ADR-0001](../../docs/decisions/0001-read-path.md), Accepted D-4) and the open design points by PO decisions D-2 and D-5. Each item below records the decision, why, and what else was considered.

## R-01 Read path for files

- **Decision:** CloudFront CID copy first; Filebase gateway (`https://ipfs.filebase.io/ipfs/<cid>`) as the labelled fallback when the copy errors, returns non-200 or takes over 4 s (D-2).
- **Rationale:** CloudFront served 206 range reads with correct CORS; Filebase is the only measured public gateway with Range + CORS at ~0.2 s TTFB (ADR-0001 Decision 1).
- **Alternatives:** Filebase as primary (slower, plan limits); Pinata (≈5 s TTFB, incomplete preflight); ipfs.io / dweb.link (retired 2026-09-21).

## R-02 CID-copy key layout and the private prefix

- **Decision:** objects are stored under `ipfs/<cid>`; CloudFront's S3 origin uses origin path `/ipfs`, so the public URL is `https://<dist>/<cid>`. The Lambda proof copy lives under `private/bench/` in the same bucket, which CloudFront cannot reach (outside the origin path). The Lambda role gets `s3:GetObject` on `ipfs/*` and `private/bench/*`; the writer role gets Put/Get/Head on `ipfs/*` only; an operator-only statement allows Put/Delete on `private/bench/*` through the `assess` profile.
- **Rationale:** reconciles oracle § 6 (`ipfs/<cid>`) with metagross § 4 (`/{cid}`) and satisfies D-4 "private prefix the CDN does not serve" without a second bucket.
- **Alternatives:** separate private bucket (one more resource, same effect); signed URLs (needs a key group, more moving parts).

## R-03 Lambda DuckDB read mechanism

- **Decision:** `@duckdb/node-api` with the `httpfs` extension bundled in the asset (`extension_directory` set, autoinstall/autoload of remote extensions off), reading presigned S3 GET URLs (in-region) with DuckDB range reads; `threads = 2`; module-scope instance; manifest bytes cached in `/tmp` by CID; result ≤ 1,000 rows. If p95 ≥ 3 s: (1) two-step query (lat/lon filter first, then the other columns of matching rows), (2) download parts to `/tmp` (ephemeral storage up to 1 GB).
- **Rationale:** ADR-0001 projects ≥ 31 MB/s parallel range reads are needed; in-region S3 range GETs avoid CloudFront egress and the edge hop. Presigned URLs avoid needing the `aws` extension and credential-chain wiring.
- **Alternatives:** `/tmp` download first (195 MB per cold proof run is ~2 s alone); CloudFront URLs from Lambda (extra hop, public path).

## R-04 Bench (proof) invocation shape

- **Decision:** the same `trpc.ts` Lambda accepts a second event shape, `{ kind: "bench", query: "radius" | "roofAge" | "count", prefix: "private/bench/<name>/" }`, validated by Zod (prefix must match `^private/bench/[a-z0-9-]+/$`). It is reachable only by `lambda:InvokeFunction` (operator IAM), never through API Gateway (the HTTP API event shape is distinct and the router rejects `kind`). `scripts/bench-lambda.ts` invokes it 20 times per query with `aws-sdk` `InvokeCommand`, records `QueryDurationMs` from the response and from the metric, and writes p50/p95 to `docs/evidence/A-03.md`. Queries: parametrised bbox + haversine radius and the roof-age stand-in `date_diff('year', TRY_CAST(substr(issue_date,1,10) AS DATE), DATE '2026-10-21') >= 15` inside the radius, in `packages/query-core/src/bench-sql.ts`, labelled "performance stand-in, not a roof classification" (P0-9). Two presets: `TC_NF_05` (30.2672, −97.7431, 1 mi; the G6 acceptance case) and `ADR_0001` (Pflugerville 30.447765, −97.602116, 5 mi, `LIMIT 500`; spike comparability). Warm-up rule: one untimed invocation per query and preset precedes the 20 timed ones, so every timed run is warm; timings come from each response's `queryDurationMs` (also in the log line), with engine init `initMs` reported separately and excluded (contracts/cli.md; the cold start is TC-NF-04's measurement). The bench also runs `count` so the full-size COUNT is recorded (browser COUNT at 48m was p95 11.7 s in the spike).
- **Rationale:** D-4 "20 timed direct invocations (never through the public API)"; one function means the proof measures the deployed code and config.
- **Alternatives:** a separate bench Lambda (proves a different function); a public procedure with a key parameter (would expose a non-CID path).
- **Data:** `pipeline/data/raw/austin-parquet/v48m/` (40 parts, 196.6 MB, the 48m variant measured in the spike; local, gitignored). Uploaded to `private/bench/austin-48m/` after D-10, deleted after the 20 runs; `aws s3 ls` before/after goes in evidence.

## R-05 DuckDB-WASM configuration and WASM delivery

- **Decision:** `db.open({ filesystem: { allowFullHTTPReads: true, forceFullHTTPReads: false, reliableHeadRequests: false } })`; self-hosted eh bundle; `duckdb-eh.wasm` Brotli-compressed at build (`apps/web/scripts/compress-wasm.ts`, level 11) and served by Amplify with custom headers `Content-Type: application/wasm`, `Content-Encoding: br` for `/assets/*.wasm`; loaded by dynamic `import()` so it is outside the 300 KB JS budget. Verified on the first branch preview (risk R2).
- **Rationale:** ADR-0001 Findings 1–2: defaults download whole files; uncompressed WASM first load p95 8.6 s > 8 s.
- **Alternatives:** CloudFront CID copy for the WASM (rejected: copy holds CLI output only, FR-012).

## R-06 Publication sequence and readback

- **Decision:** extend `pipeline/publish/src/sequence.ts`: phase 1 runs validate → hash (`--output-car`) → validate CAR → export-tables `--part-size 48m` for **both** groups; phase 2 (after 🛑 D-8) uploads CAR then tables per group to `https://rpc.filebase.io` (gateway `https://ipfs.filebase.io`, `--timeout 300`, `--output-json`). Readback: root equals hash/export root by `sameDigest`, part count matches, every part GET from `ipfs.filebase.io` matches size + SHA-256. Then Kubo `add?cid-version=1&raw-leaves=true&pin=true` of each `.car` file → `carCid` (D-5/AM-05), then the manifest (JCS) and its CID must equal `cidOfBytes`. Credentials only in the child env. CLI = `node_modules/.bin/elephant-cli` at 44bb182 (asserted). No `--atlas-page` (A-11). No flag or environment variable can skip or reorder a step (T026). Determinism check (ARD § 10 Continuity "same input → same CID"; agent-design oracle § 4): T046 runs `export-tables --part-size 48m` a second time on each kept CAR and asserts the tables root CID and every part CID are identical; if only `tables-export.json`'s `exportedAt` differs, that is recorded in the D-8 summary as an A-11 risk (the A-11 `--atlas-page` re-export relies on it). Before any excerpt leaves the run directory, `elephant-cli.log` and `reports/*.json` are secret-scanned (T046, T047).
- **Rationale:** oracle § 3, § 4, risk 1; P0-2; no partial publication of one group.
- **Alternatives:** per-group upload interleaved (could publish one CAR alone).

## R-07 Socrata adapter shape and politeness

- **Decision:** promote `travis/pilot/capture-austin.ts` + `travis/lib/source-client.ts` into `travis/adapters/socrata/` (`socrata.ts` generic, `austin-3syk-w9eu.ts` config); list query for issue dates in September 2026 with the profile's `toSoqlInclude()` (one page ≤ 50,000 rows, one pass), then one GET per permit (`?permit_number=…`), raw + receipt + `status/<key>.json`, skip-done; ≤ 1 req/s incl. retries, backoff on 429/5xx only, stop on first 403/challenge (`blocked` receipt). No `tcad_id IS NOT NULL` filter (the no-tcad permit must be counted). Driven by `travis/runs/run-month.ts --month 2026-09` (D-5).
- **Rationale:** oracle § 1; A6; AD-17 seams with Restate deferred.

## R-08 Manifest and run index

- **Decision:** `runId` like `travis-202609-reroof-<utc>`; `previousManifestCid: null` (`first_run`); `sources[]` order Austin (`austin-3syk-w9eu`, records = successful permit GETs) then `tcad-2026-certified-json` (records = matched parcels); `coverage.permits_no_tcad_geoid {count, derivation: "aggregate_match"}` and `coverage.permits_emitted {count, derivation: "published_rows"}`; files are exact JCS bytes (no trailing newline), `runs/** -text` in `.gitattributes`, `runs/` in `.prettierignore`; a test recomputes the committed manifest CID and compares with the index. `runs/index.json` committed only after manifest readback. The index is **append-only**: `appendRun` never removes an entry or alters a `manifestCid` and rejects a duplicate `runId` (T083); the ARD § 11 rollback ("revert the index commit") is a git revert decided by the PO and listed in the PR, not a pipeline write, so "run history keeps every CID" holds in the repository history. Fixed `limitations` notes: `sources[0]` ∋ `Comptroller baseline not loaded (A-07)`, `sources[1]` ∋ `Confidential owner records redacted (Texas Tax Code §25.025): {n}` (P0-15; T082/T083).
- **Rationale:** oracle § 5; AD-03, AD-04, AD-28; contract/v1 unchanged.

## R-09 Infra specifics

- **Decision:** five stacks per metagross § 2 with deploy order AM-02; HTTP API (no Function URL) with stage throttle 10/20 and JSON access log 30 days (AM-03); function log group 14 days; `CfnSamplingRule` FixedRate 1; alarms Errors ≥ 1/5 min, Throttles ≥ 1, 5xx ≥ 1 → SNS email with OK actions, `notBreaching`; `CfnBudget` $10 (80 % actual, 100 % forecast); GitHub OIDC deploy role in Ops limited to the fork's `0*` and `feature/oracle-pipeline` refs; Amplify L1 `CfnApp` (WEB, auto-branch `0*`, auto-deletion off, `feature/oracle-pipeline` PRODUCTION, `AccessToken` = `noEcho` parameter); `CfnDomain` in Cert for `countylens.aldarraj.com` (AMPLIFY_MANAGED cert, no root domain). Lambda: arm64, 1,769 MB, 15 s, no reserved concurrency.
- **Rationale:** metagross § 2–7; AD-11, AD-13, AD-14; AM-02, AM-03.
- **Alternatives:** Amplify alpha construct (legacy oauthToken, pre-release); Cert first (ARD original order; impossible because the association needs the Web app).

## R-10 CI

- **Decision:** one `.github/workflows/ci.yml`: `workspace` (pnpm install, `turbo typecheck lint test synth` with Vitest coverage thresholds ≥ 80 % on `packages/query-core` and `packages/contract`, prettier, stylelint, bundle gate, grep gates incl. the Query-DB, region-literal and "published to Atlas" scans), `oracle-runtime` (every step of `pipeline-ci.yml` unchanged, incl. the kit-provided Python 3.12 + PyYAML validator, plan Complexity Tracking D-03), `gitleaks` (required status check that blocks merge; `.gitleaksignore` lines carry a `# reason:` comment and a PO decision), `deploy` (push to `0*`/`feature/oracle-pipeline`, OIDC, `cdk deploy --all`, concurrency `deploy-countylens`), `e2e-hosted` (polls branch `/build.json` until `sha == GITHUB_SHA`, 12 min, then Playwright). Budgets (NFR-09): `timeout-minutes: 15` on `workspace`, `oracle-runtime` and `gitleaks`; `e2e-hosted` 30 min (recorded deviation, it waits for Amplify). `pipeline-ci.yml` deleted only after `oracle-runtime` is green with step parity in evidence.
- **Rationale:** metagross § 1, § 7; D-05.
- **First deploy:** from the PO laptop (OIDC role does not exist until Ops), gated by 🛑 D-10.
