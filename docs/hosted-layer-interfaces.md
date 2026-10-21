# Hosted layer: fixed interface points (T7 + T8, T9)

Written by the foundation step so the data/API, CDK and explorer work can proceed in parallel. Changing any item here
is a coordinated change. Contract: `docs/api-contract.md` v1 and `packages/contract/openapi.json`. Layout rationale:
`docs/decisions.md` section 21 (deviation recorded by the coordinator: npm workspaces + Turborepo, not pnpm, because the root
`package-lock.json` pins `@elephant-xyz/cli` 1.58.1 at commit `44bb182` and must not be re-resolved).

## Workspace

| Path | Package | Role |
| --- | --- | --- |
| `packages/tsconfig` | `@travis/tsconfig` | `base.json` (strict, `noUncheckedIndexedAccess`, composite, declarations only) |
| `packages/contract` | `@travis/contract` | Zod schemas, `ENDPOINTS` route table, `TOOLS` registry, `openapi.json`, `mcp-tools.json`, `OPENAPI_JSON`, `coerceQuery` |
| `packages/query` | `@travis/query` | `schema.sql`, `post_load.sql`, `SCHEMA.md`, one SQL implementation per operation (data agent) |
| `packages/deploy-build` | `@travis/deploy-build` | Verifies inputs, builds `travis.duckdb` and the fixture DB (data agent) |
| `packages/api-client` | `@travis/api-client` | Typed fetch client for the explorer, built on `@travis/contract` |
| `apps/api` | `@travis/api` | Lambda handlers; `apps/api/cdk` is the CDK app (`@travis/api-cdk`) |
| `apps/explorer` | `@travis/explorer` | React + Vite + DuckDB-WASM |

Root scripts (turbo): `npm run build | test | lint | typecheck`, `npm run format:check`. Per package: `npm test -w @travis/<name>`.
`packages/*` export TypeScript source (`exports: ./src/index.ts`); esbuild and Vite bundle it, `tsc -b` type-checks with project references.
Add a cross-package dependency in both `package.json` and the package's `tsconfig.json` `references`.
Versions: DuckDB 1.5.6, `@duckdb/node-api` 1.5.6-r.1, `@duckdb/duckdb-wasm` 1.33.1-dev65.0 (reports DuckDB v1.5.6; the 1.32.0 release is v1.4.3).
`@duckdb/node-api` is hoisted to the root `node_modules`; its native binding for the Lambda (linux-arm64) is installed in the image build, not here.

## Handlers

- `apps/api/src/handlers/api.ts`: `export const handler` for the REST `$default` route, `GET /v1/permits/text-search` and `POST /v1/mcp`. Route table: `ENDPOINTS` from `@travis/contract`; parameters: `coerceQuery` then the endpoint's schema; MCP: `TOOLS` / `mcpToolListing()`.
- `apps/api/src/handlers/chat.ts`: `export const handler` for `POST /v1/agent/chat` (the only function with Bedrock); the agent itself is `apps/api/src/chat/` (see "T9 chat route"). Both handlers open the query layer through `apps/api/src/db.ts`.
- Bundled by `npm run build -w @travis/api` (esbuild) to `apps/api/dist/api.mjs` and `apps/api/dist/chat.mjs` (3.7 MB: the AI SDK, its Bedrock provider and `langsmith` are bundled). `@duckdb/node-api` and `@duckdb/node-bindings` stay external (installed in the image); `@aws-sdk/client-ssm` and `@aws-sdk/client-secrets-manager` too (the Lambda base image ships them; loaded with `createRequire`).
- `GET /v1/openapi.json` returns `OPENAPI_JSON` unchanged. Responses carry `x-request-id` = `requestContext.requestId`; CORS is API Gateway's, never the handler's.
- Throttle numbers for `/v1/meta.limits` come from the CDK config via env `LIMITS_JSON` (`{stage, routes, mcp, chat}`).

## DuckDB file

