---
id: DM-A-01
parent: PLAN-A-01
---

# Data model: A-01 Discover Travis County sources

All entities are internal (catalog file, receipts, run record). Nothing here is published. Exact keys are in [contracts/catalog.md](contracts/catalog.md) and [contracts/capture-receipt.md](contracts/capture-receipt.md).

## Measurement

Every number in the catalog is a Measurement, never a bare value (FR-007a).

| Field | Rule |
| --- | --- |
| `value` | number, or `null` with `missing_reason` |
| `missing_reason` | required when `value` is `null` (for example "TCAD blocked: HTTP 403 at 2026-10-19T09:12Z") |
| `source_url` | required; the exact query or file URL |
| `captured_at` | required; UTC ISO-8601 |
| `method` / `query` | how it was measured (`count(*)`, `returnCountOnly`, streaming count) |

## Source (one row per A-oracle § 4 source)

| Field | Rule |
| --- | --- |
| `key` | one of `tcad_certified`, `tcad_supplemental`, `tcad_gis`, `austin_permits`, `other_jurisdictions`, `tx_comptroller`, `bbb`, `overture`, `contractor_licensing` (all 9 required) |
| `status` | `available` or `blocked` |
| `denominator` | Measurement (Comptroller: `travis_coded_rows` is the denominator, plus `statewide_rows`) |
| `throughput` | Throughput, or `download_rate` for single-file sources |
| `anti_bot` | rate limits observed, challenge seen, `app_token_used`; derived from the source's own receipts: "challenge: seen (HTTP n; <signal>)" whenever a receipt carries an explicit challenge signal (`cf-mitigated: challenge`, an interstitial body, or challenge markers on a 403/429/503), otherwise "challenge: none seen" |
| `projected_full_capture_hours` | number; derived (denominator ÷ median rate ÷ 60) |
| `decision` | `bulk download` \| `ingest` \| `runtime retrieval`; required when projected hours > 48, and always present |
| `decision_reason` | required with `decision` |
| `blocked_evidence` | required when `status: blocked` |
| `next_step` | the human's next step. A real block (403, challenge, timeout) names its records request or API application. A reachable source whose 2xx download broke part-way (`failed` with `error`, no automatic retry) names one more attempt with the same identity, `resolve -- <key> captured`, with the bytes received and the advertised length; its records request is kept only as a fallback in `notes`, not as `records_request` |
| `tcad_id_null_count` | `austin_permits` only: Measurement of rows with no `tcad_id` |
| `located_in_other_jurisdictions` | `austin_permits` only: array of `{jurisdiction, value, source_url, captured_at}` for Austin-issued records located elsewhere (from the `jurisdiction` field) |

Overture (`overture`): `denominator.value` is `null` with `missing_reason: "not measured in A-01: optional source; licence gate decided in A-09"` (FR-001b).

## Throughput

`rows_per_minute_median`, `pages_read` (≥ 3), `page_size` (≤ 50,000), `window_start`, `window_end`, `app_token_used`, `rate_limits_observed`.

## Parcel (TCAD roll vs GIS)

`canonical_source` (TCAD 2026 certified roll), `assessed_parcel_count` (Measurement), `roll_year` (2026), `certification_date`, `identifier_name` (as printed in the export, e.g. `pID`), `identifier_layout_name` (the TCAD layout name, e.g. `prop_id`), `identifier_proven`, `identifier_format`, `deed_or_sale_dates_present`, `gis_feature_count` (Measurement), `gap_pct` (number or `unknown` + reason), `discrepancy_threshold_pct: 2.0`, `discrepancy_explanation`, `separately_assessed_without_geometry` (`acknowledged` | `none`, required when GIS is below the roll), `export_receipt` (Capture receipt of the one download).

Implementation note (2026-10-19, Phase 2): the kit validator reads `assessed_parcel_count` and `gis_feature_count` as plain numbers, so they stay `number | null`; their provenance sits in sibling Measurements `assessed_parcel_count_measurement` and `gis_feature_count_measurement`, and the schema requires each plain value to equal its measurement's `value`.

Rules: the roll is always the denominator; a gap above 2% blocks GIS-only seeding; a null GIS count gives `gap_pct: unknown` with a reason, enforced by the checker (oracle risk 3).

## Permit jurisdiction

