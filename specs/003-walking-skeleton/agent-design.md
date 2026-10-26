# A-03 agent design (read-only consultations)

Both design agents were consulted read-only on 2026-10-21 from 03:01, while the read-path spike (`docs/decisions/0001-read-path.md`) was still running. They assumed the ARD read path (S3 + CloudFront CID copy first, Filebase gateway as labelled fallback, AD-02) and treated `export-tables --part-size` as a parameter. A delta check against 0001 follows the spike (section "Spike delta").

## oracle (soofi-xyz-team-kit:oracle) · publication

Skills loaded: use-oracle, county-permit-adapter, apply-engineering-guidelines. Answer recorded word for word:

### Oracle design consult: A-03 publication slice (read-only; no files changed)

Sources I read: spec, story, ARD (§3, §7–9, §12, §15), Task A addendum, A-oracle §8, contract/v1, `packages/contract/src`, ADR-0002, A-02 evidence, `pipeline/publish/src/*`, the pilot (`run-pilot.ts`, `capture-austin.ts`), `kit/VENDORED.md`, and `elephant-cli upload|export-tables --help` (1.58.1 / 44bb182).

#### 1. Socrata adapter: promote the pilot code, don't write a second one
- **Promote.** Move `travis/pilot/capture-austin.ts` and `travis/lib/source-client.ts` into a vendor module, `pipeline/oracle-runtime/travis/adapters/socrata/` (`socrata.ts` generic; `austin-3syk-w9eu.ts` holds the config: domain, dataset, date window, the profile's `toSoqlInclude()`). Shape it to the `county-permit-adapter` contract: list query → one GET per permit (`?permit_number=…`) → raw body + receipt → per-permit `status/<key>.json`. Use deterministic `safePermitName` keys and skip work already done. Artifacts go to `pipeline/data/artifacts/permits/travis/<jobId>/{permit-lists,raw,extracted,status}` (gitignored).
- **Run orchestrator.** Pull stages 1–7 out of `run-pilot.ts` into reusable functions and add `travis/runs/run-month.ts --month 2026-09`. Keep the `september` slice only and drop `expired`/`older_final`. Do **not** add `tcad_id IS NOT NULL` to the query: the no-tcad permit has to be captured so it can be counted.
- **Classification.** Only `profiles/travis-austin@1.0.0` classifies. The adapter file contains no reroof terms (CI grep gate). Expected counts: 42 captured, 4 excluded, 1 with no tcad_id, about 37 emitted. The exact numbers are whatever the run records; nothing is padded.
- **Receipts and provenance.** Each receipt records url, `multiValueQueryString`, status, bytes, sha256, `captured_at`, outcome, UA and attempts. `source_http_request` is the per-permit GET, so `source_url` reproduces exactly that record. The watermark is the max `:updated_at`. Source-level `captured_at` is the latest successful receipt (the existing `buildManifest.source()`).
- **Politeness.** Identified UA, no app token, at most 1 request/s including retries. Backoff only on 429/5xx (full jitter, 1 s base, 60 s cap, 5 attempts). A 403 or challenge writes a `blocked` receipt and stops. About 45 s in total.

#### 2. Data groups
- **Publish `county` and `property_improvement` only**, one CAR each, with the seed root inside both. Seed is never published as its own group.
- **Nothing else.** No company/person/license (AD-06; Comptroller is A-07), no corporate registry, places or HOA.
- **TCAD subset.** Reuse `capture-tcad-subset.ts`. It reads the local A-01 certified zip (no network) and must first check the zip sha256 against `export_sha256` in `travis-sources.yaml`.
  - Select the distinct `tcad_id`s of the **accepted and emitted** permits only. Excluded trade sub-permits must not pull parcels in.
  - Apply confidentiality flags before `validate` (P0-15). Ambiguous geoIDs and unmapped property types are not published; each goes into `coverage`.
  - TCAD `sources[].records` is the number of matched parcels from the subset receipt.

#### 3. Publication sequence (extend the existing `pipeline/publish/src/sequence.ts`)
Run from `R=pipeline/data/runs/<runId>/`, which is gitignored. Use the CLI at `node_modules/.bin/elephant-cli`, the same commit 44bb182 as `~/.local/share`. Assert that commit at start; never use Homebrew.
```
validate R/groups/<g> --output-csv R/reports/<g>-errors.csv
hash R/groups/<g> --output-zip R/hashed/<g> --output-csv R/reports/<g>-hash.csv --output-car R/car/travis-<g>.car
validate R/car/travis-<g>.car --output-csv R/reports/<g>-car-errors.csv
export-tables R/car/travis-<g>.car --output R/tables/<g> --part-size $PART_SIZE --output-json R/reports/<g>-tables-export.json
upload R/car/travis-<g>.car --api https://rpc.filebase.io --gateway https://ipfs.filebase.io --timeout 300 --output-json R/reports/<g>-archive-upload.json
upload R/tables/<g> --api https://rpc.filebase.io --gateway https://ipfs.filebase.io --timeout 300 --output-json R/reports/<g>-tables-upload.json
```
- **Two phases.** Run steps 1–4 for both groups before any upload, so a failure in one group never leaves the other group's CAR published on its own. The per-group order stays the same.
- **Credentials.** Load `filebase.env` into the **child process env only**. Never pass `--token` on argv, because argv is written to `reports/sequence.json`. Remove `ELEPHANT_IPFS_GATEWAYS` (already done) and set the spawn `cwd` to R so `elephant-cli.log` lands there.
- **Readback.** Parse each upload JSON and check that the root matches the hash/export root using `sameDigest` (codecs differ) and that the part count matches. Then GET every part from `ipfs.filebase.io` and compare size and SHA-256. Any mismatch stops the run before the manifest is written.
- **Step-order test (extend `sequence.test.ts` with the injected `fakeCli`).**
  - The recorded calls equal exactly 2×4 build steps followed by 2×2 uploads.
  - A parametrized case fails each of the 12 steps in turn and asserts no later call happens.
  - A readback mismatch means no manifest is built.
  - `plan()` produces the same step list for a 0-row and a huge input. There is no flag or env switch to skip a step (P0-2).
  - `buildManifest` requires upload reports by type.
  - Before the first public upload, capture a real upload `--output-json` fixture from an offline `ipfs daemon --offline` run.
- **What `--part-size` changes.** `part_size_bytes` is stored in the CountyTables block, so **the tables root CID depends on it even when the slice gives one part per table**. Fix the value before the first upload; published CIDs never change.

| Value | Full-county effect |
|---|---|
| 1g | One huge part per table. Fewest requests, but a 100 MB+ object on ipfs.io/dweb.link falls under the ARD §8 ">50 MB needs CLI evidence" exception. Weak for verify. |
| 256m / 128m | A middle ground: some parts still over 50 MB. |
| 48m | Every part under 50 MB, so verify-manifest runs purely on the gateways. More manifest entries, and DuckDB reads a list of parts (more parallel range GETs). This is my preference if the spike's p95 holds. |

#### 4. `--atlas-page`: do not use it in A-03
Atlas registration is A-11. P0-4 says no one may say "published to Atlas" before the merge; the UI and evidence should say "public by CID; Atlas registration pending". In A-11, re-run `export-tables --atlas-page` on the kept CAR with the same `--part-size` and assert the tables root is identical. That relies on the CLI being deterministic, so test it now by running export twice on the same CAR.

#### 5. RunManifestV1 and RunsIndexV1
- **runId.** Matches `^[a-z0-9][a-z0-9-]*$` and contains no "pilot", e.g. `travis-202609-reroof-20261021t1530z`. Drop `PILOT_LIMITATION`. Set `previousManifestCid` to null (the view shows `first_run`).
- **Sources, in this order.**
  1. `austin-3syk-w9eu`: records = successful permit GETs (42); `added` = records.
  2. `tcad-2026-certified-json`: watermark `entry@sha256`.
- **Source labels.** Keep `name` as the slug. The display label ("City of Austin Issued Construction Permits (3syk-w9eu)") goes in a `packages/shared` map, with a test that fails on any unmapped name.
- **Where `permits_no_tcad_geoid` lives.** It is **not** in `sources[]`; the strict schema would reject it there. It is `coverage.permits_no_tcad_geoid {count, derivation:"aggregate_match"}`. Optionally add a limitation line on the Austin source that points to it.
- **Published count.** `coverage.permits_emitted` (`published_rows`) is the number the Permits list must equal (SC-003), not `sources[].records`.
- **Other fields.** `profiles[]` as in the pilot. Fail if the tree is dirty; don't record a limitation for a published run. CIDv1, no gateway URLs and no IPNS are already enforced by the refinements. No `coverage.json` (AD-04).
- **Files.**
  - `runs/<runId>/manifest.json` is the **exact JCS bytes, no trailing newline**, and its CID is `cidOfBytes`. Add `runs/` to `.prettierignore` and set `runs/** -text` in `.gitattributes`. Add a test that recomputes the committed file's CID and compares it with the index.
  - `runs/index.json` (RunsIndexV1, ordered by `finishedAt`, also JCS) is committed only after the manifest upload passes readback.
  - Upload both via Kubo RPC `add?cid-version=1&raw-leaves=true&pin=true` and require that the returned CID equals the local CID. The index CID goes in the evidence, not inside the index.

#### 6. CID-copy uploader (`pipeline/publish/src/cid-copy.ts`)
- **Inputs.** Takes only the manifest, re-reads every listed local file and recomputes size, SHA-256 and CID; it fails if any differs from the manifest. It runs only after Filebase readback succeeds.
- **Keys.** Immutable `ipfs/<cid>` only: every table part, each `tables.car` under its `carCid`, the manifest under its CID. Archive CARs are optional; they belong on Filebase and the GitHub Release. **Never a mutable `runs/index.json` key.** The app reads the committed index from the Amplify origin.
- **Write.** HeadObject first. If the object exists with the same size and sha metadata, skip it (idempotent); if it differs, fail hard. Otherwise PutObject with `IfNoneMatch:"*"`, `ChecksumSHA256`, metadata `{cid, sha256}`, the proper Content-Type, and `Cache-Control: public, max-age=31536000, immutable`. Then a HeadObject readback with `ChecksumMode` enabled.
- **Config.** Bucket from a CountyLensData stack output; region from config (eu-north-1); never hard-coded.
- **Spike assets.** The private full-size Parquet from the read-path spike goes in a separate private prefix or bucket, outside the CloudFront origin path.

#### 7. `scripts/verify-manifest.ts`
- **Structure.** A thin CLI over `pipeline/publish/src/verify.ts`.
- **Hosts.** A host allowlist of `ipfs.io` (path form) and `{cid}.ipfs.dweb.link` (follow the subdomain redirect). A test asserts that CloudFront, Filebase and w3s.link are rejected.
- **Checks.** The manifest itself: fetch it by CID and compare bytes. Each artifact: stream a SHA-256 hash with a cap of size+1 bytes. Backoff on 429/5xx with full jitter, honouring `Retry-After`, 5 attempts. `TIMEOUT_MS` per request (default 120 s, because the first fetch after upload is slow). Concurrency of at most 2 per gateway.
- **Output.** One line per artifact per gateway. `ALL ARTIFACTS VERIFIED` and exit 0 only if 100% match on both gateways.
- **Which CID it fetches:** table → `cid`; directory → `carCid` (the `tables.car` bytes), plus `?format=raw` of `cid`, which must hash to the root; car → see risk 1.

#### 8. Where `pipeline/publish` lives and how it stays free of the Query DB
It already exists as the workspace package `@countylens/publish` (in `pnpm-workspace.yaml`). Add upload, readback, cid-copy and verify there; the AWS SDK v3 is allowed. To keep it free of the Query DB: ESLint `no-restricted-imports` and dependency-cruiser ban `pg`, `postgres`, `@elephant-xyz/query-db` and `DATABASE_URL`; a test greps `package.json` and `src` for these; `buildManifest` takes only CLI outputs, receipts and numeric coverage.

#### Risks and conflicts with my guardrails
1. **The CAR artifact cannot be checked by SHA-256 as the contract stands (blocks FR-006).** Its manifest `cid` is the dag-json archive root, while size and sha256 are those of the CAR file. A gateway GET returns the root node, not the file. On top of that, `upload` imports CARs, including `tables.car`, as a DAG, so `carCid` (the UnixFS file CID) does not resolve on any gateway either. **Fix:** after the CLI upload, also Kubo-`add` each `.car` file (raw-leaves CIDv1) and set `carCid` on `car` artifacts as well. The schema allows this, since the refine only requires `carCid` on directories. It is an additive README note; mew and the PO should confirm.
2. **AD-17/A1 versus the vendored kit.** The vendored kit has no Restate PermitHarvest or Postgres runtime, only the estimator and readiness. "Captured through the kit runtime" therefore needs a PO decision: either vendor the Restate services now, or record that A-03 drives the adapter module directly and the Restate wiring comes in A-05/A-06.
3. **Two skill-order deviations to record.** `county-permit-adapter` says to load the identity baseline before permits, but the Comptroller baseline is A-07. Query DB reconciliation is also skipped. Both are acceptable because no contractor edge is written: all permits are `contractor_unresolved`, with the note "Comptroller baseline not loaded (A-07)".
4. **Wording.** "Publish" means "public by CID", not "published" in the kit sense (Atlas PR + IPNS + MCP sync). The evidence must say so.
5. **One pin only (AD-22).** The second pin and the GitHub Release CARs are not in A-03. Gateway warm-up is slow after the first upload.

#### How to verify
- `pnpm test` covers the order, skip-proofing, readback, the JCS/CID of committed files, the copy refusing to overwrite, and the verify host allowlist.
- The run report gives every root, part count and CID.
- `npx tsx scripts/verify-manifest.ts runs/<runId>/manifest.json` prints `ALL ARTIFACTS VERIFIED`.
- The hosted Runs count equals `coverage.permits_no_tcad_geoid`, and the Permits row count equals `coverage.permits_emitted`.

## metagross (soofi-xyz-team-kit:metagross) · app, hosting, infra

Skills loaded: build-frontend-backends, integrate-ci-cd, responsive-design-tests, apply-engineering-guidelines. Answer recorded word for word:

### Metagross design for A-03 (walking skeleton). Read-only; no files changed

#### Findings from the code that the plan must handle
- `packages/query-core/src/sql.ts` reads `views.sql` with `node:fs`, and `profiles/travis-austin@1.0.0/index.ts` and `gazetteer/.../index.ts` hash with `node:crypto` when the module loads. None of these can be bundled for the browser. Fix: a generator writes `sql.generated.ts` (string constants) and the digest constants. A Node Vitest test checks that the generated values equal the files and the recomputed SHA-256. Behaviour and contract stay the same.
- `bindManifest(manifestBytes, tablesDir, engine)` builds file paths as `${tablesDir}/${group}/${table}/${part}`. The CID copy stores files at `/{cid}`, so this layout does not fit. Add an optional field `BindOptions.partUrl?: (a: {name, cid}) => string`. The default keeps today's path. This is additive and leaves `contract/v1` untouched.
- New query-core builders: `listRoofingPermitsSql()` and `runSummarySql()`. Queries stay in one place (AD-19).

#### 1. Turborepo scaffold: do not merge the two toolchains
- Keep `pipeline/oracle-runtime` as its own npm project, outside the pnpm/turbo graph. That is A-02 R-11. The reasons: it is the vendored kit runtime and runs "as provided" (article II, D-03); its `package-lock.json` is the pinned A-01 evidence; pnpm's strict `node_modules` could break the kit's `.mjs` resolution; no workspace code imports it: publish reads its artifacts from disk.
- Turbo manages only the pnpm workspace. `pnpm-workspace.yaml` adds `apps/*`, `infra` and `tests/e2e`, and gets `supportedArchitectures: {os:[current,linux], cpu:[current,arm64], libc:[current,glibc]}` so the DuckDB linux-arm64 bindings resolve.
- `turbo.json` tasks: `build` (`^build`, outputs `dist/**`), `typecheck`, `lint`, `test` (outputs `coverage/**`), `synth`. `format:check` stays at the root.
- `packages/tsconfig` (base/node/react, moved from `tsconfig.base.json`) and a thin `packages/eslint-config`, which the root flat config re-exports. This follows AD-23.
- CI becomes one workflow, `.github/workflows/ci.yml`, with these jobs:
  - `workspace`: pnpm install, `turbo typecheck lint test`, prettier, bundle-size check, `cdk synth` and assertions.
  - `oracle-runtime`: copies **every step of pipeline-ci.yml unchanged** (setup-node with npm cache on the lockfile, Python 3.12 with PyYAML 6.0.3, `npm ci`, typecheck, lint, format:check, `npm test`, validator `--self-test`, `check-catalog`, and validator output diffed against `docs/evidence/A-01-readiness.json`). It runs on every push, with no path filter; it is fast.
  - `gitleaks`: the binary or Docker image, using the existing `.gitleaksignore`.
  - `deploy` and `e2e-hosted`: see section 7.
- Delete `pipeline-ci.yml` only after `ci.yml`'s oracle-runtime job is green on the branch, with step parity shown in the evidence. `a01-us-gis-probe.yml` stays (it is disabled).

#### 2. The five CDK stacks (`infra/`, one app in `bin/countylens.ts`)
- The region comes from `CDK_DEFAULT_REGION` (Zod-checked in `infra/src/config.ts`; synth throws if it is missing). Everything is tagged `project_name=oracle-travis`. The cdk-nag AwsSolutions pack runs, with any suppressions documented.
- **CountyLensData**: CID-copy S3 bucket: all public access blocked, SSE-S3 (not KMS), SSL enforced, RETAIN, abort incomplete uploads. A bucket policy **denies PutObject when the `s3:if-none-match` condition key is missing**, so S3 itself refuses overwrites. Writers get no DeleteObject. CloudFront with OAC, PriceClass_100, and no WAF. The `CountyLensCidCopyWriter` role (section 4).
- **CountyLensApi**: the tRPC Lambda, the HTTP API, access logs, and the X-Ray sampling rule (sections 5 and 6).
- **CountyLensWeb**: the Amplify app and branches (section 3).
- **CountyLensOps**: SNS topic and email subscription, alarms, the $10 budget, and the GitHub OIDC provider and deploy role.
- **CountyLensCert: what it holds.** Amplify issues its own certificate, so nothing needs ACM. A certificate for a custom domain on CloudFront or the API would need us-east-1 ACM (banned) or more DNS work, so both use their default domains, and the API is reached same-origin through Amplify. CountyLensCert therefore holds **only the `AWS::Amplify::Domain` association**. That is the resource that can sit waiting on Namecheap DNS validation, and isolating it keeps that wait out of the Web stack, which is ARD § 11's intent. **ARD § 11 amendment needed:** the deploy order changes to **Data → Api → Web → Ops → Cert**, because Cert needs the Web app ID and branch.
- **Cross-stack references** (direct props, which become exports): Data.bucket → Api (read-only grant). Data.distributionDomain → Web (environment variable). Api.httpApiUrl → Web (rewrite target). Api.fn and httpApi → Ops (alarms). Web.appId and branch → Cert. Keep exports few; renaming an exported value later blocks updates.
- **CDK assertions** (Vitest, `infra/test/`):
  - Whole app, across all stacks: no `AWS::Route53::HostedZone`, `SecretsManager::Secret`, `KMS::Key`, `WAFv2::*`, `CertificateManager::Certificate`, `RDS::*` or `Lambda::Url`. No `ProvisionedConcurrencyConfig` and no `ReservedConcurrentExecutions`. The tag is on every resource. A source scan finds no region literal in `infra/`.
  - Api: arm64, 1769 MB, 25 s, tracing Active, `LoggingConfig.LogFormat=JSON`, function log group 14 days, access/query log 30 days, stage throttles set, sampling rule `FixedRate=1`.
  - Ops: budget of 10 USD with notifications. Every alarm has `AlarmActions` and `OKActions` pointing at the topic and `TreatMissingData=notBreaching`. A generic rule says every `AWS::SQS::Queue` either has a `RedrivePolicy` or is a DLQ with exactly one alarm. Today that rule passes trivially (zero queues), and it applies automatically once AD-12 adds queues.
  - Data: public access block, AES256 encryption, OAC, the CORS headers below.
  - Web: auto-branch pattern `0*`, branch auto-deletion off, `feature/oracle-pipeline` with stage PRODUCTION, and `AccessToken` = Ref to a parameter marked `NoEcho: true`.

#### 3. The Amplify app and the GitHub token
- **Use the L1 `CfnApp`, not the alpha construct.** The alpha construct's `GitHubSourceCodeProvider` sends a legacy `oauthToken`, while L1 `accessToken` uses the Amplify GitHub App. The alpha package is also pre-release.
- Settings: platform `WEB` (static). Build spec comes from `amplify.yml` in the repo (`appRoot: apps/web`, Node 22, `pnpm install --frozen-lockfile --filter @countylens/web...`). This filtered install avoids building the GitHub `elephant-cli` dependency. Environment: `AMPLIFY_MONOREPO_APP_ROOT=apps/web` and `VITE_CID_COPY_ORIGIN`. Neither is secret. `enableAutoBranchCreation`, `autoBranchCreationConfig {patterns:['0*'], stage: DEVELOPMENT, enableAutoBuild}`, `enableBranchAutoDeletion:false`. `CfnBranch` for `feature/oracle-pipeline` with stage PRODUCTION. Custom rules: `/api/<*>` → `${httpApiUrl}/<*>` (200 rewrite, so the API is same-origin and works on every preview with no CORS), the SPA fallback (excluding `wasm|json|js|css|…`), and headers `/build.json` no-cache, `*.wasm` `application/wasm`.
- **Domain (CountyLensCert):** set `domainName: countylens.aldarraj.com` with `subDomainSettings [{prefix:'', branchName:'feature/oracle-pipeline'}]` and an AMPLIFY_MANAGED certificate. Do not associate the root `aldarraj.com`. A root domain can belong to only one Amplify app, and Task B needs its own subdomain. The PO adds two Namecheap CNAMEs, taken from `aws amplify get-domain-association`: the certificate-validation record and `countylens` → `d….cloudfront.net`.
- **The token:** a `CfnParameter('GitHubAccessToken', {noEcho:true})`. CloudFormation does not support `ssm-secure` for Amplify (checked in the CFN docs), and Secrets Manager is banned. Amplify uses the token to authorise the GitHub App and **does not store it**. CI never passes it: `cdk deploy` reuses the previous parameter value by default.
- **PO steps.** Do them in your own terminal and browser, never through Claude:
  1. GitHub: install the "AWS Amplify (eu-north-1)" GitHub App (`github.com/apps/aws-amplify-eu-north-1`; confirm the exact name on the install page) on **only your fork**.
  2. GitHub → Settings → Developer settings → Personal access tokens (classic): note `countylens-amplify`, expiry 7 days, scopes `repo` and `admin:repo_hook`. Copy it.
  3. Terminal: `read -rs GH_TOKEN` (paste, then Enter; nothing is shown). Then `aws ssm put-parameter --profile assess --region eu-north-1 --name /countylens/github/amplify-access-token --type SecureString --value "$GH_TOKEN"`, then `unset GH_TOKEN`.
  4. First Web deploy: `pnpm --filter @countylens/infra exec cdk deploy CountyLensWeb --profile assess --parameters CountyLensWeb:GitHubAccessToken="$(aws ssm get-parameter --profile assess --region eu-north-1 --name /countylens/github/amplify-access-token --with-decryption --query Parameter.Value --output text)"`.
  5. After the first Amplify build succeeds, revoke the PAT on GitHub. Optionally delete the SSM parameter. A new token is needed only if the app is ever replaced.

#### 4. CID copy bucket and CloudFront
- Paths are `/{cid}` for parts, CARs and the manifest. Nothing mutable goes in the bucket.
- `runs/index.json` is committed and copied into `apps/web/public` at build time, so it is served same-origin.
- Cache policy: default TTL 1 year. Nothing is added to the cache key (no headers, query strings or cookies). Objects carry `Cache-Control: public, max-age=31536000, immutable`. A 404 is cached for only 10 s (error TTL), so a newly uploaded CID appears quickly.
- Response-headers policy: `Access-Control-Allow-Origin: *` (the data is public and immutable and no credentials are sent); methods `GET, HEAD, OPTIONS`; allowed headers `Range, If-None-Match`; **exposed headers `Content-Range, Accept-Ranges, Content-Length, ETag`**; origin override on. CloudFront serves Range requests natively.
- **Writer:** the `CountyLensCidCopyWriter` IAM role, assumable only by account principals. The PO's `assess` profile assumes it through a `role_arn` profile named `assess-cid-writer`. No access keys. Allowed: `s3:PutObject` and `GetObject`/`HeadObject` on `bucket/*`. No Delete and no ACL actions. `pipeline/publish` (oracle's code) does a conditional PUT with `If-None-Match: *`. It also sets `ChecksumSHA256` to the manifest SHA-256 (base64), so S3 rejects any byte mismatch, plus Content-Type and Cache-Control. It then reads each object back. The bucket name and role ARN come from CDK outputs, mirrored in the SSM String parameter `/countylens/cid-copy/*`. CI never uploads.

