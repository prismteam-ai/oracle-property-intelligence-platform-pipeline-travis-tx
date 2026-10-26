# CLI contract (A-03)

## `pipeline/oracle-runtime`: `npx tsx travis/runs/run-month.ts --month 2026-09 [--job <jobId>]`
- Captures the Austin slice through `travis/adapters/socrata/` (≤ 50,000 rows/page, one pass, ≤ 1 req/s, stop on 403), classifies with `travis-austin@1.0.0`, builds the TCAD subset from the local certified zip (sha256 checked against `travis-sources.yaml`), applies confidentiality flags, writes `pipeline/data/runs/<runId>/groups/{county,property_improvement}`.
- Exit 0 with a summary (captured, accepted, excluded, emitted, no-tcad, owners_redacted); exit 2 on `blocked` (the first HTTP 403 or bot challenge: `blocked` receipt for that request, no retry of it, no further request, no user-agent or IP rotation, nothing written under `groups/`; FR-014, TC-006); non-zero on any other failure. Backoff applies only to 429 and 5xx.

## `pipeline/publish`: `pnpm --filter @countylens/publish exec tsx src/cli.ts build --run <runId>`
- Phase 1 for both groups (validate → hash+CAR → validate CAR → export-tables `--part-size 48m`). Prints roots, part counts, sizes, SHA-256s and the list of files that would go public (input to 🛑 D-8). Never uploads.

## `… src/cli.ts upload --run <runId>` (🛑 D-8 gated)
- Requires `FILEBASE_*` in env (loaded with `set -a; . ~/.config/assessment/filebase.env; set +a`). Uploads CAR then tables per group, readback, Kubo-adds each `.car` (carCid), writes and uploads the manifest, writes `runs/<runId>/manifest.json` and `runs/index.json`. Exit non-zero on any readback mismatch; no manifest written then.

## `… src/cli.ts cid-copy --manifest runs/<runId>/manifest.json`
- Assumes `assess-cid-writer` profile; bucket from SSM `/countylens/cid-copy/bucket`. Re-reads each local file, recomputes size/SHA-256/CID, conditional PUT, readback. Idempotent (same object → skip); different object → exit non-zero.

## `npx tsx scripts/verify-manifest.ts runs/<runId>/manifest.json`
- Fetches the manifest by its CID from both gateways first and compares it byte-for-byte with the local `runs/<runId>/manifest.json` (one `manifest` line per gateway; a mismatch stops the run, AM-05), then every artifact (tables by `cid`, directories and CARs by `carCid`) from `https://gateway.pinata.cloud/ipfs/<cid>` and `https://ipfs.filebase.io/ipfs/<cid>` with plain GETs; size + streamed SHA-256; 120 s timeout, backoff on 429/5xx honouring `Retry-After` (5 attempts), ≤ 2 concurrent per gateway. Host allowlist rejects CloudFront, `w3s.link`, any other host. One line per artifact per gateway; prints `ALL ARTIFACTS VERIFIED` and exits 0 only if the manifest and all artifacts match on both gateways. Pinata's public rate limit is unpublished (spec Assumptions): on demo day the run is made ≥ 1 h before the demo and kept in the evidence; a live Pinata throttle shows the recorded run beside the live Filebase lane, never a substituted gateway.

## `npx tsx scripts/bench-lambda.ts --prefix private/bench/austin-48m/ --preset TC_NF_05|ADR_0001 --runs 20` (🛑 D-10 gated)
- Invokes the API function directly: one untimed **warm-up** invocation per query and preset, then 20 timed invocations per query (count, radius, roofAge), so every timed run is warm; prints each timed `queryDurationMs` (engine init `initMs` reported separately and excluded; the warm-up's `coldStart` flag is reported, not timed) and p50/p95 as JSON (consumed by `tests/e2e/lambda-fallback.perf.spec.ts`, which owns upload and deletion of the private copy). The `TC_NF_05` preset is the acceptance case; `ADR_0001` is comparison only. Refuses a prefix outside `READPATH_PRIVATE_PREFIX`.
