// T049: the Property Improvement data group for one TCAD property's Austin permits
// (build-county-transform custom-code mode, reference/output-contract.md). Writes
// `<pID>/data/`:
//   seed files + property.json (shared-seed.ts, byte-identical with the County group)
//   property_improvement_N.json ← one captured Austin permit (the per-permit GET)
//   relationship_property_has_property_improvement_N.json
//   <Property Improvement schema CID>.json
//
// Classification comes only from the profile (profiles/travis-austin@1.0.0, injected as
// ProfileApi): improvement_type / improvement_action from classifyPermit(),
// improvement_status from classifyStatus(). Expired is emitted with improvement_status
// null (D-4a). Status classes exclude and needs_review, and needs_review permits, are
// never emitted; they are counted and kept in the ledger. Trade sub-permits (non-BP, the
// profile's `trade_permit` reason, D-4b) are never Roofing and, by the PO decision of
// 2026-10-24 ("publish roofing only"), are never emitted either: the ledger keeps their
// trade type and a `trade_sub_permit` skip reason, and they count as excluded.
//
// Written fields are only lexicon properties of the live `property_improvement` class
// (additionalProperties false). The source description, work class, status word, expiry
// have no carrier (ADR-0002) and are never written. The printed contractor COMPANY name is the
// exception (ERR-66, PO 2026-10-25): company.name via property_improvement_has_contractor.
// `contractor_type` is required by the class and written null: the permit's category
// of contractor is not established here.
//
// Contractor identity (A-07/AD-05, wired here): ADR-0002 verdict #6 ("per-permit contractor
// state: no carrier confirmed") means the five-state result has NO lexicon carrier on this
// class or on `company` for anything short of `resolved` -- AD-06 allows a
// `property_improvement_has_contractor` edge only for a `resolved` match, and the live
// crosswalk is empty (D-10), so that edge is never written live. The per-permit state
// therefore stays on `ClassificationLedgerRow.contractor_resolution` (internal; never
// published, same as every other ledger field) and rolls up into the run summary's
// `coverage` (AD-24's fallback), never onto the emitted JSON record.
import {
  resolveContractor,
  type RegistryRecord,
  type ResolverState,
} from "../identity/resolver.js";
import { publishedContractorName } from "../permits/bbb-search-url.js";
import { LIVE_CROSSWALK, type CrosswalkIndex } from "../identity/crosswalk.js";
import {
  buildSharedFiles,
  jsonFile,
  link,
  pidOf,
  type SeedRow,
  type TcadRecord,
} from "./shared-seed.js";
import type { DataGroupCids } from "./lexicon-manifest.js";

/**
 * The Comptroller registry snapshot a run resolves permits against (A-07's
 * `comptroller_registry`/`identity:resolve`, reused here as a pure call per permit -- the
 * resolver's own contract says it may be called "per permit inside a transaction" or "in a
 * batch"; this is a third, DB-free caller). Omitted entirely (`registryLoaded: false`) is the
 * correct state before A-07's baseline is wired for a given run: every permit resolves to the
 * real `unresolved` state with `reasonCode: "registry_unavailable"` (resolver.ts step 2), not a
 * fabricated placeholder.
 */
export interface ContractorIdentityInput {
  registry: readonly RegistryRecord[];
  registryLoaded: boolean;
  registrySnapshotDigest: string;
  /** Default `LIVE_CROSSWALK` (empty, D-10) when omitted. */
  crosswalk?: CrosswalkIndex;
  /** ISO-8601; defaults to now (tests pin this for determinism). */
  effectiveOn?: string;
}

const NO_REGISTRY: ContractorIdentityInput = {
  registry: [],
  registryLoaded: false,
  registrySnapshotDigest: "none",
};

export const AUSTIN_DATASET_URL = "https://data.austintexas.gov/resource/3syk-w9eu.json";

/** An Austin 3syk-w9eu row as captured (Socrata omits null fields). */
export type AustinRow = { permit_number: string } & Record<string, string | null | undefined>;

export interface AustinPermitReceipt {
  url: string;
  method: "GET";
  multiValueQueryString: { permit_number: string[] };
  status: number | null;
  sha256: string;
  captured_at: string;
}

