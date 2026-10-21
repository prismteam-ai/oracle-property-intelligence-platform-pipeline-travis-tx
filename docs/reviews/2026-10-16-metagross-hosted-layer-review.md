# Metagross hosted-layer review, 2026-10-16

Read-only review by the kit's `metagross` agent of T7 (hosted query layer), T8 (explorer) and the hosting of T9's
chat, the last of the four pre-freeze reviews. No edits, AWS, network or MCP calls. Line numbers refer to commit
`6b5531d`; kit at `99c7bff`. Kit files read in full: `agents/metagross.md`, `build-frontend-backends` (SKILL.md and 5
rules), `apply-engineering-guidelines` (SKILL.md and 10 rules), `integrate-ci-cd/SKILL.md`, `guide-product-work/SKILL.md`
with `reference/aws-inspection.md` and `reference/shared-api-domain.md`, `build-product-deployer/reference/stack-identity.md`,
`build-ai-agents/rules/delivery-tools-deploy-and-test.md`.

**Status:** every finding applied the same day: `docs/decisions.md` section 21 (with pointers in sections 2, 7, 8, 12
and 20) and the dated entry in `docs/api-contract.md`'s change control. **The contract is frozen** with these changes.

**Totals:** 8 violations, 19 acceptable if recorded, 2 fine, 1 flag on a settled scope.

## Findings

