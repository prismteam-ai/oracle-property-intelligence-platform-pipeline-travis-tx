# Metagross serving-Parquet review, 2026-10-20

Read-only review by the kit's `metagross` agent of the hosting correction that becomes `docs/decisions.md` section 30.
This is the only pass. No edits, deploys, AWS or network calls were made. Read: decisions sections 21 and 29,
`apps/api/cdk/lib/api-stack.ts` and `apps/api/Dockerfile` at `38e8055`, `packages/query/src/service.ts` with its
uncommitted serving mode, `packages/deploy-build/src/serving.ts`, `packages/deploy-build/test/serving-ops.ts` and
`packages/query/.spike/run.ts`.

**Verdict:** this is the right fix. The functions read about 35 MB of sorted Parquet from the private bucket per cold
call. Of the options considered, it is the only one that keeps cold starts inside the budget at the measured 5 MB/s.
It adds no standing cost and keeps the data out of CloudFront. Approved once the two blocking changes to the gate
are made.

The uncommitted code already gets these right:
- the secret is TEMPORARY and scoped to the serving base;
- the Parquet metadata, HTTP metadata and external file caches are on;
- the smoke ops cover text search and the business, license and contractor lookups.

## Findings

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | blocking | The spike's timer starts only after `cold()` returns, and the byte counter is reset at that point. So loading httpfs, creating the secret and creating the views are neither timed nor counted. Creating a view reads its Parquet footer over the network. The spike also runs 2 threads. The 7.3 s figure therefore understates a real cold start. | Time each operation from the start of `Queries.open` to the response, in serving mode with threads 4 and memory_limit 2 GB. Apply the 10 s and 15 s limits to that total. Also time a second, warm call. |
| 2 | blocking | The gate tests nothing S3-specific. The local Range server is plain HTTP with no request signing. These are first exercised on Lambda: TLS (the bucket rejects plain HTTP), the CA bundle that httpfs must find in the Lambda base image, SigV4 signing with a session token, the region, and virtual-host addressing. | Add one gate step. Run the built arm64 image locally through the base image's runtime interface emulator, with exported operator session credentials, against the real `serving/<deploy_id>/` prefix. One getPermit call must return a correct answer. |
| 3 | should | (c) Credentials: the environment-variable credentials never change within an execution environment. In practice Lambda recycles environments before the credentials expire, but AWS does not document that. | When S3 returns 400 or 403, rebuild the secret with `CREATE OR REPLACE` from the current environment and retry once. Keep the secret SQL out of logs. |
| 4 | should | (d) Loading httpfs gives an injected string network access it did not have before, for example `read_csv('https://...?' \|\| owner_name)`. | After creating the views, set `allowed_directories` to the serving prefix plus `/tmp/`, then `enable_external_access=false` and `lock_configuration=true`. Add a test proving that reading any other URL fails. Nothing else in "private data stays private" breaks: the files stay in the private bucket, outside every CloudFront origin. |
| 5 | note | (b) IAM: `s3:GetObject` on `serving/*` covers httpfs's HEAD and ranged GET requests. ListBucket is not needed because files are named exactly, with no globs. KMS is not needed because the bucket uses SSE-S3. Without ListBucket, a missing key returns 403 instead of 404. | Put the file name and deploy_id in the open error. Change section 21's "no S3" template assertion to assert exactly this grant on both roles. |
| 6 | note | The ruling lists roof_age_reference as a Parquet table. `serving.ts` exports business_records instead and bakes every other table into the image. | Write section 30 from the code's four tables. |
| 7 | note | Rolling back the image requires that image's own Parquet set to still exist. | Add no expiry rule on `serving/`. At teardown, `autoDeleteObjects` removes the files. |

## Alternatives (a)

None is clearly better at this scale.

- **EFS** needs a VPC. Chat's Bedrock, SSM and Secrets Manager calls would then need a NAT gateway (about $33 a month)
  or interface endpoints (about $7 a month each, per AZ).
- **Downloading to /tmp at init** means every cold start pulls all 480 MB. At the measured 5 MB/s that takes 96 s,
  far past init's 10 s window.
- **S3 Express One Zone** cuts per-request latency, but the measured cost is bytes read, not request count. It adds a
  directory bucket and a session-based auth that httpfs would first have to be proven to support.
- **Provisioned concurrency** costs about $20 a month per 3 GB arm64 instance. It cannot be set up under the
  10-execution cap, and it does not warm any data.
- **Putting the hot tables in the image** uses the same lazy-load path that dropped to 4 MB/s after the first 100 MB.
  Only the 46 MB file fits inside that fast window.