- deploy-build writes `<repo>/data/deploy/<deploy_id>/travis.duckdb` and `deploy.json`, then points the symlink `<repo>/data/deploy/current` at that directory. `data/` is gitignored.
- The functions read the file's serving set (decisions.md section 30), written by `deploy-build serving` to `data/deploy/<deploy_id>/serving/` and recorded in `deploy.json`'s `serving` block: six Parquet files uploaded to the private deploy bucket under `serving/<deploy_id>/`, and `serving.duckdb` (the small tables, `permit_text` with its text index, `permit_text_filters`, `serving_files`), which the image carries at `/opt/db/serving.duckdb` with `deploy.json`. Env `DUCKDB_PATH` overrides; without `SERVING_BASE` the path is opened in full-file mode (tests, SAM local with the fixture). `fts` and `httpfs` ship bundled (`extension_directory` set, autoinstall off); `memory_limit`, `threads`, `temp_directory=/tmp` set explicitly.
- Schema: `packages/query/schema.sql` then `post_load.sql`, documented column by column in `packages/query/SCHEMA.md`. Readers must use only documented columns.
- `deploy.json`: `{deploy_id, inputs_sha256, deployed_at, server_commit, duckdb_version, duckdb_sha256, run_id, manifest_cid, bytes}`.

## Fixture DB

`packages/query/fixtures/travis-fixture.duckdb`, built by deploy-build from a small real subset (the data agent creates it, committed or git-lfs-free as small as possible).
Tests that need it use `describe.skipIf(!fixtureExists())` from `@travis/query` and print `FIXTURE_SKIP_MESSAGE` until it exists. CI runs `cdk synth --strict` against it.

## Mirror and manifest

- S3 keys `tables/<tables_cid>/<relative path>` (e.g. `tables/baguqeera…/address/part-00000.parquet`), served same-origin by CloudFront under `/tables/*`. `<tables_cid>` and the paths are in `group_roots` and `mirror_objects`; each object is immutable and uploaded with the manifest's SHA-256 as its S3 checksum.
- The sharded run has 89 + 88 tables roots, so `/v1/meta.groups` is keyed `<group>/<shard>` (177 entries of `{cid, schema, tables}`).
- Manifest of record: `publish/20261018T143520Z-t5-full/manifest.json`; run records: `runs/*.json` (the served run is `20261018T143520Z-t5-full`; the manifest CID comes from `runs/20261018T143520Z-t5-full.publication.json`). Both are loaded into the DuckDB (`runs`, `manifests`).

## Deployment surfaces

`TravisApi` (both functions from one arm64 container image with the serving file baked in, the HTTP API, alarms, the deploy bucket holding the serving Parquet files) and `TravisWeb` (CloudFront, explorer and mirror buckets), each pinned to `us-east-2`, fixed construct IDs.
Order: deploy-build, `just deploy-api` (serving export and upload, then `cdk deploy TravisApi`), explorer build with `VITE_API_URL` (the HTTP API `$default` URL), `cdk deploy TravisWeb`, then the T7 and T8 checks. Deploys are run by the operator, never from CI.

## Function environment (set by the CDK stack, read by the handlers)

| Variable | Function | Value |
| --- | --- | --- |
| `DUCKDB_PATH` | both | `/opt/db/serving.duckdb` |
| `SERVING_BASE` | both | `s3://<deploy bucket>/serving`; the Parquet files are read at `<base>/<deploy_id>/<file>` with the role's credentials |
| `DUCKDB_EXTENSION_DIR` | both | `/opt/duckdb_extensions` (bundled `fts` and `httpfs`, autoinstall and autoload off) |
| `DUCKDB_MEMORY_LIMIT`, `DUCKDB_THREADS` | both | from the CDK config, sized from the T7 measurements |
| `LIMITS_JSON` | both | `{stage, routes, mcp, chat}` from the CDK config, served in `/v1/meta.limits` |
| `POWERTOOLS_SERVICE_NAME` | both | `travis-api` / `staraptor-agent` (decisions.md section 32) |
| `POWERTOOLS_METRICS_NAMESPACE` | both | `TravisPropertyIntelligence` / `staraptor-agent` |
| `API_FLAG_PARAM` | api | SSM parameter name of the API's budget kill switch (`/travis/api/budget-exhausted`, value `true`/`false`; decisions.md section 34) |
| `CHAT_FLAG_PARAM` | chat | SSM parameter name of the budget kill switch (`/travis/chat/budget-exhausted`, value `true`/`false`) |
| `BEDROCK_MODEL_ID` | chat | the inference profile, `bedrockModelId` in the CDK config (default `us.anthropic.claude-sonnet-4-6`) |
| `LANGSMITH_API_KEY_SECRET_ID` | chat | `staraptor-agent/langsmith-api-key`: the Secrets Manager secret read at init (the key is never in the environment) |
| `LANGSMITH_PROJECT`, `LANGSMITH_TRACING` | chat | `staraptor-agent`, `true` |

