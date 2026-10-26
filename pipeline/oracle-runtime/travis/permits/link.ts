// A-04 T054 (AC-13, FR-013, FR-022, AD-16): link an Austin permit to a TCAD account.
// Austin `tcad_id` carries the TCAD geoID (10 digits, leading zeros kept); the property key is
// the TCAD pID (`request_identifier`), reached through `parcel_geoids`. Only R accounts are
// link targets. Method, rule and confidence are recorded on every row:
//
//   tcad_id = a geoID with exactly one R account      → tcad_id / geoid_unique_r      (1.00)
//   tcad_id = a geoID shared by several R accounts    → tcad_id / geoid_plus_address  (0.95)
//       only when exactly one candidate's situs signature equals the permit's; otherwise
//       unmatched `ambiguous_geoid` (a shared geoID is never linked silently)
//   tcad_id present but on no R account (retired)     → the same exact address signature is
//       tried (lead decision 2026-10-22, AC-13 "by tcad_id or address hash"): exactly one R
//       account → address_hash / address_sig_v1 with `staleTcadId` set; none or several →
//       unmatched `no_tcad_geoid`. A tcad_id that resolves is never overridden by the address.
//   tcad_id null                                      → address fallback over every R situs,
//       exact `address:v1` signature, unique only     → address_hash / address_sig_v1 (0.90);
//       several → `ambiguous_address`; none → `address_unmatched`; no usable address
//       (street + ZIP5) → `no_tcad_id`
//
// The signature is the vendored kit `core/address-signature.mjs` (`address:v1`: NFKC, lower
// case, ZIP5, no ROAD→RD or NORTH→N expansion), over the permit's `original_address1`,
// `original_zip`, `original_state` (Austin has no unit column: unit empty) and the TCAD situs
// (num prefix name suffix as street, `streetSecondary` as unit; a missing situs state is TX,
// the county's state). `in_travis` is false for an unmatched permit whose ZIP is not a Travis
// ZCTA (gazetteer travis-places@1.0.0): counted separately, never dropped.
// `issuing_jurisdiction` is always `austin`: the source `jurisdiction` column (e.g.
// LAKEWAY FULL PURPOSE) is where the permit is located, not who issued it (FR-022).
import { ownerArea } from "../../../../packages/query-core/gazetteer/travis-places@1.0.0/index.js";

interface AddressIdentity {
  signature: string;
  elephantToken: string;
  elephantUuid: string;
}
interface AddressSignatureModule {
  mintAddressIdentity(input: {
    country?: string | null;
    state: unknown;
    postalCode: unknown;
    street: unknown;
    unit?: unknown;
  }): AddressIdentity | null;
}

// The vendored kit module (plain .mjs, unmodified, AD-17) loaded by URL: it has no type
// declarations, so its one function is typed here.
const kit = (await import(
  new URL("../../kit/use-oracle/runtime/src/core/address-signature.mjs", import.meta.url).href
)) as AddressSignatureModule;

export const ISSUING_JURISDICTION = "austin";
export const DEFAULT_STATE = "TX";

export type LinkMethod = "tcad_id" | "address_hash";
export type LinkRule = "geoid_unique_r" | "geoid_plus_address" | "address_sig_v1";
export type UnmatchedReason =
  "no_tcad_id" | "no_tcad_geoid" | "address_unmatched" | "ambiguous_geoid" | "ambiguous_address";

export const LINK_CONFIDENCE: Readonly<Record<LinkRule, number>> = Object.freeze({
  geoid_unique_r: 1,
  geoid_plus_address: 0.95,
  address_sig_v1: 0.9,
});

/** A TCAD situs as the export prints it (situses[]); extra keys are ignored. */
export interface SitusLike {
  streetNum?: string | null;
  streetPrefix?: string | null;
  streetName?: string | null;
  streetSuffix?: string | null;
  streetSecondary?: string | null;
  state?: string | null;
  zip?: string | null;
}

export interface ParcelCandidate {
  requestIdentifier: string;
  geoId: string | null;
  propType: string;
  situs: SitusLike | null;
}

export interface PermitAddress {
  tcadId: string | null;
  address1: string | null;
  zip: string | null;
  state: string | null;
  unit?: string | null;
}

export interface LinkResult {
  requestIdentifier: string | null;
  linkMethod: LinkMethod | null;
  linkRule: LinkRule | null;
  linkConfidence: number | null;
  unmatchedReason: UnmatchedReason | null;
  inTravis: boolean;
  addressSignatureComputed: boolean;
  /** The permit's tcad_id is on no R account and the link came from the address instead. */
  staleTcadId: boolean;
}

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

/** The `address:v1` token of a TCAD situs, or null when street or ZIP is missing. */
export function situsSignature(s: SitusLike | null): string | null {
  if (s === null) return null;
  const street = [s.streetNum, s.streetPrefix, s.streetName, s.streetSuffix]
    .map((p) => str(p))
    .filter((p): p is string => p !== null)
    .join(" ");
  return (
    kit.mintAddressIdentity({
      state: str(s.state) ?? DEFAULT_STATE,
      postalCode: str(s.zip),
      street,
      unit: str(s.streetSecondary),
    })?.elephantToken ?? null
  );
}