| Field | Rule |
| --- | --- |
| `jurisdiction`, `key` | name as in the Census list; stable key |
| `spec_class` | `supported` \| `records request` \| `no public history` |
| `status` | validator word derived from `spec_class` + case ([research R3](research.md#r3-spec-classes-vs-validator-statuses)) |
| `historical_records` | boolean, required on every row |
| `portal_kind`, `portal` | `application-intake` for one-stop or intake portals, which never have `historical_records: true` |
| `evidence_url`, `evidence_captured_at` | required |
| `earliest_record_date` | for "supported from {year}" |
| `records_request` | required for `custodian-only`, `manual-only`, `blocked` |
| `issued_by` | required for `delegated` |
| `austin_issued_located_here` | Measurement; informational, never changes the row's own status |

Set rule: the row count equals `census_reference.place_count + 1` (unincorporated), and no row is `needs-review`.

## Records request

`recipient_office`, `system_scope` (system and date range), `route` (`api-first` | `records-first`), and `request_portal_url` or `request_email`. All required to count as complete (validator rule 5).

## Blocked evidence

`http_status`, `timeout_ms` or `error` (at least one): `timeout_ms` only for a real timeout; a network error with no HTTP response records `error` (for example "fetch failed") and no `timeout_ms`; a download that broke part-way records `http_status` plus its stream `error`. Then `captured_at`, `url`, `evidence_path` (committed file with headers and a body excerpt, no secrets), `body_sha256`, `attempts` and `user_agent` (copied from the capture receipt), `outcome` (`blocked` for 403/explicit challenge/timeout; `failed` for 429/5xx after 5 attempts (FR-006e), a network error, a broken download, a 2xx body that fails its expected format without a challenge signal, or another non-2xx status such as 404), `geo_signal` (`none` or the quoted signal; only a quoted signal permits the US check, FR-006b).

## Destination proof

`writes_in_scope: true`, `proven: true`, `independent_identity_sources` (2 entries: Docker-side container ID + image digest; SQL-side system identifier + database + version), `captured_at`. If the proof fails: `proven: false` with `missing_reason` (the validator then blocks the destination gate). No URLs or passwords.

## Census reference

`dataset`, `vintage`, `source_url`, `captured_at`, `place_count`.

## Capture receipt (internal)

`url`, `method`, `status`, `bytes`, `sha256`, `captured_at`, `user_agent`, `attempts`, `outcome` (`ok` | `blocked` | `throttled-then-ok` | `failed`). Downloads also record `resumes` (int 0..5): the HTTP Range resumes made after the stream dropped part-way (FR-003, PO 2026-10-20). A resume is made only when the first 200 advertised `Accept-Ranges: bytes`, a `Content-Length` and no content encoding; it sends `Range: bytes=<received>-` (plus `If-Range` with the strong ETag or Last-Modified) with the same User-Agent and client, and is appended only on a 206 whose `Content-Range` continues from the last byte to the advertised length with an unchanged ETag/Last-Modified. A resumed file is accepted only when its final size equals the advertised length; `sha256` covers the whole file. Receipts written before this change have no `resumes` (read as 0). `Parcel.export_receipt` copies `resumes` when present.

## Discovery run (state machine)

```text
DISCOVERING ──all probes ok──────────────────────────▶ READY (validator exit 0)
     │
     └─any source blocked or failed─▶ WAITING_HUMAN ──human resolves: captured──▶ DISCOVERING (re-probe that source once)
                                  │
                                  └──human resolves: still blocked + records request──▶ WAITING_HUMAN (documented blocker; story judged per FR-006c)
```

A human resolves a waiting source with `npm --prefix pipeline/oracle-runtime run resolve -- <source_key> captured|still-blocked` (FR-006f; [contracts/cli.md](contracts/cli.md)). `captured` re-probes only that source with the same identity and then re-runs the catalog write and the validator; `still-blocked` confirms the records request and leaves the run in `WAITING_HUMAN` as the documented blocker. `READY` never auto-advances to seed (A-04). The catalog's top level records `waiting_human_hours` (hours spent in `WAITING_HUMAN`, `0` when nothing waited) so SC-006 (run ≤ 8 h excluding waits) can be measured. Each probe step is journaled with the idempotency key `source:measurement:captured_date`.
