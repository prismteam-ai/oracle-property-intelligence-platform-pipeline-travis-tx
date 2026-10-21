import { z } from 'zod';
import {
  Atlas,
  Bbb,
  CoordinateBasis,
  EvidenceState,
  EvidenceStates,
  Group,
  IdentityStatus,
  Limitation,
  MailingAddress,
  MatchReason,
  OpenDurationBasis,
  OpenSinceBasis,
  RoofAgeBasis,
  RoofAgeConfidence,
  RoofWorkClass,
  SitusAddress,
  Source,
  SourceHttpRequest,
  StatusGroup,
  StatusSource,
  UnlinkedReasons,
  UnpublishedSource,
  def,
  int,
  nbool,
  nint,
  nnum,
  nstr,
  obj,
  untrusted,
} from './shared.js';

// ---- properties --------------------------------------------------------------------------------
export const RoofAgeAnchor = def(
  'RoofAgeAnchor',
  z.union([
    obj({ permit_id: z.string(), date: z.string(), date_field: z.string() }),
    obj({ source_field: z.literal('year_built') }),
  ]),
);

export const LastRoofingPermit = def(
  'LastRoofingPermit',
  obj({
    permit_id: z.string(),
    date: nstr,
    status_group: StatusGroup,
    roof_work_class: RoofWorkClass,
  }),
);

export const RoofingPermitCounts = def(
  'RoofingPermitCounts',
  obj({ open: int, stalled: int, closed: int, needs_review: int }),
);

export const PropertySummary = def(
  'PropertySummary',
  obj({
    property_id: z.string(),
    geo_id: nstr,
    address: SitusAddress,
    lat: nnum,
    lon: nnum,
    coordinate_basis: CoordinateBasis.nullable(),
    year_built: nint,
    roof_year: nint,
    roof_age_years: nint,
    roof_age_basis: RoofAgeBasis.nullable(),
    roof_age_confidence: RoofAgeConfidence,
    roof_age_anchor: RoofAgeAnchor.nullable(),
    roof_age_as_of: z.string(),
    roof_age_caveats: z.array(z.string()),
    last_roofing_permit: LastRoofingPermit.nullable(),
    roofing_permit_counts: RoofingPermitCounts,
    owner_tenure_years: nnum,
    owner_absentee: nbool,
    owner_out_of_area: nbool,
    has_bbb_contractor: z.boolean(),
    source: Source,
    record_cid: z.string(),
    property_cid: z.string(),
    data_group_cid: z.string(),
    unpublished_source: UnpublishedSource.nullable(),
    distance_miles: nnum.optional(),
    match_reasons: z.array(MatchReason).optional(),
  }),
);

export const Owner = def(
  'Owner',
  obj({
    owner_name: untrusted(nstr),
    mailing_address: MailingAddress.nullable(),
    deed_date: nstr,
    owner_tenure_years: nnum,
    owner_absentee: nbool,
    owner_out_of_area: nbool,
    source: Source,
    unpublished_source: UnpublishedSource.nullable(),
  }),
);

// ---- permits -----------------------------------------------------------------------------------
export const PropertyLink = def(
  'PropertyLink',
  obj({
    match_method: z.enum(['exact', 'normalized_digits', 'tcad_permit_listing']),
    normalization_version: nstr,
    confidence: z.enum(['exact', 'normalized', 'official_listing']),
  }),
);

export const PermitContractor = def(
  'PermitContractor',
  obj({
    contractor_attribution_key: z.string(),
    identity_status: IdentityStatus,
    printed_name: untrusted(z.string()),
    company_name: untrusted(nstr),
    trade: untrusted(nstr),
    phone: untrusted(nstr),
  }),
);

export const MatchSnippet = def(
  'MatchSnippet',
  obj({
    field: z.enum(['description', 'permit_class', 'work_class']),
    text: untrusted(z.string()),
  }),
);