export interface AustinPermitCapture {
  row: AustinRow;
  receipt: AustinPermitReceipt;
}

export type StatusClass = "open" | "stalled" | "closed" | "exclude" | "needs_review";
export type RoofingVerdict = "roofing" | "not_roofing" | "needs_review";

/** The profile contract (contracts/profile.md) as the transform uses it. */
export interface ProfileApi {
  PROFILE: { name: string; version: string; sha256: string };
  classifyPermit: (row: AustinRow) => {
    roofing: RoofingVerdict;
    reason: string;
    improvement_type: string | null;
    improvement_action: string | null;
    sha256: string;
  };
  /** The source status word as printed; an absent word is passed as "" (needs_review). */
  classifyStatus: (word: string) => {
    class: StatusClass;
    improvement_status: string | null;
    sha256: string;
  };
}

export type SkipReason =
  | "status_exclude"
  | "status_needs_review"
  | "roofing_needs_review"
  | "no_improvement_type"
  | "trade_sub_permit";

/** The profile's own D-4b verdict reason for a non-BP (trade) sub-permit (rules.json `trade_permit`). */
export const TRADE_PERMIT_REASON = "trade_permit";

export interface ClassificationLedgerRow {
  pID: string | null;
  permit_number: string;
  emitted: boolean;
  status_class: StatusClass;
  roofing: RoofingVerdict;
  reason: string;
  improvement_type: string | null;
  improvement_action: string | null;
  improvement_status: string | null;
  skip_reason: SkipReason | null;
  issue_date: string | null;
  completed_date: string | null;
  source_sha256: string;
  profile_version: string;
  profile_sha256: string;
  /**
   * A-07/AD-05's five-state verdict for this permit's printed contractor name against the
   * Comptroller registry (resolver.ts's `resolveContractor`, real production logic, not
   * re-implemented here). Internal only -- no lexicon carrier (ADR-0002 #6) -- and rolls up
   * into the run summary's `coverage`, never onto the emitted record.
   */
  contractor_resolution: ResolverState;
}

export const EMITTABLE_CLASSES: readonly StatusClass[] = ["open", "stalled", "closed"];

/** D-4a guard: every emitted permit's class must be open, stalled or closed. */
export function assertEmittedClasses(
  ledger: ReadonlyArray<
    Pick<ClassificationLedgerRow, "permit_number" | "emitted" | "status_class">
  >,
): void {
  const bad = ledger.filter((r) => r.emitted && !EMITTABLE_CLASSES.includes(r.status_class));
  if (bad.length > 0) {
    throw new Error(
      `emitted permits outside {open, stalled, closed}: ${bad.map((r) => `${r.permit_number}=${r.status_class}`).join(", ")}`,
    );
  }
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? (m[1] as string) : null;
}

/**
 * This permit's printed contractor name resolved against the Comptroller registry (A-07's
 * `resolveContractor`, unmodified). `identity` omitted means the baseline is not wired for
 * this run: every permit genuinely resolves `unresolved`/`registry_unavailable`, the real
 * verdict resolver.ts step 2 gives for an unloaded registry -- not a fabricated default.
 */
function resolvePermitContractor(
  row: AustinRow,
  permitNumber: string,
  identity: ContractorIdentityInput,
): ResolverState {
  // The name the permit publishes (ERR-72: the company, else the contractor person; placeholders
  // such as N/A count as none), so the run's five-state totals describe the published names.
  const rawContractorName =
    publishedContractorName(row.contractor_company_name) ??
    publishedContractorName(row.contractor_full_name);
  return resolveContractor({
    permitKey: permitNumber,
    rawContractorName,
    registryLoaded: identity.registryLoaded,
    registry: identity.registry,
    registrySnapshotDigest: identity.registrySnapshotDigest,
    crosswalk: identity.crosswalk ?? LIVE_CROSSWALK,
    ...(identity.effectiveOn === undefined ? {} : { effectiveOn: identity.effectiveOn }),
  }).state;
}