#### 5. API Lambda
- **Endpoint:** tRPC `runs.summary({manifestCid: CidV1})`, i.e. `GET /api/trpc/runs.summary?input=…` through the Amplify rewrite. The handler GETs the manifest from S3 and **checks that `rawCid(bytes)` equals the input**. A CID that is not in the bucket returns NOT_FOUND. It caches the manifest and parts in `/tmp` by CID, calls `bindManifest` with `@duckdb/node-api` (a module-scope instance, bound once per CID), and runs `runSummarySql()`. It returns `{manifestCid verified, tables bound, v_roofing_permit rows, queryDurationMs}`. The Runs page shows this as a "Server check" line next to the manifest's own counts. The headline counts still come from the manifest (FR-009). This is honest, small, and exercises exactly the Lambda fallback path.
- **Use the HTTP API, not a Function URL.** A Function URL bypasses throttles (AD-09) and has no stage throttling or access log.
- Throttles: stage default 10 rps, burst 20. No reserved concurrency (account limit 10).
- Powertools middleware (middy): `injectLambdaContext` with `correlationIdSearchFn: search` and `correlationPaths.API_GATEWAY_HTTP`; `captureLambdaHandler`; `logMetrics({captureColdStartMetric:true})`.
- Observability details: a subsegment `duckdb.query` with annotations manifestCid and query name; the `QueryDurationMs` metric (milliseconds, dimension `procedure`); exactly one `logger.info`; Lambda `systemLogLevel: WARN`, so platform START/END/REPORT lines do not add log lines; the response sets headers `x-correlation-id` and `x-trace-id` (from `_X_AMZN_TRACE_ID`), so Playwright can write both into `docs/evidence/A-03.md`.
- **Bundling:** `NodejsFunction` with `@duckdb/*` marked external. `afterBundling` runs `npm install --prefix <out> --os=linux --cpu=arm64 --libc=glibc @duckdb/node-api@1.5.6-r.2`.