export const PermitSummary = def(
  'PermitSummary',
  obj({
    permit_id: z.string(),
    geo_id: nstr,
    property_id: z.string(),
    property_link: PropertyLink,
    permit_type: untrusted(z.string()),
    permit_class: untrusted(z.string()),
    work_class: untrusted(z.string()),
    description: untrusted(z.string()),
    roof_work_class: RoofWorkClass,
    work_classifier_version: z.string(),
    is_roofing: z.boolean(),
    is_reroof: z.boolean(),
    status: z.string(),
    status_group: StatusGroup,
    status_group_basis: z
      .enum(['status', 'completed_date'])
      .optional()
      .describe(
        'status: status_group maps the printed status. completed_date: the printed status is open or stalled but the permit has a completed_date, so it is served as closed.',
      ),
    status_observed_at: z.string(),
    status_source: StatusSource,
    applied_date: nstr,
    issued_date: nstr,
    expires_date: nstr,
    completed_date: nstr,
    completed_date_evidence: EvidenceState,
    open_since: nstr,
    open_since_basis: OpenSinceBasis.nullable(),
    open_duration_days: nint,
    open_duration_basis: OpenDurationBasis.nullable(),
    open_duration_as_of: z.string(),
    days_since_expiry: nint,
    contractor: PermitContractor.nullable(),
    bbb: Bbb,
    lat: nnum,
    lon: nnum,
    source: Source,
    record_cid: z.string(),
    property_cid: z.string(),
    data_group_cid: z.string(),
    unpublished_source: UnpublishedSource,
    distance_miles: nnum.optional(),
    match_snippet: MatchSnippet.optional(),
    bm25_score: z.number().optional(),
  }),
);

/** `improvements[]` is optional and unspecified by the contract beyond "from improvement details": an open map. */
export const Improvement = def('Improvement', z.record(z.string(), z.unknown()));

export const PropertyDetail = def(
  'PropertyDetail',
  PropertySummary.extend({
    owner: Owner.nullable(),
    permits: z.array(PermitSummary),
    permits_total: int,
    permits_truncated: z.boolean(),
    improvements: z.array(Improvement).optional(),
  }),
);