/** One permit through the profile: the ledger row (internal; never published). */
export function classifyCapture(
  capture: AustinPermitCapture,
  profile: ProfileApi,
  pID: string | null,
  contractorIdentity: ContractorIdentityInput = NO_REGISTRY,
): ClassificationLedgerRow {
  const row = capture.row;
  const permit = profile.classifyPermit(row);
  const status = profile.classifyStatus(row.status_current ?? "");
  if (permit.sha256 !== profile.PROFILE.sha256 || status.sha256 !== profile.PROFILE.sha256) {
    throw new Error(`profile digest mismatch on ${row.permit_number}`);
  }
  let skip: SkipReason | null = null;
  // D-4b: a trade sub-permit is never published, whatever its status word says.
  if (permit.reason === TRADE_PERMIT_REASON) skip = "trade_sub_permit";
  else if (status.class === "exclude") skip = "status_exclude";
  else if (status.class === "needs_review") skip = "status_needs_review";
  else if (permit.roofing === "needs_review") skip = "roofing_needs_review";
  else if (permit.improvement_type === null) skip = "no_improvement_type";
  if (permit.roofing !== "roofing" && permit.improvement_type === "Roofing") {
    throw new Error(`${row.permit_number}: a non-roofing verdict carries Roofing`);
  }
  return {
    pID,
    permit_number: row.permit_number,
    emitted: skip === null,
    status_class: status.class,
    roofing: permit.roofing,
    reason: permit.reason,
    improvement_type: permit.improvement_type,
    improvement_action: permit.improvement_action,
    improvement_status: skip === null ? status.improvement_status : null,
    skip_reason: skip,
    issue_date: isoDate(row.issue_date),
    completed_date: isoDate(row.completed_date),
    source_sha256: capture.receipt.sha256,
    profile_version: `${profile.PROFILE.name}@${profile.PROFILE.version}`,
    profile_sha256: profile.PROFILE.sha256,
    contractor_resolution: resolvePermitContractor(row, row.permit_number, contractorIdentity),
  };
}

export interface PropertyImprovementInput {
  record: TcadRecord;
  seed: SeedRow;
  cids: DataGroupCids;
  /** The property's captured permits, in the order they are numbered. */
  permits: AustinPermitCapture[];
  profile: ProfileApi;
  /** Omitted means the Comptroller baseline is not wired for this run (pre-A-07 default). */
  contractorIdentity?: ContractorIdentityInput;
  /**
   * Year built by the recorded rule (shared-seed.ts propertyFields), passed exactly as the
   * County transform passes it so property.json is byte-identical in both groups.
   */
  yearBuilt?: number | null;
}

export interface PropertyImprovementCounts {
  emitted: number;
  excluded: number;
  needs_review: number;
  by_class: Partial<Record<StatusClass, number>>;
  by_skip: Partial<Record<SkipReason, number>>;
  /** Emitted permits only, by A-07's five-state verdict (AD-24's manifest-coverage rollup). */
  by_contractor_state: Partial<Record<ResolverState, number>>;
  /** Emitted permits whose printed contractor name is published as company.name (ERR-66, ERR-72). */
  contractor_companies_printed: number;
  /** Of those, permits that print only a contractor person, published as company.name (ERR-72). */
  contractor_persons_printed: number;
}

export interface PropertyImprovementOutput {
  pID: string;
  dir: string;
  /** Empty when no permit of the property is emitted (the property is left out of the group). */
  files: Record<string, string>;
  counts: PropertyImprovementCounts;
  ledger: ClassificationLedgerRow[];
}

