---
id: DATA-MODEL-A-03
type: data-model
parent: PLAN-A-03
---

# Data model: A-03 (Phase 1)

The public schemas are frozen in `contract/v1` (`packages/contract`) and are used unchanged. This file lists the entities A-03 touches, the fields it relies on, and the validation and state rules it adds. Additive items are marked **(new, internal)** or **(additive, AM-05)**.

## Public (contract/v1)

### RunManifestV1 (`oracle-travis-run-manifest.v1`)
- `runId` `^[a-z0-9][a-z0-9-]*$`, no "pilot"; `county`, `state`, `fips`; `startedAt`, `finishedAt` (UTC ISO).
- `previousManifestCid`: `null` for this first run (view shows `first_run`).
- `sources[]` (order is display order, strict): `{ name, url, watermark, captured_at, records, added, changed, removed, limitations[] }`. A-03: `austin-3syk-w9eu` first, `tcad-2026-certified-json` second. Fixed limitation notes (FR-001): `sources[0].limitations` ∋ `Comptroller baseline not loaded (A-07)` (A5); `sources[1].limitations` ∋ `Confidential owner records redacted (Texas Tax Code §25.025): {n}` with `n` = the run summary's `owners_redacted` (P0-15, redaction before `validate`).
- `artifacts[]`: `{ name, cid, codec, size, sha256, kind: "car" | "table" | "directory", carCid? }`. Refinements: CIDv1 only; no gateway URLs; `directory` requires `carCid`. **(additive, AM-05)** `car` artifacts also carry `carCid` = raw-leaves file CID of the `.car` bytes.
- `coverage`: `permits_emitted {count, derivation: "published_rows"}`, `permits_no_tcad_geoid {count, derivation: "aggregate_match"}`, profile exclusions (`trade_permit`) as counts; no Query DB rows. `derivation` ∈ `published_rows | capture_receipt | aggregate_match` (AD-28); the UI shows each count with `DERIVATION_LABELS[derivation]` as visible helper text (FR-009).
- `profiles[]`: `travis-austin@1.0.0` with DIGEST.
- Stored as exact JCS bytes; its CID = `cidOfBytes(bytes)` (raw codec, CIDv1).

### RunsIndexV1
- `runs[] {runId, manifestCid, finishedAt}` ordered by `finishedAt`; JCS bytes; committed in `runs/index.json`; copied to `apps/web/public/runs/index.json` at build.
- **Append-only** (FR-001; ARD § 11): `appendRun(index, entry)` keeps every existing entry byte-identical, rejects a duplicate `runId` or a changed `manifestCid`, and only adds. Withdrawing a run is a git revert of the index commit decided by the PO and listed in the PR, never a pipeline write (T083).
- Read by the web app: missing / non-JSON / schema mismatch → `RUN_INDEX_TEXTS.unreadable`; `runs: []` → `RUN_INDEX_TEXTS.empty` (FR-002, TC-014).

### v_roofing_permit row (view over the CLI tables)
- Shown columns: `permit_number`, `improvement_status`, `status_class` (open / stalled / closed), `issue_date`, `contractor_resolution`, provenance `{source_url, captured_at, table, table_cid, run_id, manifest_cid}`, `missing: {field, reason}[]`.
- Reason ∈ the closed list of 21 (`columns.json` `missingReasons`).

### v_run row
- `run_id`, `started_at`, `finished_at`, sources, coverage counts, `manifest_cid`.

## UI mappings (packages/shared)

