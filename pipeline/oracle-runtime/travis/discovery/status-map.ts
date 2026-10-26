// T012: spec class -> kit validator status (research R3). The spec keeps the PO's
// plain-language classes in `spec_class`; the validator only accepts its own seven
// words in `status`, so every row goes through this one mapping.

export const SPEC_CLASSES = ["supported", "records request", "no public history"] as const;
export type SpecClass = (typeof SPEC_CLASSES)[number];

export const JURISDICTION_CASES = [
  "history-online",
  "custodian-only",
  "intake-or-no-history",
  "portal-blocked",
  "issued-by-other-body",
  "no-records",
] as const;
export type JurisdictionCase = (typeof JURISDICTION_CASES)[number];

/** The kit validator's PERMIT_CLASSIFICATIONS (kit 0.99.1). `excluded` is unused. */
export const VALIDATOR_STATUSES = [
  "supported",
  "delegated",
  "manual-only",
  "blocked",
  "unavailable",
  "excluded",
  "custodian-only",
] as const;
export type ValidatorStatus = (typeof VALIDATOR_STATUSES)[number];

/** Portal kinds the validator treats as intake, never as municipal history. */
export const CENTRAL_PORTAL_KINDS: ReadonlySet<string> = new Set([
  "central-submission",
  "supplemental-approval",
  "application-intake",
  "onestop",
]);

export interface StatusMapping {
  readonly spec_class: SpecClass;
  readonly case: JurisdictionCase;
  readonly status: ValidatorStatus;
  readonly historical_records: boolean;
  readonly required_extras: readonly string[];
}

export const STATUS_MAP: readonly StatusMapping[] = [
  {
    spec_class: "supported",
    case: "history-online",
    status: "supported",
    historical_records: true,
    required_extras: ["historical_records", "earliest_record_date"],
  },
  {
    spec_class: "records request",
    case: "custodian-only",
    status: "custodian-only",
    historical_records: false,
    required_extras: ["records_request"],
  },
  {
    spec_class: "records request",
    case: "intake-or-no-history",
    status: "manual-only",
    historical_records: false,
    required_extras: ["records_request", "historical_records"],
  },
  {
    spec_class: "records request",
    case: "portal-blocked",
    status: "blocked",
    historical_records: false,
    required_extras: ["records_request", "blocked_evidence"],
  },
  {
    spec_class: "no public history",
    case: "issued-by-other-body",
    status: "delegated",
    historical_records: false,
    required_extras: ["issued_by"],
  },
  {
    spec_class: "no public history",
    case: "no-records",
    status: "unavailable",
    historical_records: false,
    required_extras: ["evidence_url"],
  },
];

export function mapStatus(specClass: SpecClass, jurisdictionCase: JurisdictionCase): StatusMapping {
  const row = STATUS_MAP.find((r) => r.spec_class === specClass && r.case === jurisdictionCase);
  if (!row) {
    throw new Error(
      `status-map: no R3 row for spec_class "${specClass}" + case "${jurisdictionCase}"`,
    );
  }
  return row;
}

export interface JurisdictionClassInput {
  spec_class: SpecClass;
  case: JurisdictionCase;
  portal_kind?: string;
}

/**
 * Resolves the validator status and historical_records flag for one jurisdiction.
 * An intake/one-stop portal can never be historical records, so a `supported` row whose
 * portal is one is refused rather than silently downgraded.
 */
export function resolveJurisdictionStatus(input: JurisdictionClassInput): {
  status: ValidatorStatus;
  historical_records: boolean;
} {
  const row = mapStatus(input.spec_class, input.case);
  const kind = (input.portal_kind ?? "").trim().toLowerCase();
  if (CENTRAL_PORTAL_KINDS.has(kind) && row.historical_records) {
    throw new Error(
      `status-map: portal_kind "${kind}" is intake, not historical records; classify as records request + intake-or-no-history`,
    );
  }
  return { status: row.status, historical_records: row.historical_records };
}
