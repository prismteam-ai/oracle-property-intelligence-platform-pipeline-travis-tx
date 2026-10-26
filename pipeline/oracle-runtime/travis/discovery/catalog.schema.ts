// T011: Zod schema for pipeline/docs/travis-sources.yaml (contracts/catalog.md,
// data-model.md). Objects are strict so a typo fails loudly. Keys the kit validator reads
// keep the validator's types (for example `parcel.assessed_parcel_count` is a plain number);
// their provenance sits in a sibling `*_measurement` Measurement (A-01 extension).
//
// Presence rules that `check-catalog.ts` reports with numbered FAIL lines (decision when
// projected hours > 48, pages >= 3, the 9 keys all present, jurisdiction count, ...) are
// deliberately NOT enforced here, so a partial catalog can still be written and checked.
import { z } from "zod";
import { SPEC_CLASSES, VALIDATOR_STATUSES } from "./status-map.js";

const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const UtcTimestamp = z
  .string()
  .regex(UTC_ISO, "must be UTC ISO-8601 ending in Z")
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be a real date-time");

export const DateString = z
  .string()
  .regex(DATE_ONLY, "must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be a real date");

const Text = z.string().trim().min(1);
const Url = z.url();

export const SOURCE_KEYS = [
  "tcad_certified",
  "tcad_supplemental",
  "tcad_gis",
  "austin_permits",
  "other_jurisdictions",
  "tx_comptroller",
  "bbb",
  "overture",
  "contractor_licensing",
] as const;
export const SourceKeySchema = z.enum(SOURCE_KEYS);
export type SourceKey = z.infer<typeof SourceKeySchema>;

export const DECISIONS = ["bulk download", "ingest", "runtime retrieval"] as const;
export const DecisionSchema = z.enum(DECISIONS);

export const MeasurementSchema = z
  .strictObject({
    value: z.number().nullable(),
    missing_reason: Text.optional(),
    source_url: Url,
    captured_at: UtcTimestamp,
    method: Text.optional(),
    query: Text.optional(),
    /**
     * Where the request ran when it was not the operator machine (record-gis-runner.ts:
     * the PO-approved US GitHub Actions runner, ARD § 8), with the run, the body digest and
     * the runner's egress country. Absent on measurements taken by discovery itself.
     */
    captured_via: Text.optional(),
    run_url: Url.optional(),
    body_sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    egress_country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
  })
  .refine((m) => m.value !== null || m.missing_reason !== undefined, {
    message: "value null requires missing_reason",
    path: ["missing_reason"],
  });
export type Measurement = z.infer<typeof MeasurementSchema>;

export const ThroughputSchema = z.strictObject({
  rows_per_minute_median: z.number().nonnegative(),
  pages_read: z.int().nonnegative(),
  page_size: z.int().positive(),
  window_start: UtcTimestamp,
  window_end: UtcTimestamp,
  app_token_used: z.boolean(),
  rate_limits_observed: Text,
});

export const DownloadRateSchema = z.strictObject({
  megabytes_per_minute: z.number().nonnegative(),
  bytes: z.int().nonnegative(),
  seconds: z.number().nonnegative(),
  source_url: Url,
  captured_at: UtcTimestamp,
});

export const BlockedEvidenceSchema = z
  .strictObject({
    http_status: z.int().optional(),
    timeout_ms: z.int().nonnegative().optional(),
    /** Network or stream error (redacted); a network error has no status and no timeout_ms. */
    error: Text.optional(),
    captured_at: UtcTimestamp,
    url: Url,
    evidence_path: Text,
    body_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    attempts: z.int().positive(),
    user_agent: Text,
    outcome: z.enum(["blocked", "failed"]),
    geo_signal: Text,
  })
  .refine(
    (b) => b.http_status !== undefined || b.timeout_ms !== undefined || b.error !== undefined,
    { message: "blocked_evidence needs http_status, timeout_ms or error" },
  );

export const LocatedElsewhereSchema = z.strictObject({
  jurisdiction: Text,
  value: z.int().nonnegative(),
  source_url: Url,
  captured_at: UtcTimestamp,
});

