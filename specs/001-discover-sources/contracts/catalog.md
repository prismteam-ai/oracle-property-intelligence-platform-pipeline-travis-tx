---
id: CT-A-01-catalog
parent: PLAN-A-01
---

# Contract: `pipeline/docs/travis-sources.yaml`

Internal contract. Input to the kit validator (kit 0.99.1 catalog contract, `use-oracle/reference/readiness-and-completeness.md`) plus A-01 extensions the validator ignores and `check-catalog.ts` enforces. Entity rules are in [data-model.md](../data-model.md).

## Format rules (research R5)

Block style only; no flow maps or lists, anchors or multi-line scalars. Quote FIPS, IDs, dates and any string containing `#` or `:`. No bare `yes`/`no`.

## Shape (abridged; values illustrative of type only)

```yaml
county: "Travis"
state: "TX"
slug: "travis"
fips: "48453"
snapshot_time: "<UTC ISO-8601>"
waiting_human_hours: 0            # A-01 extension: hours spent in WAITING_HUMAN (SC-006)

parcel:                       # validator gate: parcel
  canonical_source: "TCAD 2026 certified roll"
  assessed_parcel_count: <int or null>     # plain number: the validator reads it as such
  assessed_parcel_count_measurement:       # provenance; value must equal assessed_parcel_count
    value: <int or null>
    source_url: "<url>"
    captured_at: "<UTC>"
  roll_year: 2026
  certification_date: "<date>"
  gis_feature_count: <int or null>         # plain number
  gis_feature_count_measurement:           # provenance; value must equal gis_feature_count
    value: <int or null>
    missing_reason: "<text when null>"
    source_url: "<url>"
    captured_at: "<UTC>"
  discrepancy_threshold_pct: 2.0
  discrepancy_explanation: "<text, required when counts differ>"
  separately_assessed_without_geometry: "acknowledged"   # or "none"; required when GIS < roll
  identifier_name: "prop_id"                            # or "geo_id", as printed
  identifier_proven: true
  identifier_format: "<text>"
  deed_or_sale_dates_present: true

permits:                      # validator gate: permits
  expected_jurisdiction_count: <census place_count + 1>
  assumes_unified_countywide_history: false
  jurisdictions:
    - jurisdiction: "<name>"
      key: "<key>"
      spec_class: "supported"            # A-01 extension
      status: "supported"                # validator vocabulary (research R3)
      historical_records: true
      portal_kind: "<kind>"
      portal: "<url>"
      evidence_url: "<url>"
      evidence_captured_at: "<UTC>"
      earliest_record_date: "<date>"
      records_request:                   # when status is custodian-only, manual-only or blocked
        recipient_office: "<office>"
        system_scope: "<system, date range>"
        route: "records-first"           # or "api-first"
        request_portal_url: "<url>"      # or request_email

destination:                  # validator gate: destination
  writes_in_scope: true
  proven: true
  independent_identity_sources:
    - "<docker-side identity>"
    - "<sql-side identity>"

enrichment:
  bbb:
    status: "blocked"
    # evidence; expected_count never equals an advertised listing total

# ---- A-01 extensions (ignored by the validator, enforced by check-catalog.ts) ----
census_reference:
  dataset: "<name>"
  vintage: "<year>"
  source_url: "<url>"
  captured_at: "<UTC>"
  place_count: <int>

sources:
  - key: "austin_permits"
    url: "<url>"
    status: "available"
    denominator:
      value: <int>
      source_url: "<url>"
      captured_at: "<UTC>"
      method: "count(*)"
    throughput:
      rows_per_minute_median: <number>
      pages_read: 3
      page_size: 50000
      window_start: "<UTC>"
      window_end: "<UTC>"
      app_token_used: false
      rate_limits_observed: "<text>"
    anti_bot: "<text>"
    projected_full_capture_hours: <number>
    decision: "ingest"                   # bulk download | ingest | runtime retrieval
    decision_reason: "<text>"
    captured_at: "<UTC>"
    tcad_id_null_count:                  # austin_permits only
      value: <int>
      source_url: "<url>"
      captured_at: "<UTC>"
    located_in_other_jurisdictions:      # austin_permits only
      - jurisdiction: "LAKEWAY FULL PURPOSE"
        value: <int>
        source_url: "<url>"
        captured_at: "<UTC>"
  - key: "overture"
    denominator:
      value: null
      missing_reason: "not measured in A-01: optional source; licence gate decided in A-09"
      source_url: "<url>"
      captured_at: "<UTC>"
  # ... one row per source key (9 total); blocked rows add:
  #   blocked_evidence:
  #     http_status: 403                 # or timeout_ms (a real timeout only)
  #     error: "fetch failed"            # optional: network error (then no http_status and
  #                                      # no timeout_ms) or a stream error with http_status
  #                                      # (a download that broke part-way)
  #     captured_at: "<UTC>"
  #     url: "<url>"
  #     evidence_path: "docs/evidence/blocked/<file>"
  #     body_sha256: "<hex>"
  #     attempts: 1
  #     user_agent: "<constant project UA>"
  #     outcome: "blocked"               # or "failed" (429/5xx after 5 attempts, network
  #                                      # error, broken download, unexpected 2xx body, 404)
  #     geo_signal: "none"               # or the quoted signal
```

## Checker rules (`check-catalog.ts`, exit 0 = all pass)

Usage: `check-catalog [path]` (default `pipeline/docs/travis-sources.yaml`). Each failed rule prints one line `FAIL rule <n>: <subject> <detail>` and the command exits 1. Fixed formats used by the G6 test cases:

- rule 3: `FAIL rule 3: <source_key> projected <hours> h has no decision`
- rule 6: `FAIL rule 6: jurisdictions <actual> != census place_count + 1 (<expected>)`

1. All 9 source keys present.
2. Every Measurement has `source_url` and `captured_at`; every null has `missing_reason`.
3. Every source has `decision` and `decision_reason`; required when projected hours > 48.
4. Comptroller has `travis_coded_rows` and `statewide_rows`.
5. Austin has count, null `tcad_id` count, throughput (pages ≥ 3, page size ≤ 50,000), projection and decision.
6. Jurisdiction count = `census_reference.place_count + 1`; no `needs-review`; every `spec_class` maps to its `status` per research R3.
7. Austin-issued counts located in other jurisdictions are present under Austin.
8. GIS is counted, or blocked with `gap_pct: unknown` and a reason.
9. No string contains `postgres://`, a token value or an absolute home path.