/** The `address:v1` token of a permit's address, or null when it is not usable. */
export function permitSignature(p: PermitAddress): string | null {
  return (
    kit.mintAddressIdentity({
      state: str(p.state) ?? DEFAULT_STATE,
      postalCode: str(p.zip),
      street: str(p.address1),
      unit: str(p.unit ?? null),
    })?.elephantToken ?? null
  );
}

export interface LinkIndex {
  /** R accounts by geoID, each with its situs signature. */
  byGeoId: ReadonlyMap<string, readonly { requestIdentifier: string; signature: string | null }[]>;
  /** R accounts by situs signature (distinct pIDs). */
  bySignature: ReadonlyMap<string, readonly string[]>;
}

export function buildLinkIndex(parcels: Iterable<ParcelCandidate>): LinkIndex {
  const byGeoId = new Map<string, { requestIdentifier: string; signature: string | null }[]>();
  const bySignature = new Map<string, Set<string>>();
  for (const p of parcels) {
    if (p.propType !== "R") continue;
    const signature = situsSignature(p.situs);
    const geo = str(p.geoId);
    if (geo !== null) {
      const list = byGeoId.get(geo) ?? [];
      if (!list.some((c) => c.requestIdentifier === p.requestIdentifier)) {
        list.push({ requestIdentifier: p.requestIdentifier, signature });
      }
      byGeoId.set(geo, list);
    }
    if (signature !== null) {
      const set = bySignature.get(signature) ?? new Set<string>();
      set.add(p.requestIdentifier);
      bySignature.set(signature, set);
    }
  }
  return {
    byGeoId,
    bySignature: new Map([...bySignature].map(([k, v]) => [k, [...v].sort()])),
  };
}

const inTravis = (zip: string | null): boolean => ownerArea(zip).class === "in_county";

const linked = (
  requestIdentifier: string,
  linkMethod: LinkMethod,
  linkRule: LinkRule,
  addressSignatureComputed: boolean,
  staleTcadId = false,
): LinkResult => ({
  requestIdentifier,
  linkMethod,
  linkRule,
  linkConfidence: LINK_CONFIDENCE[linkRule],
  unmatchedReason: null,
  inTravis: true,
  addressSignatureComputed,
  staleTcadId,
});

const unmatched = (
  reason: UnmatchedReason,
  zip: string | null,
  addressSignatureComputed: boolean,
): LinkResult => ({
  requestIdentifier: null,
  linkMethod: null,
  linkRule: null,
  linkConfidence: null,
  unmatchedReason: reason,
  inTravis: inTravis(zip),
  addressSignatureComputed,
  staleTcadId: false,
});

export function linkPermit(index: LinkIndex, permit: PermitAddress): LinkResult {
  const tcadId = str(permit.tcadId);
  const zip = str(permit.zip);
  if (tcadId !== null) {
    const candidates = index.byGeoId.get(tcadId) ?? [];
    if (candidates.length === 0) {
      const stale = permitSignature(permit);
      if (stale === null) return unmatched("no_tcad_geoid", zip, false);
      const hits = index.bySignature.get(stale) ?? [];
      return hits.length === 1
        ? linked(hits[0] as string, "address_hash", "address_sig_v1", true, true)
        : unmatched("no_tcad_geoid", zip, true);
    }
    if (candidates.length === 1) {
      return linked(
        (candidates[0] as { requestIdentifier: string }).requestIdentifier,
        "tcad_id",
        "geoid_unique_r",
        false,
      );
    }
    const signature = permitSignature(permit);
    const hits = signature === null ? [] : candidates.filter((c) => c.signature === signature);
    return hits.length === 1
      ? linked(
          (hits[0] as { requestIdentifier: string }).requestIdentifier,
          "tcad_id",
          "geoid_plus_address",
          true,
        )
      : unmatched("ambiguous_geoid", zip, true);
  }
  const signature = permitSignature(permit);
  if (signature === null) return unmatched("no_tcad_id", zip, true);
  const hits = index.bySignature.get(signature) ?? [];
  if (hits.length === 1) return linked(hits[0] as string, "address_hash", "address_sig_v1", true);
  return unmatched(hits.length === 0 ? "address_unmatched" : "ambiguous_address", zip, true);
}

/** The issuing jurisdiction of an Austin `3syk-w9eu` row: always Austin (FR-022). */
export function issuingJurisdiction(_row: Readonly<Record<string, unknown>>): string {
  return ISSUING_JURISDICTION;
}

/** Where the permit is located (the source `jurisdiction` column), or null. */
export const locatedJurisdiction = (row: Readonly<Record<string, unknown>>): string | null =>
  str(row.jurisdiction);

/** The link inputs of an Austin row. */
export function permitAddress(row: Readonly<Record<string, unknown>>): PermitAddress {
  return {
    tcadId: str(row.tcad_id),
    address1: str(row.original_address1),
    zip: str(row.original_zip),
    state: str(row.original_state),
    unit: null,
  };
}
