# Contract: `RunManifestV1` and `RunsIndexV1` (`packages/contract`)

- **`RunManifestV1`** (`schema: "oracle-travis-run-manifest.v1"`):
  - Fields: `runId`, `county`, `state`, `fips`, `startedAt`, `finishedAt`, `previousManifestCid` (CIDv1 or null), `sources[] {name, url, watermark, captured_at, records, added, changed, removed, limitations[]}`, `artifacts[] {name, cid, codec, size, sha256, kind: car|table|directory, carCid?}`, `profiles[] {name, version, sha256, path, gitCommit}`, `coverage` (each count with `derivation` ∈ `published_rows|capture_receipt|aggregate_match`), `limitations[]`.
  - Refinements reject: a non-CIDv1 value, any gateway URL, and a `directory` without `carCid`.
  - There is no IPNS field.
- **`RunsIndexV1`:** `runs[] {runId, manifestCid, finishedAt}`, ordered by `finishedAt`. The pilot is **never** listed.
- **`Provenance`:** see [data-model.md](../data-model.md).
- **Pilot instance:** `contract/v1/pilot-manifest.json` (exact JCS bytes). `manifest_cid` = the raw-leaves CIDv1 of those bytes.