#### 6. Observability and operations
- Logs: function log group: 14 days. HTTP API access log, a JSON line per request with requestId, route, status and latency: **30 days, and this is the "query log"**. This interpretation of AD-16 needs PO confirmation.
- Tracing: HTTP API has no X-Ray of its own, and the default X-Ray sampling would miss most requests. A `CfnSamplingRule` (service `countylens-api`, `FixedRate: 1`) gives 100% (NFR-004). It costs nothing while idle.
- **Queues: none in A-03.** A synchronous read with layered timeouts is justified here (AD-27).
- Alarms: Lambda `Errors ≥ 1/5 min`, `Throttles ≥ 1`, HTTP API `5xx ≥ 1`. Each sends `ALARM` and `OK` to SNS and treats missing data as not breaching, so each clears itself.
- The operator email comes from context or the `OPERATOR_EMAIL` CI variable and is not in git. The PO confirms the subscription email.
- `CfnBudget`: $10 monthly cost. Notifications at 80% actual and 100% forecast go to the same email.

#### 7. CI
- `deploy` job: runs on push to `0*` and `feature/oracle-pipeline` only, with `concurrency: deploy-countylens` (never cancelled). GitHub OIDC (role in **CountyLensOps**; the trust is limited to the fork's `0*` and `feature/oracle-pipeline` refs; the role may only assume the `cdk-hnb659fds-*` roles). Runs `cdk deploy --all --require-approval never`. **Bootstrap problem:** the role does not exist until Ops is deployed, so the PO's laptop does the first full deploy.
- `e2e-hosted` job: polls `https://{branch-slug}.{AMPLIFY_APP_ID}.amplifyapp.com/build.json` (`feature/` becomes `feature-`) until `sha == GITHUB_SHA`, with a 12-minute timeout. Then it runs Playwright on that URL. The Playwright config throws for localhost or 127.0.0.1. Amplify writes `build.json` from `AWS_COMMIT_ID` and `AWS_BRANCH`.
- Bundle gate: a script gzips `dist/assets/*.js`, excluding the duckdb chunks, and fails above 300 KB.

#### 8. Runs and Permits pages (`apps/web`)
- Stack: React 19, Vite, react-router (lazy routes), and TanStack Query through `packages/api-client`. That package is the only tRPC client; it imports `AppRouter` type-only and uses `splitLink`. **No UI library.** CSS Modules with `tokens.css` copied into `src/styles`. Stylelint `declaration-strict-value` forces color, spacing and type values to be tokens, and ESLint bans inline style literals.
- **Runs page:** (1) fetch `/runs/index.json` and check it against `RunsIndexV1`; (2) fetch the manifest through `fetchByCid` (CID copy, with a 4 s timeout or non-200 falling back to `https://ipfs.filebase.io/ipfs/{cid}` and a "fallback" chip) and verify its rawCid; (3) validate with `RunManifestV1`; (4) show the run ID, UTC start and finish, the sources in manifest order with their `records`, `permits_no_tcad_geoid` labelled "No TCAD id on source record", the manifest CID, and the Server check line.
- **Permits page:** DuckDB-WASM is loaded through dynamic `import()` with the self-hosted eh bundle (no COOP/COEP needed). `partUrl` points to `copyUrl(cid)` or the fallback. A state machine (`loading`, `ready`, `error`) drives an Atlas linear progress bar with stage text. **The table renders only when state is `ready`**, so no empty table flashes. Layout: cards at 390 px, a table at 768 and 1440 px. The engine line reads "DuckDB-WASM in your browser · read-only", plus a fallback chip when the fallback is used. If the row count differs from the manifest count, an error banner shows. Nothing is padded.
- `<Provenance/>` and `<MissingReason/>` only render; they decide nothing. `packages/shared` holds `MISSING_REASON_LABELS: Record<MissingReason,string>` (tsc fails on a missing key, and a Vitest test walks `MISSING_REASONS`, FR-011), `missingLabel(field, reason)`, which applies the contractor `source_missing` override, and `copyUrl` and `gatewayUrl`.
- Tests (smeargle): 390/768/1440 on the hosted URL. The fallback case uses `page.route('**/*.cloudfront.net/**', abort)` on the hosted page, so there is no debug flag in production.

#### If the spike shows p95 ≥ 3 s
- **What changes:** the Permits list moves to tRPC `permits.list` running the same `listRoofingPermitsSql()` on the Node engine. The Lambda switches from downloading to `/tmp` to range reads: a bundled `httpfs` extension (`extension_directory` in the asset, autoinstall off) or more ephemeral storage. Cold-start, throttle and concurrency budgets get tighter, and provisioned concurrency stays banned. The engine line and AC-3's wording change, which needs a PO amendment. The Explore SQL tab stays browser-only (P0-13).
- **What stays:** the CID copy, CloudFront, manifests, the Runs page, `packages/*`, the `QueryEngine` interface and `bindManifest`. Part size is always read from the manifest's artifacts and never hard-coded.

#### Data and contract changes
- **None to `contract/v1`.** Additive, in query-core: `partUrl`, the generated SQL and digests, and the two SQL builders. New data from the oracle publish step: `runs/index.json` and `runs/{runId}/manifest.json`.

#### Files touched
- New: `apps/web/**`, `apps/api/**`, `packages/{api-client,shared,tsconfig,eslint-config}`, `infra/{bin,src,test}`, `tests/e2e/**`, `turbo.json`, `amplify.yml`, `.github/workflows/ci.yml`, `.stylelintrc`.
- Changed: `pnpm-workspace.yaml`, root `package.json` (turbo scripts), `eslint.config.js` (allow `@duckdb/*` only in `apps/*/src/engine`; ban `@aws-sdk/*` and `pg` in web), `packages/query-core/src/{sql,bind-manifest,index}.ts`, the profile and gazetteer index files.
- Deleted: `pipeline-ci.yml`, once parity is proven.

#### Risks
1. If `AWS::Amplify::Domain` waits for DNS validation, it can stall the Cert stack. It is isolated by design.
2. Whether the Amplify rewrite proxy forwards the query string and response headers must be checked on the first preview. Fallback: HTTP API CORS for exact origins.
3. If Amplify has a per-file limit, the ~30 MB `duckdb-eh.wasm` may not fit. Check on the first build.
4. Filebase gateway CORS and Range support is unproven until the spike.
5. The cross-platform DuckDB binary in the Lambda asset.
6. Install time on Amplify, made worse by the `elephant-cli` git dependency (the filtered install helps).
7. Export lock-in from cross-stack references.

#### Verification on the hosted URL
- On `countylens.aldarraj.com`, or the branch URL named in the evidence: Playwright for AC-2, AC-3 and AC-5 (including the aborted-CloudFront fallback) at 3 widths; `build.json` SHA equals the commit; 30 calls to `runs.summary` → warm p95 below 1 s, read from `QueryDurationMs`; force a cold start by changing an environment variable → X-Ray Initialization plus the query below 3 s.
- Then: record the correlation and trace IDs in `docs/evidence/A-03.md`; find the log line in CloudWatch Logs Insights; run the CDK assertions in CI; run `verify-manifest` on ipfs.io and dweb.link.

#### Warning signs avoided
No Route 53 zone (Namecheap CNAMEs, subdomain-scoped association). No Secrets Manager (noEcho parameter plus SSM SecureString). No provisioned or reserved concurrency. No region literal. No Amplify Gen2 or AWS Blocks (L1 CDK). No us-east-1 ACM or WAF. No KMS CMK. No side files or serving Parquet (the bucket holds only CLI artifacts, enforced by the conditional PUT and SHA-256 checksum). No IPNS (the committed run index). No DuckDB range reads on ipfs.io or dweb.link (verify only). No Function URL. No console-created resources.

## Disagreements and open points

By the § 1 rule: oracle wins on what becomes public and how it is published; metagross wins on hosting, API, infra and UI mechanics.

| # | Topic | metagross says | oracle says | Recommendation |
| --- | --- | --- | --- | --- |
| 1 | CID-copy write guard | bucket policy denies PutObject without `If-None-Match`; writer role `CountyLensCidCopyWriter` via `assess-cid-writer` profile | uploader does HeadObject, then conditional PUT + `ChecksumSHA256`, readback | Both (compatible): metagross owns the bucket and role, oracle the uploader. |
| 2 | CAR artifacts verifiable by SHA-256 | not addressed | `cid` of a `car` artifact is the archive root, not the file; add a Kubo `add` of each `.car` file and set `carCid` on `car` artifacts (additive) | oracle (publication). PO confirms the additive contract note (D-5). |
| 3 | Deploy order | Data → Api → Web → Ops → Cert (Cert holds only the Amplify domain association); ARD § 11 amendment | — | metagross (infra). PO approves the ARD § 11 amendment (D-5). |
| 4 | "Query log" 30 days (AD-16) | HTTP API access log = query log, 30 days | — | metagross. PO confirms the interpretation (D-5). |
| 5 | "Captured through the kit runtime" | runtime stays a separate npm project | vendored kit has no Restate PermitHarvest; drive the adapter module directly, Restate wiring later | oracle. PO decides (D-5). |
| 6 | CID-copy fallback timeout | 4 s timeout or non-200 | — (spec agent proposed 5 s) | metagross: 4 s or non-200 or network error (D-2). |
| 7 | `--part-size` | parameter, read from the manifest | 48m preferred if the spike p95 holds | decided by the spike (D-4). |
| 8 | Source display labels | `packages/shared` map | `packages/shared` map, test fails on unmapped name | agree. |
| 9 | `runs/index.json` location | committed, copied into `apps/web/public` | committed, never a mutable bucket key | agree. |

## Spike delta (after `docs/decisions/0001-read-path.md`, Accepted 2026-10-21)

The agents' answers above are kept word for word. These points supersede them where they differ (PO decisions D-4, D-5, D-2; ARD § 16 AM-01…05):

| Topic | Answer above | Now |
| --- | --- | --- |
| Verify gateways | ipfs.io and dweb.link (both agents) | **Pinata + Filebase** public gateways, plain GETs, size + SHA-256; ipfs.io and dweb.link retired 2026-09-21 (429 + `Sunset`); allowlist still rejects CloudFront and w3s.link (AM-01) |
| Radius and roof-age queries | browser DuckDB-WASM (metagross § 8); "If the spike shows p95 ≥ 3 s" section | **Lambda DuckDB fallback** (metagross's fallback section applies to these two queries only); the Permits list, COUNT and small reads stay in the browser; in-region p95 proved by 20 direct `aws lambda invoke` runs on a private, non-CloudFront prefix, file deleted after |
| Lambda | 25 s timeout | 1,769 MB, DuckDB `threads = 2`, timeout 15 s (0001), no reserved concurrency |
| `--part-size` | parameter (metagross); 48m preferred (oracle) | **48m** |
| DuckDB-WASM client | lazy-loaded eh bundle | plus `{ allowFullHTTPReads: true, forceFullHTTPReads: false, reliableHeadRequests: false }` and the WASM served Brotli pre-compressed (`Content-Encoding: br`) |
| Fallback trigger | 4 s timeout or non-200 (metagross) | error, non-200 or > 4 s (D-2) |
| CAR artifacts | oracle risk 1 | additive `carCid` on `car` artifacts approved (D-5, AM-05) |
| Kit runtime | oracle risk 2 | adapter module driven directly; Restate wiring A-05/A-06 (D-5) |
| Deploy order, query log | metagross § 2, § 6 | approved: Data → Api → Web → Ops → Cert; query log = HTTP API access log 30 days (AM-02, AM-03) |
| Filebase plan | — | Free for A-03; Pro decided at A-11 |
