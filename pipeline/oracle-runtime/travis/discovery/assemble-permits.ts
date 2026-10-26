// T032 (assembly half): turns the Census probe, the curated profile and one evidence capture
// per jurisdiction into the catalog's `permits` block and `census_reference`. Pure, no I/O.
//
// Rules applied here:
// - expected_jurisdiction_count = Census place_count + 1 (unincorporated); never hard-coded;
// - each row's validator status comes from status-map.ts (research R3);
// - evidence_captured_at and evidence_http_status come from the capture, never the profile;
// - an evidence page that answers 403, a challenge or a timeout makes the row
//   `records request` / `blocked` with blocked_evidence and keeps its records request;
// - every row that is not supported gets `blocked_explanation` (PO decision 2026-10-20:
//   no request is filed), built from the assembled row only (jurisdiction-explanation.ts);
// - Austin-issued counts located in a city are attached to that row as information only,
//   with their full-purpose (inside the city limits) and ETJ parts (OR-m6);
// - a stop whose saved response names a web application firewall is explained as a block
//   by that firewall, whatever its status (OR-M2).
import type { CaptureReceipt } from "../lib/source-client.js";
import type { Catalog, Jurisdiction } from "./catalog.schema.js";
import { BLOCKED_EVIDENCE_DIR, blockedEvidence } from "./assemble.js";
import {
  austinIssuedMeasurement,
  austinIssuedSplit,
  type AustinLocatedEntry,
} from "./austin-issued.js";
import {
  BLOCKED_NOTE,
  firewallBlock,
  savedStop,
  withExplanation,
} from "./jurisdiction-explanation.js";
import { missingReason, stopsSource } from "./probes/common.js";
import type { CensusProbe, CensusReference } from "./probes/census.js";
import type { EvidenceProbe } from "./probes/evidence.js";
import { mapStatus, resolveJurisdictionStatus } from "./status-map.js";
import {
  compareProfileToCensus,
  type JurisdictionProfileEntry,
} from "../profiles/jurisdictions.js";

export type Permits = NonNullable<Catalog["permits"]>;

export interface JurisdictionBlocks {
  permits: Permits;
  census_reference: CensusReference | null;
  /** Census places without a profile entry, and profile entries not in the Census list. */
  profile_mismatch: { missing: string[]; extra: string[] };
}

export interface AssemblePermitsOptions {
  /** Repository-relative evidence file for a blocked evidence page (written by T037). */
  evidencePath?: (jurisdictionKey: string, receipt: CaptureReceipt) => string;
}

export function defaultJurisdictionEvidencePath(key: string, receipt: CaptureReceipt): string {
  const stamp = receipt.captured_at.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${BLOCKED_EVIDENCE_DIR}/jurisdiction-${key}-${stamp}.md`;
}

function blockedRow(
  entry: JurisdictionProfileEntry,
  receipt: CaptureReceipt,
  evidencePath: (jurisdictionKey: string, receipt: CaptureReceipt) => string,
): Partial<Jurisdiction> {
  const mapping = mapStatus("records request", "portal-blocked");
  const path = evidencePath(entry.key, receipt);
  const note = `evidence page blocked at the live run (${missingReason(receipt)}); ${BLOCKED_NOTE}`;
  return {
    spec_class: mapping.spec_class,
    status: mapping.status,
    historical_records: false,
    blocked_evidence: blockedEvidence(receipt, path),
    notes: entry.notes ? `${note}. Profile: ${entry.notes}` : note,
  };
}

export function assembleJurisdictionRow(
  entry: JurisdictionProfileEntry,
  evidence: EvidenceProbe,
  located: readonly AustinLocatedEntry[],
  opts: AssemblePermitsOptions = {},
): Jurisdiction {
  const receipt = evidence.blocked_receipt ?? evidence.receipts.at(-1) ?? null;
  if (!receipt) throw new Error(`assemble-permits: no evidence capture for ${entry.key}`);
  const resolved = resolveJurisdictionStatus(
    entry.portal_kind === undefined
      ? { spec_class: entry.spec_class, case: entry.case }
      : { spec_class: entry.spec_class, case: entry.case, portal_kind: entry.portal_kind },
  );
  const row: Jurisdiction = {
    jurisdiction: entry.jurisdiction,
    key: entry.key,
    spec_class: entry.spec_class,
    status: resolved.status,
    historical_records: resolved.historical_records,
    evidence_url: entry.evidence_url,
    evidence_captured_at: receipt.captured_at,
  };
  if (entry.census_placefp !== null) row.census_placefp = entry.census_placefp;
  if (entry.portal_kind !== undefined) row.portal_kind = entry.portal_kind;
  if (entry.portal !== undefined) row.portal = entry.portal;
  if (entry.vendor !== undefined) row.vendor = entry.vendor;
  if (receipt.status !== null) row.evidence_http_status = receipt.status;
  if (entry.earliest_record_date !== undefined && resolved.status === "supported") {
    row.earliest_record_date = entry.earliest_record_date;
  }
  if (entry.records_request !== undefined) row.records_request = entry.records_request;
  if (entry.issued_by !== undefined) row.issued_by = entry.issued_by;
  if (entry.notes !== undefined) row.notes = entry.notes;

  if (stopsSource(receipt)) {
    Object.assign(
      row,
      blockedRow(entry, receipt, opts.evidencePath ?? defaultJurisdictionEvidencePath),
    );
    delete row.earliest_record_date;
    // An intake portal kind stays recorded; it is consistent with historical_records: false.
  }

  Object.assign(row, austinIssuedFields(entry.jurisdiction, entry.key, located));
  return withExplanation(row, {
    challengeSignal: receipt.challenge_signal ?? null,
    firewall: stopsSource(receipt) ? firewallBlock(savedStop(receipt)) : null,
  });
}

/** The Austin-issued total and its full-purpose / ETJ parts for one city row (FR-004c). */
export function austinIssuedFields(
  name: string,
  key: string,
  located: readonly AustinLocatedEntry[],
): Pick<
  Jurisdiction,
  "austin_issued_located_here" | "austin_issued_full_purpose" | "austin_issued_etj"
> {
  if (key === "austin") return {};
  const total = austinIssuedMeasurement(name, located);
  const split = austinIssuedSplit(name, located);
  if (!total || !split) return {};
  return {
    austin_issued_located_here: total,
    austin_issued_full_purpose: split.full_purpose,
    austin_issued_etj: split.etj,
  };
}

export function assemblePermits(
  census: CensusProbe,
  profile: readonly JurisdictionProfileEntry[],
  evidence: Readonly<Record<string, EvidenceProbe>>,
  located: readonly AustinLocatedEntry[],
  opts: AssemblePermitsOptions = {},
): JurisdictionBlocks {
  const comparison = compareProfileToCensus(profile, census.places);
  const jurisdictions = profile.map((entry) => {
    const captured = evidence[entry.key];
    if (!captured) throw new Error(`assemble-permits: no evidence probe result for ${entry.key}`);
    return assembleJurisdictionRow(entry, captured, located, opts);
  });
  const reference = census.census_reference;
  return {
    permits: {
      // Census missing: 0 keeps the validator and rule 6 failing instead of guessing.
      expected_jurisdiction_count: reference ? reference.place_count + 1 : 0,
      assumes_unified_countywide_history: false,
      jurisdictions,
    },
    census_reference: reference,
    profile_mismatch: reference
      ? {
          missing: comparison.missing.map((p) => `${p.placefp} ${p.census_name}`),
          extra: comparison.extra.map((e) => `${e.census_placefp ?? "null"} ${e.jurisdiction}`),
        }
      : { missing: [], extra: [] },
  };
}
