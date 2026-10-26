// A-07 T011 (Track A): resolver contract tests (specs/007-enrich-reconcile/contracts/resolver.md).
// Must fail before T014 (travis/identity/resolver.ts) lands. Covers the five-state decision
// order and its short-circuit (never falls through to a name match once an earlier step fires).
import { describe, expect, it } from "vitest";
import {
  MATCH_RULE,
  RESOLVER_VERSION,
  normalizeContractorName,
  resolveContractor,
  type RegistryRecord,
} from "../../../../travis/identity/resolver.js";
import { buildCrosswalkIndex } from "../../../../travis/identity/crosswalk.js";

const DIGEST = "a".repeat(64);
const EFFECTIVE_ON = "2026-10-22T00:00:00.000Z";

const active = (taxpayerNumber: string, legalName: string): RegistryRecord => ({
  taxpayerNumber,
  legalName,
  sosStatusCode: "active",
});

describe("resolveContractor (FR-001, FR-004, FR-005)", () => {
  it("1: no printed name -> unresolved, contractor_not_printed, stops before the registry check", () => {
    const row = resolveContractor({
      permitKey: "2026-000001 BP",
      rawContractorName: null,
      registryLoaded: false, // both triggers present; the printed-name check must fire first
      registry: [],
      registrySnapshotDigest: DIGEST,
      effectiveOn: EFFECTIVE_ON,
    });
    expect(row.state).toBe("unresolved");
    expect(row.reasonCode).toBe("contractor_not_printed");
    expect(row.matchedRecordIds).toEqual([]);
    expect(row.matchRule).toBe(MATCH_RULE);
    expect(row.resolverVersion).toBe(RESOLVER_VERSION);
  });

  it("2: registry not loaded -> unresolved, registry_unavailable", () => {
    const row = resolveContractor({
      permitKey: "2026-000002 BP",
      rawContractorName: "Roofing Co.",
      registryLoaded: false,
      registry: [],
      registrySnapshotDigest: DIGEST,
      effectiveOn: EFFECTIVE_ON,
    });
    expect(row.state).toBe("unresolved");
    expect(row.reasonCode).toBe("registry_unavailable");
    expect(row.matchedRecordIds).toEqual([]);
  });

  it("3: an identifier crosswalk match -> resolved, cites the matched taxpayer number", () => {
    // AC-2's fixture-fallback clause (D-10): no live crosswalk exists this run, but the
    // `resolved` code path is proven against a labelled fixture index (T012, crosswalk.test.ts).
    const crosswalk = buildCrosswalkIndex([
      { permitKey: "2026-000003 BP", taxpayerNumber: "32099999999" },
    ]);
    const row = resolveContractor({
      permitKey: "2026-000003 BP",
      rawContractorName: "Anything Printed On The Permit",
      registryLoaded: true,
      registry: [],
      registrySnapshotDigest: DIGEST,
      crosswalk,
      effectiveOn: EFFECTIVE_ON,
    });
    expect(row.state).toBe("resolved");
    expect(row.reasonCode).toBeNull();
    expect(row.matchedRecordIds).toEqual(["32099999999"]);
  });

  it("4: abbreviation/punctuation normalisation matches exactly one active name -> candidate, never resolved", () => {
    const row = resolveContractor({
      permitKey: "2026-000004 BP",
      rawContractorName: "Roofing Co.",
      registryLoaded: true,
      registry: [active("32000000001", "ROOFING COMPANY")],
      registrySnapshotDigest: DIGEST,
      effectiveOn: EFFECTIVE_ON,
    });
    expect(row.state).toBe("candidate");
    expect(row.state).not.toBe("resolved");
    expect(row.matchedRecordIds).toEqual(["32000000001"]);
  });

  it("5: two active same-name records -> ambiguous, both kept", () => {
    const row = resolveContractor({
      permitKey: "2026-000005 BP",
      rawContractorName: "Roofing Company",
      registryLoaded: true,
      registry: [
        active("32000000002", "ROOFING COMPANY"),
        active("32000000003", "Roofing Company"),
      ],
      registrySnapshotDigest: DIGEST,
      effectiveOn: EFFECTIVE_ON,
    });
    expect(row.state).toBe("ambiguous");
    expect(row.reasonCode).toBeNull();
    expect(new Set(row.matchedRecordIds)).toEqual(new Set(["32000000002", "32000000003"]));
  });

  it("6: a matching legal name whose sos_status_code is not active -> conflicting, status shown", () => {
    const row = resolveContractor({
      permitKey: "2026-000006 BP",
      rawContractorName: "Roofing Company",
      registryLoaded: true,
      registry: [
        { taxpayerNumber: "32000000004", legalName: "Roofing Company", sosStatusCode: "forfeited" },
      ],
      registrySnapshotDigest: DIGEST,
      effectiveOn: EFFECTIVE_ON,
    });
    expect(row.state).toBe("conflicting");
    expect(row.matchedRecordIds).toEqual(["32000000004"]);
  });

  it("7: no match at all -> unresolved, distinct from steps 1-2 (no reason code)", () => {
    const row = resolveContractor({
      permitKey: "2026-000007 BP",
      rawContractorName: "Nobody Matches This LLC",
      registryLoaded: true,
      registry: [active("32000000005", "Some Other Company")],
      registrySnapshotDigest: DIGEST,
      effectiveOn: EFFECTIVE_ON,
    });
    expect(row.state).toBe("unresolved");
    expect(row.reasonCode).toBeNull();
    expect(row.matchedRecordIds).toEqual([]);
  });
});

describe("normalizeContractorName", () => {
  it("expands the Co./Corp./Inc./Ltd. abbreviations and strips punctuation", () => {
    expect(normalizeContractorName("Roofing Co.")).toBe("ROOFING COMPANY");
    expect(normalizeContractorName("ROOFING COMPANY")).toBe("ROOFING COMPANY");
  });
});