| Map | Key | Rule |
| --- | --- | --- |
| `MISSING_REASON_LABELS` | each of the 21 reasons | `Record<MissingReason,string>` (tsc fails on a missing key); Vitest walks `MISSING_REASONS` (FR-011). |
| `missingLabel(field, reason)` | (field, reason) | Contractor fields with `source_missing` → "Contractor not printed on permit"; else the table label (D-2). |
| `SOURCE_LABELS` | source `name` | `austin-3syk-w9eu` → "City of Austin Issued Construction Permits (3syk-w9eu)"; `tcad-2026-certified-json` → "TCAD 2026 certified export"; test fails on an unmapped manifest source. |
| `COVERAGE_LABELS` | `permits_no_tcad_geoid`, `permits_emitted` | "No TCAD id on source record"; "Permits published" (T081). |
| `DERIVATION_LABELS` | `published_rows`, `capture_receipt`, `aggregate_match` | The three plan § "Fixed texts" strings; `Record<Derivation,string>` (AD-28; T081). |
| `PUBLICATION_STATE_TEXT`, `RUN_INDEX_TEXTS`, `PERMITS_TEXTS`, `PROGRESS_LABELS` | fixed UI texts | Verbatim from plan § "Fixed texts and config keys" (T081); the only source of these strings in `apps/web`. |

## Internal (never public)

### CaptureReceipt (oracle-runtime)
`{ url, multiValueQueryString, status, bytes, sha256, captured_at, outcome: "ok" | "blocked" | "error", ua, attempts }`. The first 403 or bot challenge → `blocked` (`attempts` = 1, no retry), the run stops with exit 2, no further request, `ua` identical on every receipt (FR-014, TC-006). The run summary adds `owners_redacted` (TCAD confidentiality redactions applied before `validate`; T082).

### PermitStatus (oracle-runtime, `status/<safePermitName>.json`)
State: `pending → captured → classified(accepted | excluded:trade_permit) → emitted | not_emitted:no_tcad_id`. Idempotent: a `captured` key is skipped on re-run.

### SequenceStep **(new, internal)** (`reports/sequence.json`)
`{ group, step: "validate" | "hash" | "validate-car" | "export-tables" | "upload-car" | "upload-tables", argv (no secrets), exitCode, outputs[{path, sha256}] }`. Order invariant: 2×4 build steps, then (after D-8) 2×2 uploads; any non-zero exit stops all later steps; no skip flag exists.

### ReadbackResult **(new, internal)**
`{ group, rootMatches, partCount, parts[{cid, size, sha256, ok}] }`. Any `ok=false` → no manifest.

### CidCopyObject **(new, internal)**
S3 key `ipfs/<cid>`; metadata `{cid, sha256}`; `ChecksumSHA256`; `Cache-Control: public, max-age=31536000, immutable`; Content-Type by kind. States: `absent → written(verified)`; `exists-same → skipped`; `exists-different → error` (never overwritten).

### VerifyResult **(new, internal)**
Per artifact × gateway (`gateway.pinata.cloud`, `ipfs.filebase.io`): `{ name, cid (or carCid), gateway, status, size, sha256, ok }`. `ALL ARTIFACTS VERIFIED` iff all `ok` on both gateways.

### FetchByCid state (web)
`copy(pending) → ok` | `copy(error | non-200 | no first byte within 4 s) → fallback(pending) → ok(label "fallback · {host}")` | `fallback(error, incl. 429) → error banner (both-hosts-down text)`. The host that served the manifest is the host `partUrl` binds for the table parts (no mixed reads in one load); a part failure after binding → `error`.

### Runs page state (web)
`loading(progress "Loading run") → ready(card)` | `error(index unreadable | index empty | both hosts down)`. Texts from `RUN_INDEX_TEXTS` and the both-hosts-down text (FR-002, TC-014).

### Permits page state (web)
`loading(stage text, progress "Loading permits", skeletons in role="status" aria-busy) → ready(table ≥ 600 px | cards < 600 px)` | `empty` | `error`. The table / cards render only in `ready` (FR-008). `empty` only when `coverage.permits_emitted.count` = 0 and 0 rows (`PERMITS_TEXTS.empty`); any other row count ≠ `coverage.permits_emitted.count` → `error` with `PERMITS_TEXTS.countMismatch(rows, count)` (FR-009); engine init failure → `error` with `PERMITS_TEXTS.engineFailure`. Atlas form per plan § "Atlas element map".

### BenchEvent / BenchResult **(new, internal)**
Event `{kind: "bench", query: "count" | "radius" | "roofAge", preset: "TC_NF_05" | "ADR_0001", prefix: "private/bench/<name>/"}`; result `{query, rows, queryDurationMs, initMs, coldStart}`.