export function transformAustinPropertyImprovement(
  input: PropertyImprovementInput,
): PropertyImprovementOutput {
  const pID = pidOf(input.record);
  const contractorIdentity = input.contractorIdentity ?? NO_REGISTRY;
  const ledger = input.permits.map((p) =>
    classifyCapture(p, input.profile, pID, contractorIdentity),
  );
  assertEmittedClasses(ledger);

  const counts: PropertyImprovementCounts = {
    emitted: 0,
    excluded: 0,
    needs_review: 0,
    by_class: {},
    by_skip: {},
    by_contractor_state: {},
    contractor_companies_printed: 0,
    contractor_persons_printed: 0,
  };
  const permitFiles: Record<string, string> = {};
  const links: { "/": string }[] = [];
  const contractorLinks: { "/": string }[] = [];
  input.permits.forEach((capture, i) => {
    const l = ledger[i] as ClassificationLedgerRow;
    if (!l.emitted) {
      const skip = l.skip_reason as SkipReason;
      counts.by_skip[skip] = (counts.by_skip[skip] ?? 0) + 1;
      if (
        skip === "status_exclude" ||
        skip === "no_improvement_type" ||
        skip === "trade_sub_permit"
      )
        counts.excluded += 1;
      else counts.needs_review += 1;
      return;
    }
    counts.emitted += 1;
    counts.by_class[l.status_class] = (counts.by_class[l.status_class] ?? 0) + 1;
    counts.by_contractor_state[l.contractor_resolution] =
      (counts.by_contractor_state[l.contractor_resolution] ?? 0) + 1;
    const n = counts.emitted;
    const name = `property_improvement_${n}.json`;
    const multi = capture.receipt.multiValueQueryString;
    if (capture.receipt.method !== "GET" || multi.permit_number?.[0] !== l.permit_number) {
      throw new Error(`${l.permit_number}: receipt is not the per-permit GET`);
    }
    permitFiles[name] = jsonFile({
      source_http_request: {
        method: "GET",
        url: AUSTIN_DATASET_URL,
        multiValueQueryString: { permit_number: [l.permit_number] },
      },
      request_identifier: l.permit_number,
      permit_number: l.permit_number,
      improvement_type: l.improvement_type,
      improvement_action: l.improvement_action,
      improvement_status: l.improvement_status,
      contractor_type: null,
      permit_issue_date: l.issue_date,
      completion_date: l.completed_date,
    });
    // PO decision 2026-10-25 (ERR-66): the company the permit PRINTS, "as printed, unverified".
    // A company record linked by property_improvement_has_contractor, with the permit's own request
    // as provenance and NO sunbiz_document_number: a name is evidence, not identity, so
    // contractor_resolution stays unresolved (never a registry id from a name match). No phone or
    // address is written.
    // PO decision 2026-10-26 (ERR-72): when the permit prints no company but does print a
    // contractor person (contractor_full_name), that name is published the same way, as the
    // contractor company's name as printed. The lexicon links a permit's contractor to a company
    // only, so no person record is written. A printed company always wins over the person.
    const companyName = publishedContractorName(capture.row.contractor_company_name);
    const printedName = companyName ?? publishedContractorName(capture.row.contractor_full_name);
    if (printedName !== null) {
      if (companyName === null) counts.contractor_persons_printed += 1;
      const company = `company_${n}.json`;
      permitFiles[company] = jsonFile({
        source_http_request: {
          method: "GET",
          url: AUSTIN_DATASET_URL,
          multiValueQueryString: { permit_number: [l.permit_number] },
        },
        request_identifier: l.permit_number,
        name: printedName,
        sunbiz_document_number: null,
      });
      const crel = `relationship_property_improvement_has_contractor_${n}.json`;
      permitFiles[crel] = jsonFile({ from: link(name), to: link(company) });
      contractorLinks.push(link(crel));
      counts.contractor_companies_printed += 1;
    }
    const rel = `relationship_property_has_property_improvement_${n}.json`;
    permitFiles[rel] = jsonFile({ from: link("property.json"), to: link(name) });
    links.push(link(rel));
  });

  const files: Record<string, string> =
    counts.emitted === 0
      ? {}
      : {
          ...buildSharedFiles({
            record: input.record,
            seed: input.seed,
            seedCid: input.cids.seed,
            ...(input.yearBuilt !== undefined ? { yearBuilt: input.yearBuilt } : {}),
          }),
          ...permitFiles,
          [`${input.cids.propertyImprovement}.json`]: jsonFile({
            label: "Property Improvement",
            relationships: {
              property_has_property_improvement: links,
              ...(contractorLinks.length > 0
                ? { property_improvement_has_contractor: contractorLinks }
                : {}),
            },
          }),
        };
  return { pID, dir: `${pID}/data`, files, counts, ledger };
}
