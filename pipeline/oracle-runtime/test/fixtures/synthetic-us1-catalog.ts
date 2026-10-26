// SYNTHETIC TEST FIXTURE (test-only). A complete catalog (sources, parcel, permits, census)
// that passes checker rules 1-8. Every value is invented; none of it is a Travis
// County measurement and it must never be copied into pipeline/docs/ or docs/.
import type { Catalog, Measurement, Source } from "../../travis/discovery/catalog.schema.js";

const AT = "2026-01-01T00:00:00Z";
const U = "https://example.test";

function m(value: number | null, path: string, method = "count(*)"): Measurement {
  return value === null
    ? {
        value: null,
        missing_reason: "synthetic: not measured",
        source_url: `${U}/${path}`,
        captured_at: AT,
      }
    : { value, source_url: `${U}/${path}`, captured_at: AT, method };
}

function simple(key: Source["key"], decision: Source["decision"]): Source {
  return {
    key,
    url: `${U}/${key}`,
    status: "available",
    denominator: m(null, `${key}/count`),
    anti_bot: "synthetic: none observed",
    decision,
    decision_reason: `synthetic reason for ${key}`,
    captured_at: AT,
  };
}

export function syntheticUs1Catalog(): Catalog {
  return {
    county: "Synthetic",
    state: "TX",
    slug: "synthetic",
    fips: "48453",
    snapshot_time: AT,
    waiting_human_hours: 0,
    parcel: {
      canonical_source: "TCAD 2026 certified roll",
      assessed_parcel_count: 1010,
      assessed_parcel_count_measurement: m(1010, "export.json", "streaming count"),
      roll_year: 2026,
      certification_date: "2026-07-25",
      gis_feature_count: 1000,
      gis_feature_count_measurement: m(1000, "gis/query?returnCountOnly=true", "returnCountOnly"),
      gap_pct: 0.99,
      discrepancy_threshold_pct: 2.0,
      discrepancy_explanation: "synthetic: GIS omits separately assessed units",
      separately_assessed_without_geometry: "acknowledged",
      identifier_name: "prop_id",
      identifier_proven: true,
      identifier_format: "synthetic: integer",
      deed_or_sale_dates_present: true,
    },
    census_reference: {
      dataset: "synthetic place-by-county file",
      vintage: "2020",
      source_url: `${U}/census/place_by_county.txt`,
      captured_at: AT,
      place_count: 2,
    },
    permits: {
      expected_jurisdiction_count: 3,
      assumes_unified_countywide_history: false,
      jurisdictions: [
        {
          jurisdiction: "Austin",
          key: "austin",
          census_placefp: "00001",
          spec_class: "supported",
          status: "supported",
          historical_records: true,
          portal_kind: "open-data-api",
          portal: `${U}/resource/abcd-1234.json`,
          evidence_url: `${U}/austin/permits`,
          evidence_captured_at: AT,
          earliest_record_date: "1990-01-01",
        },
        {
          jurisdiction: "Synthetic",
          key: "synthetic",
          census_placefp: "00002",
          spec_class: "records request",
          status: "manual-only",
          historical_records: false,
          portal_kind: "application-intake",
          portal: `${U}/synthetic/apply`,
          evidence_url: `${U}/synthetic/permits`,
          evidence_captured_at: AT,
          records_request: {
            recipient_office: "Synthetic City Secretary",
            system_scope: "synthetic permit system, 2000 to present",
            route: "records-first",
            request_portal_url: `${U}/synthetic/records`,
          },
          austin_issued_located_here: {
            value: 5,
            source_url: `${U}/g`,
            captured_at: AT,
            method: "Austin-issued (jurisdiction group-by): SYNTHETIC FULL PURPOSE=5",
          },
          austin_issued_full_purpose: {
            value: 5,
            source_url: `${U}/g`,
            captured_at: AT,
            method: "Austin-issued inside the city limits (full purpose): SYNTHETIC FULL PURPOSE=5",
          },
          austin_issued_etj: {
            value: 0,
            source_url: `${U}/g`,
            captured_at: AT,
            method: "Austin-issued in the ETJ: no SYNTHETIC ETJ group, so 0",
          },
        },
        {
          jurisdiction: "Synthetic County unincorporated",
          key: "synthetic_unincorporated",
          spec_class: "records request",
          status: "custodian-only",
          historical_records: false,
          evidence_url: `${U}/county/permits`,
          evidence_captured_at: AT,
          records_request: {
            recipient_office: "Synthetic County records management",
            system_scope: "synthetic county permits, 1990 to present",
            route: "records-first",
            request_email: "records@synthetic.test",
          },
        },
      ],
    },
    sources: [
      {
        key: "austin_permits",
        url: `${U}/resource/abcd-1234.json`,
        status: "available",
        denominator: m(2_400_000, "resource/abcd-1234.json?$select=count(*)"),
        throughput: {
          rows_per_minute_median: 100_000,
          pages_read: 3,
          page_size: 50_000,
          window_start: AT,
          window_end: "2026-01-01T00:01:30Z",
          app_token_used: false,
          rate_limits_observed: "none observed",
        },
        anti_bot: "synthetic: none observed",
        projected_full_capture_hours: 0.4,
        decision: "ingest",
        decision_reason: "synthetic: paged API",
        captured_at: AT,
        tcad_id_null_count: m(1234, "resource/abcd-1234.json?$where=tcad_id IS NULL"),
        located_in_other_jurisdictions: [
          {
            jurisdiction: "SYNTHETIC FULL PURPOSE",
            value: 5,
            source_url: `${U}/g`,
            captured_at: AT,
          },
        ],
      },
      {
        key: "tx_comptroller",
        url: `${U}/resource/efgh-5678.json`,
        status: "available",
        denominator: m(3000, "resource/efgh-5678.json?$where=county='227'"),
        travis_coded_rows: m(3000, "resource/efgh-5678.json?$where=county='227'"),
        statewide_rows: m(90_000, "resource/efgh-5678.json?$select=count(*)"),
        anti_bot: "synthetic: none observed",
        decision: "ingest",
        decision_reason: "synthetic: lookup set",
        captured_at: AT,
      },
      {
        key: "tcad_certified",
        url: `${U}/export.json`,
        status: "available",
        denominator: m(1010, "export.json", "streaming count"),
        download_rate: {
          megabytes_per_minute: 50,
          bytes: 100_000_000,
          seconds: 120,
          source_url: `${U}/export.json`,
          captured_at: AT,
        },
        anti_bot: "synthetic: none observed",
        projected_full_capture_hours: 0.03,
        decision: "bulk download",
        decision_reason: "synthetic: single file",
        captured_at: AT,
      },
      simple("tcad_supplemental", "bulk download"),
      {
        key: "tcad_gis",
        url: `${U}/gis`,
        status: "available",
        denominator: m(1000, "gis/query?returnCountOnly=true", "returnCountOnly"),
        anti_bot: "synthetic: none observed",
        decision: "ingest",
        decision_reason: "synthetic: paged later",
        captured_at: AT,
      },
      simple("other_jurisdictions", "runtime retrieval"),
      simple("bbb", "runtime retrieval"),
      simple("overture", "bulk download"),
      simple("contractor_licensing", "runtime retrieval"),
    ],
  };
}