| # | Issue | Verdict | Doc (6b5531d) | Kit | Applied as |
| --- | --- | --- | --- | --- | --- |
| 1 | Layout for API, explorer, CDK and shared code unstated; root uses npm without workspaces | violation | decisions.md:311-352, :356 | metagross.md:16; build-frontend-backends/SKILL.md:17-18, :97-146, :152; monorepo-turborepo.md:9, :32-38 | §21 Layout |
| 2 | REST + OpenAPI + MCP replace tRPC, unrecorded | acceptable if recorded | api-contract.md:13-21; decisions.md:317-320 | metagross.md:13; build-frontend-backends/SKILL.md:19; trpc-backend.md:9; shared-packages.md:9, :17 | §21 exceptions |
| 3 | "One CDK stack" makes explorer and API one surface; stack names, env and tags unstated | violation | decisions.md:311, :313, :341, :344 | metagross.md:15; cdk-api-infrastructure.md:52-56, :155; cloud-aws-primary.md:23; stack-identity.md:11-22 | §21 Stacks |
| 4 | S3 + CloudFront instead of Amplify, unrecorded | acceptable if recorded | decisions.md:313, :344 | amplify-frontend.md:9-13; build-frontend-backends/SKILL.md:42, :76-85 | §21 exceptions |
| 5 | No custom domain; `API_BASE` stability across redeploys unstated | acceptable if recorded | api-contract.md:16-17; decisions.md:508-509 | cdk-api-infrastructure.md:9-25, :160-168; shared-api-domain.md:3-7 | §21 exceptions |
| 6 | The 2 GB DuckDB file downloaded on every cold start breaks the 10 s init window and the 25 s / 30 s budgets | violation | decisions.md:243-247, :643-644; api-contract.md:212-213 | stack-typescript-for-apis.md:13; external-dependency-boundaries.md:19-22 | §21 DuckDB in Lambda (baked into the image) |
| 7 | DuckDB native binary packaging, architecture, version and extensions unstated | acceptable if recorded | decisions.md:317, :612 | cdk-api-infrastructure.md:59-76, :157; stack-typescript-for-apis.md:13 | §21 DuckDB in Lambda |
| 8 | HTTP API supports stage and per-route throttles and caps integrations at 30 s; the kit template's single proxy route cannot carry them | fine | api-contract.md:22-24; decisions.md:319-320 | cdk-api-infrastructure.md:79-98 | §21 four routes |
| 9 | Gateway-generated responses carry neither `x-request-id` nor the contract's bodies; CORS exposes no headers | violation | api-contract.md:15, :25-26, :35-41; decisions.md:663 | cdk-api-infrastructure.md:81-85 | contract items 1-2; §21 Routes |
| 10 | Two-function split unsized; account concurrency and Bedrock quotas unchecked | acceptable if recorded | decisions.md:319-320, :641-647, :664-665; api-contract.md:22-24, :29-32 | external-dependency-boundaries.md:19-22, :28-29 | §21 Concurrency (operator quota reads) |
| 11 | CloudFront settings for DuckDB-WASM and the single-page app unstated | acceptable if recorded | decisions.md:313-316, :351-352 | none | §21 CloudFront |
| 12 | Mirror integrity and cache invalidation | fine | decisions.md:278, :313-316 | none | §21 Mirror |
| 13 | The DuckDB file beside the mirror would be downloadable through CloudFront, exposing captured owner and contact fields | violation | decisions.md:243-245, :603-604; api-contract.md:298, :304 | contradicts decisions.md:603-604 | §21 Private data stays private |
| 14 | Deploy-time build unspecified | acceptable if recorded | decisions.md:151-155, :213-216, :239-242, :268, :601-608 | metagross.md:16; guide-product-work/SKILL.md:99-105 | §21 Deploy-time build |
| 15 | "`/v1/openapi.json` identical to this file" has no machine-readable source | violation | api-contract.md:16-17, :249-251, :410; decisions.md:71-72 | guide-product-work/SKILL.md:99-101; shared-packages.md:9-21; trpc-backend.md:110-112 | contract item 5; §21 OpenAPI |
| 16 | `PropertyDetail.permits` unbounded against Lambda's 6 MB limit; sorts on non-unique keys; cursor validity undefined | violation | api-contract.md:155-158, :163-165, :169-174, :189-190, :258, :292 | none | contract items 6-9 |
| 17 | MCP headers and `GET`/`DELETE` behaviour unstated | acceptable if recorded | api-contract.md:18-21, :115 | none | contract item 4 |
| 18 | The kit's LangSmith sample writes the key into the template; secrets and their cost not listed | acceptable if recorded | decisions.md:341, :356-357, :377-378, :659-660 | observability-langsmith-telemetry.md:17, :22, :152-156; delivery-tools-deploy-and-test.md:80-82 | §21 Secrets and IAM |
| 19 | IAM beyond the Bedrock grant unstated | acceptable if recorded | decisions.md:326-328, :641-643 | observability-pagerduty-alerting.md:39; delivery-tools-deploy-and-test.md:106-109, :174-177 | §21 Secrets and IAM |
| 20 | "Alarm action disables chat" has no mechanism | acceptable if recorded | decisions.md:647-648; api-contract.md:37 | observability-dlq-alarms.md:51-58 | §21 Kill switch |
| 21 | Log retention 30 days against the kit's 90; gateway failures invisible; metrics undefined; registry unreachable | acceptable if recorded | decisions.md:341, :636, :661-663 | observability-logging-tracing.md:19, :27, :32-33; observability-metrics.md:11-46 | §21 Observability (90 days adopted) |
| 22 | PagerDuty only "if it can be wired" | violation | decisions.md:337-339, :663 | apply-engineering-guidelines/SKILL.md:105; observability-pagerduty-alerting.md:9-12, :47-52 | §21 PagerDuty wired at T7 |
| 23 | CI unspecified; the kit's shared workflows unavailable | acceptable if recorded | decisions.md:356 | integrate-ci-cd/SKILL.md:12-31, :233-234; testing-strategy.md:26-30 | §21 CI |
| 24 | Environments and configuration unstated | acceptable if recorded | decisions.md:311 | integrate-ci-cd/SKILL.md:16-19; cdk-api-infrastructure.md:13-25; stack-identity.md:11-15 | §21 exceptions and Stacks |
| 25 | Cost table omits standing lines and mislabels some per-request costs | acceptable if recorded | decisions.md:294-295, :370-372, :659-660, :678-679 | cloud-aws-primary.md:21-23 | §21 Cost table; §12 pointer |
| 26 | No teardown plan or stated lifetime of the hosted URLs | acceptable if recorded | decisions.md:366-367 | slowking.md:29; evaluate-candidate-intent/SKILL.md:89 | §21 Teardown and lifetime |
| 27 | Verify action unspecified (codecs, CAR digests, gateway CORS, redirects, size) | acceptable if recorded | decisions.md:282-289, :295-297, :346-348 | none | §21 Verify action |
| 28 | §8 still describes one Lambda, `/mcp`, a 30 s timeout and two retries | acceptable if recorded | decisions.md:317-318, :326, :335-336 | none | pointers in §8 |
| 29 | Flag: the manifest "lists itself"; a directory entry's digest undefined | flag | decisions.md:282-284; api-contract.md:205 | none | contract manifest text; §7 pointer |
| 30 | T7-T9 acceptance checks miss the hosted-layer risks | acceptable if recorded | decisions.md:70-77; progress.md:17-19 | guide-product-work/SKILL.md:99-113; aws-inspection.md:28-30 | §2 T7 and T8 checks |

