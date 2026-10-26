// SYNTHETIC TEST FIXTURE (test-only). Every value here is invented to exercise the
// schema and the writer; none of it is a Travis County measurement and it must never
// be copied into pipeline/docs/ or docs/.
import type { Catalog, Measurement } from "../../travis/discovery/catalog.schema.js";

const AT = "2026-01-01T00:00:00Z";
const URL_BASE = "https://example.test";

export function measurement(value: number | null, path: string): Measurement {
  return value === null
    ? {
        value: null,
        missing_reason: "synthetic: not measured",
        source_url: `${URL_BASE}/${path}`,
        captured_at: AT,
      }
    : { value, source_url: `${URL_BASE}/${path}`, captured_at: AT, method: "count(*)" };
}

export function syntheticCatalog(): Catalog {
  return {
    county: "Synthetic",
    state: "TX",
    slug: "synthetic",
    fips: "48453",
    snapshot_time: AT,
    waiting_human_hours: 0,
    parcel: {
      canonical_source: "synthetic certified roll",
      assessed_parcel_count: 1010,
      assessed_parcel_count_measurement: measurement(1010, "roll"),
      roll_year: 2026,
      certification_date: "2026-07-25",
      gis_feature_count: 1000,
      gis_feature_count_measurement: measurement(1000, "gis/query?returnCountOnly=true"),
      gap_pct: 0.99,
      discrepancy_threshold_pct: 2.0,
      discrepancy_explanation: "synthetic: GIS omits separately assessed units; roll is canonical",
      separately_assessed_without_geometry: "acknowledged",
      identifier_name: "prop_id",
      identifier_proven: true,
      identifier_format: "synthetic: integer",
      deed_or_sale_dates_present: true,
    },
    permits: {
      expected_jurisdiction_count: 2,
      assumes_unified_countywide_history: false,
      jurisdictions: [
        {
          jurisdiction: "Synthetic City",
          key: "synthetic_city",
          spec_class: "supported",
          status: "supported",
          historical_records: true,
          portal_kind: "permit-search",
          portal: `${URL_BASE}/permits#search`,
          evidence_url: `${URL_BASE}/permits`,
          evidence_captured_at: AT,
          earliest_record_date: "1990-01-01",
        },
        {
          jurisdiction: "Synthetic County unincorporated",
          key: "unincorporated",
          spec_class: "records request",
          status: "custodian-only",
          historical_records: false,
          evidence_url: `${URL_BASE}/county`,
          evidence_captured_at: AT,
          records_request: {
            recipient_office: "Synthetic records office",
            system_scope: "synthetic permit system, 1990 to 2026",
            route: "records-first",
            request_portal_url: `${URL_BASE}/records`,
          },
        },
      ],
    },
    destination: {
      writes_in_scope: true,
      proven: true,
      independent_identity_sources: ["synthetic docker identity", "synthetic sql identity"],
    },
    enrichment: {
      bbb: {
        status: "blocked",
        evidence_url: `${URL_BASE}/bbb`,
      },
    },
    census_reference: {
      dataset: "synthetic place relationship file",
      vintage: "2020",
      source_url: `${URL_BASE}/census.txt`,
      captured_at: AT,
      place_count: 1,
    },
    sources: [
      {
        key: "austin_permits",
        url: `${URL_BASE}/resource/abcd-1234.json`,
        status: "available",
        denominator: measurement(2000, "resource/abcd-1234.json?$select=count(*)"),
        throughput: {
          rows_per_minute_median: 100000,
          pages_read: 3,
          page_size: 50000,
          window_start: AT,
          window_end: "2026-01-01T00:03:00Z",
          app_token_used: false,
          rate_limits_observed: "none observed",
        },
        anti_bot: "synthetic: none",
        projected_full_capture_hours: 0.5,
        decision: "ingest",
        decision_reason: "synthetic: fast",
        captured_at: AT,
        tcad_id_null_count: measurement(10, "resource/abcd-1234.json?$where=tcad_id IS NULL"),
        located_in_other_jurisdictions: [
          {
            jurisdiction: "SYNTHETIC FULL PURPOSE",
            value: 5,
            source_url: `${URL_BASE}/g`,
            captured_at: AT,
          },
        ],
      },
      {
        key: "tcad_certified",
        url: `${URL_BASE}/export.zip`,
        status: "blocked",
        denominator: measurement(null, "export.zip"),
        decision: "bulk download",
        decision_reason: "synthetic: single file",
        captured_at: AT,
        blocked_evidence: {
          http_status: 403,
          captured_at: AT,
          url: `${URL_BASE}/export.zip`,
          evidence_path: "docs/evidence/blocked/synthetic.md",
          body_sha256: "0".repeat(64),
          attempts: 1,
          user_agent: "synthetic-agent",
          outcome: "blocked",
          geo_signal: "none",
        },
      },
    ],
  };
}
