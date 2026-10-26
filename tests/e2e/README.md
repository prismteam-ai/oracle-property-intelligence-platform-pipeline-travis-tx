# tests/e2e: the hosted Playwright harness (A-03)

Runs only against the hosted runtime. `localhost` is never evidence (constitution I).

```bash
RUNTIME_URL=https://<branch>.<appId>.amplifyapp.com pnpm --filter @countylens/e2e exec playwright test
RUNTIME_URL=… pnpm --filter @countylens/e2e exec playwright test -g "A-03-TC-044"   # one case
pnpm --filter @countylens/e2e test                                                   # harness unit tests (Vitest)
```

## Conventions

- **One test per G6 test case**, in the spec file `testplans/A-03-test-cases.md` § 7 names, titled
  exactly `@scenario:A-03-TC-nnn` (the describe block carries the human title). `--list` shows every
  case; `-g "A-03-TC-nnn"` runs one.
- **`RUNTIME_URL` guard** (`lib/runtime-url.ts`, TC-060): loading `playwright.config.ts` throws
  `RUNTIME_URL must be a hosted URL, not localhost: {value}` for localhost, `127.0.0.1`, `::1`, and
  `RUNTIME_URL is not set; set it to the hosted URL` when unset or blank.
- **`@needs-aws`** (`lib/needs-aws.ts`): a case that uses an AWS profile through `lib/aws.ts`
  (TC-044, TC-050, TC-NF-05 and similar) adds `@needs-aws` to its title. The `e2e-hosted` CI job
  has only `RUNTIME_URL`, so under `CI` without AWS credentials the config excludes those cases
  with `grepInvert` and prints a notice: they are not run and never reported as passed. Run them
  from an operator session with the `assess` profile (`assess-cid-writer` only for the TC-044
  overwrite attempt). The region comes from the profile configuration, never a literal (P0-18).
- **Step 0**: published-data cases import `test` from `./lib/fixtures.js`, whose worker fixture
  `run` opens `{RUNTIME_URL}/runs`, reads the manifest CID and runId from the run card's `data-cid`
  (never the truncated text), fetches the manifest by CID (CID copy first, Filebase gateway as the
  fallback) and validates `RunManifestV1`. Build-time cases open `{RUNTIME_URL}/build.json` and
  require the local `HEAD` to equal the deployed `sha` (`build-checks.spec.ts`).
- **Config keys** (environment): `CID_COPY_HOST` (the CloudFront domain; required by the specs
  that read the copy directly), `FILEBASE_GATEWAY_HOST` (`ipfs.filebase.io`), `PINATA_GATEWAY_HOST`
  (`gateway.pinata.cloud`), `READPATH_PRIVATE_PREFIX` (`private/bench/`).
- **Evidence**: every spawned command's output is attached to the test (`test-results/`, HTML
  report in `playwright-report/`, JSON in `test-results/results.json`).
- Specs never pass trivially: no `test.skip`, no empty bodies; a suite that selects zero tests is
  a failure.

## Evidence formats

### Browser timings (TC-NF-01, TC-NF-02)

The Permits page has no debug hook. Its engine emits User Timing entries with names and times
only (`apps/web/src/engine/timing.ts`): the measure `countylens:duckdb:init` between the marks
`countylens:duckdb:init:start` and `countylens:duckdb:init:end`, the listing
`countylens:query:list` and the page's own COUNT `countylens:query:count`. `perf.spec.ts` reads
them with `performance.getEntriesByType('measure')`: TC-NF-01 over 20 cold loads (a new context
each), TC-NF-02 over 20 reloads after one untimed warm-up. Copy p50 / p95 from the attachments
`tc-nf-01-first-loads.json` and `tc-nf-02-timings.json` into `docs/evidence/A-03.md`.

### Observability evidence (TC-050 → TC-051)

Run TC-050, open its attachment `tc-050-evidence.json`, and copy into `docs/evidence/A-03.md`:

1. one line `x-correlation-id: ` followed by the ID **in backticks**;
2. one line `x-trace-id: ` followed by the X-Ray root trace ID (`1-xxxxxxxx-…`) **in backticks**;
3. a fenced ` ```json ` block holding the Powertools log line (`logLine`) of that
   correlation ID, as one JSON object (one line or pretty-printed).

````markdown
- x-correlation-id: `3f1c…-…`
- x-trace-id: `1-6716a0b2-0123456789abcdef01234567`

```json
{
  "level": "INFO",
  "message": "…",
  "service": "countylens-api",
  "timestamp": "…",
  "correlation_id": "3f1c…",
  "xray_trace_id": "1-6716a0b2-0123456789abcdef01234567",
  "procedure": "runs.summary",
  "queryDurationMs": 12
}
```
````

TC-051 reads `x-correlation-id` and `x-trace-id` from the response headers of a fresh hosted
`runs.summary` call (the recorded correlation ID must have the same shape), finds that log line by
its `correlation_id` (with the Powertools keys, `procedure` = `runs.summary`, an `xray_trace_id`
holding the recorded trace ID, and no URL or credential), and resolves the recorded trace with
`aws xray batch-get-traces` (`@needs-aws`). Identifiers and counts only: never paste a presigned
URL, a credential or a row value.