export const RecordsRequestSchema = z
  .strictObject({
    recipient_office: Text,
    system_scope: Text,
    route: z.enum(["api-first", "records-first"]),
    request_portal_url: Url.optional(),
    request_email: z.email().optional(),
    /**
     * False when the recorded channel was never seen answering (OR-m5: Webberville's village
     * site did not answer). Absent means the channel page was read.
     */
    channel_verified: z.boolean().optional(),
  })
  .refine((r) => r.request_portal_url !== undefined || r.request_email !== undefined, {
    message: "records_request needs request_portal_url or request_email",
  });
export type RecordsRequest = z.infer<typeof RecordsRequestSchema>;

/**
 * An evidence file that a later probe replaced (OR-m2). The committed file is never edited;
 * the catalog row names what superseded it.
 */
export const SupersededEvidenceSchema = z.strictObject({
  evidence_path: Text,
  superseded_by: Text,
});

export const SourceSchema = z
  .strictObject({
    key: SourceKeySchema,
    url: Url,
    status: z.enum(["available", "blocked"]),
    denominator: MeasurementSchema,
    travis_coded_rows: MeasurementSchema.optional(),
    statewide_rows: MeasurementSchema.optional(),
    throughput: ThroughputSchema.optional(),
    download_rate: DownloadRateSchema.optional(),
    anti_bot: Text.optional(),
    projected_full_capture_hours: z.number().nonnegative().nullable().optional(),
    decision: DecisionSchema.optional(),
    decision_reason: Text.optional(),
    captured_at: UtcTimestamp,
    blocked_evidence: BlockedEvidenceSchema.optional(),
    /**
     * An available source that the operator machine could not reach but that was captured
     * another way (tcad_gis: operator egress blocked; captured via the US runner). Kept out
     * of `blocked_evidence`, which only a blocked row carries (check-catalog rule 11).
     */
    operator_blocked_evidence: BlockedEvidenceSchema.optional(),
    records_request: RecordsRequestSchema.optional(),
    next_step: Text.optional(),
    tcad_id_null_count: MeasurementSchema.optional(),
    located_in_other_jurisdictions: z.array(LocatedElsewhereSchema).optional(),
    superseded_evidence: z.array(SupersededEvidenceSchema).optional(),
    notes: Text.optional(),
  })
  .refine((s) => s.status !== "blocked" || s.blocked_evidence !== undefined, {
    message: "a blocked source requires blocked_evidence",
    path: ["blocked_evidence"],
  });
export type Source = z.infer<typeof SourceSchema>;

export const JurisdictionStatusSchema = z.enum([...VALIDATOR_STATUSES, "needs-review"]);

export const JurisdictionSchema = z.strictObject({
  jurisdiction: Text,
  key: Text,
  /** Census PLACEFP of the place; absent for the unincorporated county row. */
  census_placefp: z
    .string()
    .regex(/^\d{5}$/)
    .optional(),
  spec_class: z.enum(SPEC_CLASSES),
  status: JurisdictionStatusSchema,
  historical_records: z.boolean(),
  portal_kind: Text.optional(),
  portal: Url.optional(),
  vendor: Text.optional(),
  evidence_url: Url,
  evidence_captured_at: UtcTimestamp,
  evidence_http_status: z.int().optional(),
  earliest_record_date: DateString.optional(),
  records_request: RecordsRequestSchema.optional(),
  issued_by: Text.optional(),
  /** All Austin-issued permits located here (full purpose + ETJ + other), FR-004c. */
  austin_issued_located_here: MeasurementSchema.optional(),
  /** The part inside the city limits ("<NAME> FULL PURPOSE"), the AC-4 count (OR-m6). */
  austin_issued_full_purpose: MeasurementSchema.optional(),
  /** The part in the city's extraterritorial jurisdiction ("<NAME> ETJ"), outside its limits. */
  austin_issued_etj: MeasurementSchema.optional(),
  blocked_evidence: BlockedEvidenceSchema.optional(),
  /** Re-probes made by `reprobe-jurisdictions` (at most 1, OR-m2) and when. */
  reprobe_count: z.int().min(0).max(1).optional(),
  reprobed_at: UtcTimestamp.optional(),
  /** True when the re-probe used a different evidence URL (then it was a new probe). */
  reprobe_url_changed: z.boolean().optional(),
  superseded_evidence: z.array(SupersededEvidenceSchema).optional(),
  /**
   * Evaluator-readable reason a non-supported row has no captured history: why, what was
   * tried, what would unblock it (PO decision 2026-10-20: no request is filed).
   */
  blocked_explanation: Text.optional(),
  notes: Text.optional(),
});
export type Jurisdiction = z.infer<typeof JurisdictionSchema>;