The image's `CMD` selects the handler: `api.handler` or `chat.handler`. Both accept `{"warm": {"hold_ms": 1500}}` from `just warm` (decisions.md sections 31 and 32): it opens and, once per instance, primes the instance, and answers `{warmed, primed_now}`. The chat warm-up runs the README turns' tool calls (`AGENT_PRIME` in `apps/api/src/warm.ts`) and never calls the model; a chat request the contract rejects (`400`/`413`) primes the instance the same way before it answers, which is how the explorer prewarms.

## T9 chat route

`POST /v1/agent/chat` (api-contract.md; decisions.md sections 20, 21 and 32):

| Module (`apps/api/src/chat/`) | Role |
| --- | --- |
| `request.ts` | 20 messages, 4,000 characters each, 16,000 in total (`413 request_too_large`), roles, last message `user`, `session_id` (`400 invalid_params`) |
| `tools.ts` | the registry's agent tools (`TOOLS` with `agent: true`), the query layer in-process, `limit` 20 (max 50), one log line per call |
| `guard.ts` | the search-center rule: `lat`/`lon` only from this turn's `resolve_search_center` (exact matches) or numbers the user typed |
| `projection.ts`, `sanitize.ts` | what the model sees: ids, CIDs, signals, `source.url`; free text sanitized and capped at 1,000 characters; personal fields only for ownership or contact questions |
| `prompt.ts` | the system prompt with the per-deploy run summary, `PROMPT_VERSION`, the `OUTCOME:`/`ASSUMPTION:` header parser |
| `bedrock-prompt-cache.ts`, `model.ts` | the kit's prompt-caching middleware around the Bedrock (Converse) model |
| `governor.ts` | the 25 s deadline from `requestContext.timeEpoch`, step timeouts from what remains, one retry, the output budget across steps, the circuit breaker |
| `evidence.ts`, `citations.ts` | `evidence[]` from tool results, the fail-closed citation check, the typed limitations and server assumptions |
| `langsmith.ts` | the kit's tracing facade (secret read at run time, `flush()`, person fields hidden) |
| `turn.ts` | one turn: the AI SDK `ToolLoopAgent` (`stopWhen` 6 steps) and the response |

Answers: `200` with the contract's response (outcomes `answered`, `no_matches`, `needs_clarification`, `out_of_scope`,
`out_of_county`, `limit_reached` at the deadline, `tool_error` when the citation check fails or `answered` lacks a successful
tool call); `503 agent_unavailable` with `budget_exhausted` (the SSM flag), `circuit_open` or `model_unavailable` (Bedrock
access denied). Per turn one EMF document in the `staraptor-agent` namespace (`ChatTurns`, `ChatSteps`, `ChatToolCalls`,
token counts, `ChatTurnLatency`, `ChatDeadlineHits`, `ChatCitationFailures`, `BedrockThrottles`, `BedrockDenials`,
`ChatOutcome` by outcome) and one `chat turn` log line (ids, counts, hashes and timings).

Local and SAM: `apps/api/scripts/chat-local.ts` runs the exported handler in Node with API Gateway v2 events against
`data/deploy/current/serving/serving.duckdb` and the deploy bucket's Parquet tables (the shell's AWS session);
`apps/api/scripts/golden.ts` replays the golden set locally or against a base URL; `just sam-local` builds the image from
`cdk.out` (`cdk synth -c sam-local=1`, `sam build --use-buildkit`) and runs the events in `apps/api/sam/events/`.