export const PermitDetail = def(
  'PermitDetail',
  PermitSummary.extend({
    property: PropertySummary.nullable(),
    applicant: z.null(),
    applicant_unavailable_reason: z.literal('not collected: personal contact fields'),
    valuations: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
);

// ---- business and license records --------------------------------------------------------------

export const BusinessRecord = def(
  'BusinessRecord',
  obj({
    business_record_id: z.string(),
    source: z.string(),
    dataset: z.string(),
    record_id: nstr,
    record_id_withheld: nstr,
    name: untrusted(z.string()),
    sos_file_number: nstr,
    organization_type: nstr,
    status_code: nstr,
    status_date: nstr,
    right_to_transact: nstr,
    naics_code: nstr,
    address: MailingAddress.nullable(),
    address_kind: nstr,
    county_code: nstr,
    scope: z.string(),
    candidate_of: obj({ contractor_attributions: int, roll_owners: int }),
    detail_url: nstr,
    printed: untrusted(z.record(z.string(), nstr)),
    record_cid: z.null(),
    unpublished_source: UnpublishedSource,
  }),
);

export const LicenseRecord = def(
  'LicenseRecord',
  obj({
    license_record_id: z.string(),
    source: z.string(),
    dataset: z.string(),
    license_number: nstr,
    license_type: nstr,
    license_subtype: nstr,
    holder_name: untrusted(nstr),
    business_name: untrusted(nstr),
    issue_date: nstr,
    expiration_date: nstr,
    business_city: nstr,
    business_county: nstr,
    printed: untrusted(z.record(z.string(), nstr)),
    record_cid: z.null(),
    unpublished_source: UnpublishedSource,
  }),
);

export const RegistryCandidate = def(
  'RegistryCandidate',
  obj({
    source: z.string(),
    dataset: z.string(),
    business_record_id: z.string(),
    taxpayer_number: nstr,
    sos_file_number: nstr,
    name: untrusted(z.string()),
    scope: z.string(),
    matched_field: z.string(),
    printed_value: untrusted(z.string()),
    normalized_name: z.string(),
    match_method: z.string(),
    matcher_version: z.string(),
    status: z.literal('candidate'),
    unpublished_source: UnpublishedSource,
  }),
);

export const LicenseCandidate = def(
  'LicenseCandidate',
  obj({
    source: z.string(),
    dataset: z.string(),
    license_record_id: z.string(),
    license_number: nstr,
    license_type: nstr,
    name: untrusted(z.string()),
    matched_field: z.string(),
    printed_value: untrusted(z.string()),
    normalized_name: z.string(),
    match_method: z.string(),
    matcher_version: z.string(),
    status: z.literal('candidate'),
    unpublished_source: UnpublishedSource,
  }),
);

export const OfficialIdentity = def(
  'OfficialIdentity',
  obj({ company_cid: z.string(), license_identifier: z.string(), source: z.string() }),
);

export const Contractor = def(
  'Contractor',
  obj({
    contractor_attribution_key: z.string(),
    identity_status: IdentityStatus,
    company_name: untrusted(nstr),
    printed_names: z.array(untrusted(z.string())),
    trade: untrusted(nstr),
    phone: untrusted(nstr),
    /** Single line as printed by the permit export (contract says only "as printed"). */
    address: untrusted(nstr),
    permit_count: int,
    open_permit_count: int,
    roofing_permit_count: int,
    needs_review_permit_count: int,
    registry_candidates: z.array(RegistryCandidate),
    license_candidates: z.array(LicenseCandidate).nullable(),
    official_identity: OfficialIdentity.nullable(),
    bbb: Bbb,
  }),
);

// ---- runs and meta -----------------------------------------------------------------------------
const Rate = obj({ rate: z.number(), burst: z.number() });

export const RunSource = def(
  'RunSource',
  obj({
    dataset: z.string(),
    // real run records null these for sources with no single URL, fetch time or file hash (T3 snapshots, the TNR page capture)
    url: nstr,
    watermark: nstr,
    fetched_at: nstr,
    sha256: nstr,
    availability: z.string(),
    source_access_status: z.string(),
  }),
);

export const LoaderWatermark = def(
  'LoaderWatermark',
  obj({
    track: z.string(),
    path: z.string(),
    artifact_hash: z.string(),
    merged_count: int,
    last_merged_at: nstr,
    merged_rows: int.optional(),
  }),
);

export const Car = def(
  'Car',
  obj({
    root_cid: z.string(),
    group: z.string(),
    kind: z.enum(['archive', 'tables']),
    schema_cid: z.string(),
    // the run records carry no block count, validation, size or hash for a tables CAR (and some archives null them)
    block_count: int.optional(),
    car_validation: z.record(z.string(), z.unknown()).nullable().optional(),
    path: z.string(),
    size: int.optional(),
    sha256: z.string().optional(),
    readback_url: nstr,
  }),
);

export const GatewayCheck = def(
  'GatewayCheck',
  obj({
    cid: z.string(),
    codec: z.string(),
    gateway: z.string(),
    status: nint,
    size: nint,
    sha256: nstr,
    multihash: nstr,
    checked_at: z.string(),
  }),
);

/**
 * Run record (runs/*.json). Only run_id, started_at, finished_at and groups are required: real run
 * records null or omit later fields (for example loader_watermarks) and carry extra kit fields; the
 * object is open.
 */
export const Run = def(
  'Run',
  obj({
    run_id: z.string(),
    started_at: z.string(),
    finished_at: z.string(),
    window: z.record(z.string(), obj({ from: nstr, to: nstr })).optional(),
    sources: z.array(RunSource).optional(),
    loader_watermarks: z.array(LoaderWatermark).nullable().optional(),
    tombstones_consumed: obj({ dead: int, invalid: int }).nullable().optional(),
    counts: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    deltas: z.record(z.string(), z.record(z.string(), z.unknown())).nullable().optional(),
    limitations: z.array(Limitation).optional(),
    evidence_states: EvidenceStates.nullable().optional(),
    unlinked_reasons: UnlinkedReasons.nullable().optional(),
    groups: z.record(z.string(), Group),
    manifest_cid: nstr.optional(),
    atlas: Atlas.nullable().optional(),
    cars: z.array(Car).optional(),
    gateway_checks: z.array(GatewayCheck).optional(),
    timings: z.record(z.string(), z.unknown()).optional(),
    cli_commit: nstr.optional(),
    lexicon_manifest_url: nstr.optional(),
    kit_commit: nstr.optional(),
    readiness_report: obj({ overall: z.string(), gates: z.unknown() }).nullable().optional(),
  }),
);

export const BySource = def(
  'BySource',
  obj({
    kind: z.string(),
    dataset: z.string(),
    rows_loaded: int,
    in_scope_rows: int,
    out_of_county_candidate_rows: int,
    withheld_record_ids: int,
    candidates: int,
    fetched_at: z.string(),
  }),
);

export const DeployRead = def(
  'DeployRead',
  obj({
    dataset: z.string(),
    url: z.string(),
    fetched_at: z.string(),
    sha256: z.string(),
    rows: int,
    matched: int,
    unavailable: int,
    conflicting: int,
  }),
);

export const Meta = def(
  'Meta',
  obj({
    county: z.string(),
    fips: z.string(),
    run: obj({ run_id: z.string(), started_at: z.string(), finished_at: z.string() }),
    counts: obj({
      properties: int,
      with_coordinates: int,
      with_roof_age: int,
      permits: int,
      permits_joined_to_property: int,
      permits_unmatched: int,
      permits_needs_review: int,
      roofing_permits: int,
      open_roofing_permits: int,
      stalled_roofing_permits: int,
      roofing_permits_needs_review: int,
      owners: int,
      permit_contractor_attributions: int,
      registry_rows_loaded: int,
      bbb_profiles: int,
      business_records: int,
      license_records: int,
      contractors_with_registry_candidate: int,
      contractors_with_license_candidate: int,
      by_source: z.record(z.string(), BySource),
    }),
    groups: z.record(z.string(), Group),
    manifest_cid: z.string(),
    atlas: Atlas.nullable(),
    evidence_states: EvidenceStates,
    unlinked_reasons: UnlinkedReasons,
    limitations: z.array(Limitation),
    cli_commit: z.string(),
    lexicon_manifest_url: z.string(),
    kit_commit: z.string(),
    deploy: obj({
      deploy_id: z.string(),
      inputs_sha256: z.string(),
      deployed_at: z.string(),
      server_commit: z.string(),
      duckdb_version: z.string(),
      duckdb_sha256: z.string(),
      text_index: obj({
        rows: int,
        config: obj({
          stemmer: z.string(),
          stopwords: z.string(),
          ignore: z.string(),
          lower: z.boolean(),
          strip_accents: z.boolean(),
        }),
        alias_version: z.string(),
      }),
      reads: z.array(DeployRead),
    }),
    mcp: obj({ protocol_version: z.literal('2025-06-18') }),
    attribution_key_version: z.string(),
    limits: obj({
      stage: Rate,
      routes: z.record(z.string(), Rate),
      mcp: z.record(z.string(), Rate),
      chat: obj({ max_output_tokens: int, turn_deadline_seconds: z.number() }),
    }),
  }),
);

export type PropertySummary = z.infer<typeof PropertySummary>;
export type PropertyDetail = z.infer<typeof PropertyDetail>;
export type PermitSummary = z.infer<typeof PermitSummary>;
export type PermitDetail = z.infer<typeof PermitDetail>;
export type Contractor = z.infer<typeof Contractor>;
export type BusinessRecord = z.infer<typeof BusinessRecord>;
export type LicenseRecord = z.infer<typeof LicenseRecord>;
export type Run = z.infer<typeof Run>;
export type Meta = z.infer<typeof Meta>;
export { SourceHttpRequest };