/** Receipt of the one TCAD export download (data-model: Parcel.export_receipt). */
export const ExportReceiptSchema = z.strictObject({
  url: Url,
  method: z.enum(["GET", "HEAD"]),
  status: z.int(),
  bytes: z.int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  captured_at: UtcTimestamp,
  user_agent: Text,
  attempts: z.int().positive(),
  outcome: z.enum(["ok", "throttled-then-ok"]),
  /** HTTP Range resumes after a part-way drop (FR-003, 0..5); absent on older catalogs. */
  resumes: z.int().min(0).max(5).optional(),
  /** Repository-relative path of the gitignored file, e.g. pipeline/data/raw/tcad/<name>. */
  file_path: z.string().regex(/^pipeline\/data\/raw\/tcad\/[^/]+$/),
  seconds: z.number().nonnegative(),
  megabytes_per_minute: z.number().nonnegative(),
  roll_year: z.int(),
  certification_date: DateString.optional(),
});
export type ExportReceipt = z.infer<typeof ExportReceiptSchema>;

/**
 * Provenance of parcel.certification_date (FR-003a, PO decision 2026-10-20): the date as
 * stated on the TCAD public-information page, or null with the reason when the page states
 * none. The export file name's date is never used. The saved page stays gitignored.
 */
export const CertificationDateMeasurementSchema = z
  .strictObject({
    value: DateString.nullable(),
    missing_reason: Text.optional(),
    source_url: Url,
    captured_at: UtcTimestamp,
    method: Text.optional(),
    /** Repository-relative path of the saved page, under pipeline/data/raw/tcad/. */
    page_path: z
      .string()
      .regex(/^pipeline\/data\/raw\/tcad\/[^/]+$/)
      .optional(),
    page_sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .refine((m) => m.value !== null || m.missing_reason !== undefined, {
    message: "value null requires missing_reason",
    path: ["missing_reason"],
  });
export type CertificationDateMeasurement = z.infer<typeof CertificationDateMeasurementSchema>;

const Count = z.int().nonnegative();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Account-type breakdown of the certified export (PO decision 2026-10-20: explain the GIS
 * gap from data already held). Counts only, taken in one streaming pass over the file the
 * export receipt names; provenance is that receipt's URL and captured_at. Deliberately has
 * no `value` key, so the measurement walkers do not read it as a Measurement.
 */
export const AccountBreakdownSchema = z
  .strictObject({
    source_url: Url,
    captured_at: UtcTimestamp,
    method: Text,
    /** SHA-256 of the scanned file, equal to export_receipt.sha256. */
    export_sha256: Sha256,
    zip_entry: Text.optional(),
    records: Count,
    inactive_flagged: Count,
    by_prop_type: z
      .array(z.strictObject({ prop_type: Text, count: Count, meaning: Text.optional() }))
      .min(1),
    prop_type_meaning_source: Text,
    real_estate: z.strictObject({
      prop_type: Text,
      accounts: Count,
      distinct_geo_ids: Count,
      accounts_sharing_a_geo_id: Count,
      accounts_without_geo_id: Count,
      with_geometry_point: Count,
      without_geometry_point: Count,
      without_geometry_by_state_cd: z
        .array(
          z.strictObject({
            state_cd: Text,
            count: Count,
            with_condo_unit: Count,
            meaning: Text.optional(),
          }),
        )
        .optional(),
    }),
    state_cd_meaning_source: Text,
  })
  .refine((b) => b.by_prop_type.reduce((n, r) => n + r.count, 0) === b.records, {
    message: "by_prop_type counts must sum to records",
    path: ["by_prop_type"],
  })
  .refine(
    (b) =>
      b.real_estate.with_geometry_point + b.real_estate.without_geometry_point ===
      b.real_estate.accounts,
    {
      message: "real_estate with + without geometry must equal accounts",
      path: ["real_estate"],
    },
  )
  .refine(
    (b) =>
      (b.real_estate.without_geometry_by_state_cd ?? []).reduce((n, r) => n + r.count, 0) ===
      b.real_estate.without_geometry_point,
    {
      message: "without_geometry_by_state_cd counts must sum to without_geometry_point",
      path: ["real_estate", "without_geometry_by_state_cd"],
    },
  );
export type AccountBreakdownBlock = z.infer<typeof AccountBreakdownSchema>;

/**
 * Count-level reconciliation of the roll-minus-GIS gap (not a feature-to-account join):
 * each explained component, the explained total and the unexplained residual.
 */
export const GapReconciliationSchema = z
  .strictObject({
    /** assessed_parcel_count - gis_feature_count. */
    gap: z.int(),
    components: z
      .array(
        z.strictObject({
          component: z.string().regex(/^[a-z][a-z0-9_]*$/),
          count: Count,
          reason: Text,
        }),
      )
      .min(1),
    explained: z.int(),
    residual: z.int(),
    residual_pct_of_roll: z.number(),
    method: Text,
    residual_note: Text,
  })
  .refine((g) => g.components.reduce((n, c) => n + c.count, 0) === g.explained, {
    message: "explained must equal the sum of the components",
    path: ["explained"],
  })
  .refine((g) => g.gap - g.explained === g.residual, {
    message: "residual must equal gap - explained",
    path: ["residual"],
  });
export type GapReconciliation = z.infer<typeof GapReconciliationSchema>;

export const ParcelSchema = z
  .strictObject({
    canonical_source: Text,
    assessed_parcel_count: z.number().nullable(),
    assessed_parcel_count_measurement: MeasurementSchema,
    roll_year: z.int(),
    certification_date: DateString.optional(),
    certification_date_measurement: CertificationDateMeasurementSchema.optional(),
    gis_feature_count: z.number().nullable(),
    gis_feature_count_measurement: MeasurementSchema,
    gap_pct: z.union([z.number().nonnegative(), z.literal("unknown")]),
    gap_reason: Text.optional(),
    discrepancy_threshold_pct: z.number().positive(),
    discrepancy_explanation: Text.optional(),
    separately_assessed_without_geometry: z.enum(["acknowledged", "none"]).optional(),
    account_breakdown: AccountBreakdownSchema.optional(),
    gap_reconciliation: GapReconciliationSchema.optional(),
    /** The key exactly as printed in the export (e.g. `pID`). */
    identifier_name: Text.optional(),
    /** The TCAD Export Layouts name of that key (e.g. `prop_id`), FR-003a. */
    identifier_layout_name: Text.optional(),
    identifier_proven: z.boolean(),
    identifier_format: Text.optional(),
    deed_or_sale_dates_present: z.boolean().optional(),
    export_receipt: ExportReceiptSchema.optional(),
  })
  .refine((p) => p.assessed_parcel_count === p.assessed_parcel_count_measurement.value, {
    message: "assessed_parcel_count must equal its measurement value",
    path: ["assessed_parcel_count"],
  })
  .refine((p) => p.gis_feature_count === p.gis_feature_count_measurement.value, {
    message: "gis_feature_count must equal its measurement value",
    path: ["gis_feature_count"],
  })
  .refine(
    (p) =>
      p.gap_reconciliation === undefined ||
      p.assessed_parcel_count === null ||
      p.gis_feature_count === null ||
      p.gap_reconciliation.gap === p.assessed_parcel_count - p.gis_feature_count,
    {
      message: "gap_reconciliation.gap must equal assessed_parcel_count - gis_feature_count",
      path: ["gap_reconciliation", "gap"],
    },
  )
  .refine(
    (p) =>
      p.certification_date_measurement === undefined ||
      (p.certification_date ?? null) === p.certification_date_measurement.value,
    {
      message: "certification_date must equal its measurement value (absent when null)",
      path: ["certification_date"],
    },
  );

export const PermitsSchema = z.strictObject({
  expected_jurisdiction_count: z.int().nonnegative(),
  assumes_unified_countywide_history: z.literal(false),
  jurisdictions: z.array(JurisdictionSchema),
});

export const DestinationSchema = z
  .strictObject({
    writes_in_scope: z.boolean(),
    proven: z.boolean(),
    /** T044: Docker-side and SQL-side identities (research R9); absent when not proven. */
    independent_identity_sources: z.array(Text).optional(),
    /** Why the destination is not proven (the validator then blocks the gate). */
    missing_reason: Text.optional(),
    captured_at: UtcTimestamp.optional(),
    project: Text.optional(),
    environment: Text.optional(),
  })
  .refine((d) => !d.proven || (d.independent_identity_sources?.length ?? 0) >= 2, {
    message: "a proven destination needs two independent identity sources",
    path: ["independent_identity_sources"],
  })
  .refine((d) => d.proven || d.missing_reason !== undefined, {
    message: "an unproven destination needs missing_reason",
    path: ["missing_reason"],
  });

export const BbbSchema = z.strictObject({
  status: Text,
  evidence_url: Url.optional(),
  evidence_captured_at: UtcTimestamp.optional(),
  evidence_path: Text.optional(),
  advertised_listing_count: z.int().nonnegative().optional(),
  expected_count: z.int().nonnegative().optional(),
  listing_page_cap: z.boolean().optional(),
  cap_acknowledged: z.boolean().optional(),
  next_step: Text.optional(),
});

export const EnrichmentSchema = z.strictObject({ bbb: BbbSchema });

export const CensusReferenceSchema = z.strictObject({
  dataset: Text,
  vintage: Text,
  source_url: Url,
  captured_at: UtcTimestamp,
  place_count: z.int().nonnegative(),
  /** How the place list was filtered (for example whether a land-area column existed). */
  notes: Text.optional(),
});

/**
 * A PO-approved validator exception (OR-M3). The kit validator reads only `gate` and
 * `reason`; the other fields bind the approval to the values it was given for, and
 * check-catalog rule 10 fails when the catalog no longer carries those values.
 */
export const ApprovedExceptionSchema = z.strictObject({
  gate: Text,
  reason: Text,
  approved_by: Text.optional(),
  approved_at: DateString.optional(),
  approved_gap_pct: z.number().nonnegative().optional(),
  approved_gis_count: z.int().nonnegative().optional(),
  approved_assessed_count: z.int().nonnegative().optional(),
  coverage_effect: Text.optional(),
  decision_ref: Text.optional(),
});
export type ApprovedException = z.infer<typeof ApprovedExceptionSchema>;

/**
 * One change an offline command made to the catalog after the workflow wrote it (OR-M5).
 * The workflow refuses to overwrite a catalog that carries any (CR-3).
 */
export const AmendmentSchema = z.strictObject({
  command: Text,
  at: UtcTimestamp,
  fields: z.array(Text).min(1),
  /** The run, artifact, evidence file or commit the change rests on. */
  ref: Text,
  /** Egress country (Cloudflare trace `loc`) of a command that sent a request (OR-B1). */
  egress_country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  /**
   * CR2-3 / OR-N2: where the command ran. `operator` is the operator's own network (the
   * egress reference of later requests); `runner` is a CI runner (record-gis-runner), whose
   * egress is never a reference for the operator's requests.
   */
  venue: z.enum(["operator", "runner"]).optional(),
  note: Text.optional(),
});
export type Amendment = z.infer<typeof AmendmentSchema>;

/** Egress country of the discovery run, from the Cloudflare trace `loc` (OR-B1). */
export const EgressSchema = z.strictObject({
  country: z.string().regex(/^[A-Z]{2}$/),
  captured_at: UtcTimestamp,
  method: Text,
});

export const CatalogSchema = z.strictObject({
  county: Text,
  state: z.string().regex(/^[A-Z]{2}$/),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  fips: z.string().regex(/^\d{5}$/, "fips must be the 5-digit string"),
  snapshot_time: UtcTimestamp,
  /** The workflow run (Restate key) that wrote this catalog; `waiting_human_hours` is its. */
  discovery_run_id: Text.optional(),
  waiting_human_hours: z.number().nonnegative(),
  discovery_egress: EgressSchema.optional(),
  parcel: ParcelSchema.optional(),
  permits: PermitsSchema.optional(),
  destination: DestinationSchema.optional(),
  enrichment: EnrichmentSchema.optional(),
  census_reference: CensusReferenceSchema.optional(),
  approved_exceptions: z.array(ApprovedExceptionSchema).optional(),
  sources: z.array(SourceSchema),
  amendments: z.array(AmendmentSchema).optional(),
});
export type Catalog = z.infer<typeof CatalogSchema>;