## Contract changes before the freeze

All twelve applied. [B] breaking, [A] additive.

| # | Change | Tag |
| --- | --- | --- |
| 1 | `x-request-id` equals API Gateway's request id; gateway-generated responses carry only `apigw-requestid` and the gateway's `{message}` body | B |
| 2 | CORS: allowed `content-type`, `mcp-protocol-version`; exposed `x-request-id`, `apigw-requestid`; `GET`, `POST`, `OPTIONS`; no credentials | A |
| 3 | Throttle numbers move to `/v1/meta.limits`; the 429-and-back-off rule is frozen | B |
| 4 | MCP revision `2025-06-18`, request headers, behaviour without the header, `405` for `GET`/`DELETE`, no session id | B |
| 5 | The committed `openapi.json`, generated from Zod and served byte-identical, is normative | B |
| 6 | `PropertyDetail.permits` and `get_property` capped (50 REST, 20 MCP) with `permits_total` and `permits_truncated` | B |
| 7 | `property_id` param on permit search | A |
| 8 | Sorts end on `property_id` and `permit_id` | B |
| 9 | Opaque cursors tied to `deploy_id` and the day; `400 stale_cursor` | B |
| 10 | `/v1/meta.deploy` gains `deploy_id`, `inputs_sha256`, `server_commit`, `duckdb_version` | A |
| 11 | `contractor_attribution_key` stable across deploys, recipe versioned | B |
| 12 | `request_id` in `400`, `404`, `413` bodies and MCP `isError` results | A |

## README vs kit conflicts

| # | README | Kit | How both are satisfied |
| --- | --- | --- | --- |
| 1 | :5, :113, :116 the CRM is another repo consuming an MCP-compatible structure | tRPC with type sharing in one monorepo | REST, OpenAPI and MCP generated from one Zod package; tRPC recorded as an exception |
| 2 | :7, :48, :84 no ongoing cost | DEV/PROD deploys, per-account domains, Amplify | one account, PR CI as the dev gate, operator-run deploys, execute-api and CloudFront URLs, every standing line priced |
| 3 | :7, :48 no ongoing cost | PagerDuty, 90-day logs, Secrets Manager | PagerDuty Free costs nothing, id-only logs cost cents, the one secret is priced |
| 4 | :96 querying "without Oracle-hosted database infrastructure" | a Lambda backend | the functions query an embedded file with no database server; the DuckDB-WASM box queries the Parquet with no Oracle compute |
| 5 | :7, :48 no ongoing cost | a persistent hosted runtime for evaluation (slowking) | stacks stay up at near-zero cost through the evaluation, then `cdk destroy`; the README packet survives |
