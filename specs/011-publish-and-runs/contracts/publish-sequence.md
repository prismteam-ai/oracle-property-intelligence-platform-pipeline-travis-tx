# Contract: the fixed six-step publication sequence (per data group)

Source of truth: kit `use-oracle/reference/car-publication.md`; this file restates it for A-11's full-county, 5-group scale. No step is ever skipped (P0-2); a test asserts the order.

```text
1. validate {dir}
2. hash {dir} --output-zip … --output-csv … --output-car {county}-{group}.car
3. validate {car}
4. export-tables {car} --output … --part-size 48m --output-json …-tables-export.json --atlas-page … --county travis --state TX --fips 48453
5. upload {car} --api {pin-endpoint}
6. upload {tables-dir} --api {pin-endpoint}
```

- Steps 5 and 6 run once per durable copy: Filebase (`https://rpc.filebase.io`) and Pinata (Kubo-RPC endpoint), plus the CAR is separately attached to a GitHub Release (AD-22, three copies total).
- `validate {car}` (step 3) is the "6/6 CAR checks" of NFR-001: integrity, root, index, graph, lexicon, orphans.
- Upload (steps 5-6) succeeds only when the pinning node reports the same root **and** a gateway serves bytes that hash to the CID (readback). A readback failure stops the run before the manifest is written — this is the automated gate that replaces the interactive D-8 approval for the scheduled/Fargate path (research.md).
- `{group}` ranges over the 5 full-county groups: `county`, `property_improvement`, `owner`, `contractor`, `parcels`.

## Manifest contract

`RunManifestV1` (`packages/contract`) — see `data-model.md` for the full shape. No gateway URL is ever stored (P0-3); CIDv1 base32 only (`^b[a-z2-7]{50,}$`).

## verify-manifest contract

```text
npx tsx scripts/verify-manifest.ts runs/{runId}/manifest.json
```

- Fetches every file artifact from two independent public gateways (`https://ipfs.io`, `https://dweb.link` — never Filebase, Pinata, or the S3 CID copy, per P0-14).
- Retries 429/504/timeout with backoff (`TIMEOUT_MS` default 300,000, 5 attempts), honours `Retry-After`.
- Exits 0 and prints `ALL ARTIFACTS VERIFIED` only if every artifact matches size and SHA-256 on **both** gateways. Any miss → marks that artifact `unverified`, exits non-zero.
- Artifacts over 50 MB are verified by streaming the hash (NFR-06), not loaded whole.

## Fargate batch-task entrypoint contract (new, for G-SCHED/G-RUN)

| Input | Source | Notes |
| --- | --- | --- |
| DB credentials | ECS `Secret` → Secrets Manager ARN | Operator-chosen private Postgres, never the Query DB, never a plaintext string (AD-26) |
| Destination bucket/CloudFront names | CloudFormation cross-stack ref from DataStack | Same pattern as ApiStack today |
| Pinning credentials | ECS `Secret` → Secrets Manager ARN | Filebase + Pinata, same two services as the interactive path |
| Watermark / run state | Read from Postgres at task start | Never local-disk-only (Fargate tasks are ephemeral) |

Call shape: one non-interactive `publishRun`-equivalent function, no human approval step — gated instead by the six-step sequence's own readback checks (see above). This function does not exist yet in the current CLI (`cli.ts` is interactive/approval-gated by design, per CR-A-03 F-4) and is a new G-RUN task, not a reuse of existing exported code.
