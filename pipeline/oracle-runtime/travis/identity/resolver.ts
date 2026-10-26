// A-07 T014 (Track A): the resolver contract (specs/007-enrich-reconcile/contracts/resolver.md).
// One Austin permit (already profile-classified upstream) + the loaded Comptroller registry snapshot -> one
// `Contractor resolution ledger row` (data-model.md), append-only. No DB access here: this is
// a pure function over its inputs, so the Loader track (T017) can call it per permit inside a
// transaction and the resolution run (T020) can call it in a batch.
//
// Decision order (never falls through to a name match once an earlier step fires):
//   1. no printed name                      -> unresolved / contractor_not_printed
//   2. registry not loaded/unreachable      -> unresolved / registry_unavailable
//   3. an identifier crosswalk match exists -> resolved   (none found live this run, D-10;
//                                               AC-2's fixture-fallback clause proves the path)
//   4. normalised name matches exactly one active legal name -> candidate
//   5. normalised name matches two+ active legal names       -> ambiguous (all kept)
//   6. normalised name matches a legal name whose status is not active -> conflicting
//   7. no match                              -> unresolved (no reason code; distinct from 1-2)
import type { CrosswalkIndex } from "./crosswalk.js";

export const MATCH_RULE = "normalize-name-v1";
export const RESOLVER_VERSION = "1.0.0";
export const ACTIVE_STATUS = "active";

export type ResolverState = "resolved" | "candidate" | "ambiguous" | "conflicting" | "unresolved";

/** One row of the loaded Comptroller registry snapshot (data-model.md's Company record, read-only here). */
export interface RegistryRecord {
  taxpayerNumber: string;
  legalName: string;
  sosStatusCode: string;
}

export interface ResolverInput {
  permitKey: string;
  rawContractorName: string | null;
  /** False when the shared adapter's load has not completed, or its snapshot is stale/missing. */
  registryLoaded: boolean;
  registry: readonly RegistryRecord[];
  registrySnapshotDigest: string;
  /** permitKey -> Comptroller taxpayer number. Live production value: crosswalk.ts's LIVE_CROSSWALK (empty). */
  crosswalk?: CrosswalkIndex;
  /** ISO-8601; defaults to now (tests pin this for determinism). */
  effectiveOn?: string;
}

export interface LedgerRow {
  permitKey: string;
  rawContractorName: string | null;
  state: ResolverState;
  reasonCode: string | null;
  matchedRecordIds: string[];
  matchRule: string;
  resolverVersion: string;
  registrySnapshotDigest: string;
  effectiveOn: string;
}

const PUNCTUATION = /[.,'’]/g;
const WHITESPACE = /\s+/g;

/**
 * Versioned (matchRule = `normalize-name-v1`) normalisation: uppercase, strip punctuation,
 * collapse whitespace, then expand common legal-suffix abbreviations so "Roofing Co." and
 * "ROOFING COMPANY" compare equal. This never changes the candidate/resolved boundary
 * (resolver.md): only an identifier crosswalk match (step 3) ever produces `resolved`.
 */
const SUFFIX_EXPANSIONS: Readonly<Record<string, string>> = Object.freeze({
  CO: "COMPANY",
  CORP: "CORPORATION",
  INC: "INCORPORATED",
  LTD: "LIMITED",
});

export function normalizeContractorName(raw: string): string {
  const stripped = raw.toUpperCase().replace(PUNCTUATION, "").replace(WHITESPACE, " ").trim();
  if (stripped === "") return stripped;
  return stripped
    .split(" ")
    .map((token) => SUFFIX_EXPANSIONS[token] ?? token)
    .join(" ");
}

export function isActiveStatus(code: string): boolean {
  return code.trim().toLowerCase() === ACTIVE_STATUS;
}

export function resolveContractor(input: ResolverInput): LedgerRow {
  const effectiveOn = input.effectiveOn ?? new Date().toISOString();
  const base = {
    permitKey: input.permitKey,
    rawContractorName: input.rawContractorName,
    matchRule: MATCH_RULE,
    resolverVersion: RESOLVER_VERSION,
    registrySnapshotDigest: input.registrySnapshotDigest,
    effectiveOn,
  };

  // 1: no printed name
  if (input.rawContractorName === null || input.rawContractorName.trim() === "") {
    return {
      ...base,
      state: "unresolved",
      reasonCode: "contractor_not_printed",
      matchedRecordIds: [],
    };
  }

  // 2: registry not loaded/unreachable
  if (!input.registryLoaded) {
    return {
      ...base,
      state: "unresolved",
      reasonCode: "registry_unavailable",
      matchedRecordIds: [],
    };
  }

  // 3: an official identifier crosswalk match (checked before any name match, per AD-05/D-10)
  const crosswalkMatch = input.crosswalk?.get(input.permitKey);
  if (crosswalkMatch !== undefined) {
    return { ...base, state: "resolved", reasonCode: null, matchedRecordIds: [crosswalkMatch] };
  }

  const normalized = normalizeContractorName(input.rawContractorName);
  const matches = input.registry.filter((r) => normalizeContractorName(r.legalName) === normalized);
  const active = matches.filter((r) => isActiveStatus(r.sosStatusCode));

  // 4: exactly one active match
  const onlyActive = active[0];
  if (active.length === 1 && onlyActive !== undefined) {
    return {
      ...base,
      state: "candidate",
      reasonCode: null,
      matchedRecordIds: [onlyActive.taxpayerNumber],
    };
  }

  // 5: two or more active matches, all kept
  if (active.length >= 2) {
    return {
      ...base,
      state: "ambiguous",
      reasonCode: null,
      matchedRecordIds: active.map((r) => r.taxpayerNumber),
    };
  }

  // 6: a match exists but none is active -> conflicting, status shown via matched records
  if (matches.length > 0) {
    return {
      ...base,
      state: "conflicting",
      reasonCode: null,
      matchedRecordIds: matches.map((r) => r.taxpayerNumber),
    };
  }

  // 7: no match at all (distinct from steps 1-2: no reason code)
  return { ...base, state: "unresolved", reasonCode: null, matchedRecordIds: [] };
}
