// T015 (A-03-TC-027, FR-011): the UI maps in packages/shared label every reason of the
// contract's closed list with the spec's string, verbatim (spec.md § Missing-reason labels,
// PO decision D-2 2026-10-21), name every manifest source, and derive every read-path URL
// from the configured hosts (CID_COPY_HOST, FILEBASE_GATEWAY_HOST, PINATA_GATEWAY_HOST).
// The whole file sits under one "A-03-TC-027" describe so `vitest run -t "A-03-TC-027"`
// (tests/e2e/build-checks.spec.ts) runs all of it.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MISSING_REASONS, type MissingReason } from "@countylens/contract";
import {
  COVERAGE_LABELS,
  INDEPENDENT_GATEWAYS,
  MISSING_REASON_LABELS,
  SOURCE_LABELS,
  assertMissingReasonLabels,
  isIndependentGateway,
  missingLabel,
  readPathUrls,
  sourceLabel,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");

function readJson(relPath: string): unknown {
  return JSON.parse(readFileSync(resolve(REPO, relPath), "utf8"));
}

/** spec.md § Missing-reason labels, copied verbatim (the oracle for this test). */
const SPEC_LABELS: Record<MissingReason, string> = {
  no_lexicon_carrier: "No place for this field in the published data model",
  not_in_export: "Not included in the published tables",
  source_missing: "Not on the source record",
  no_coordinates: "No coordinates for this parcel",
  no_roof_date: "No roof date found",
  basis_unmatched: "No roof-age basis matched",
  no_dated_sale: "No dated sale or deed on record",
  no_owner_record: "No owner record on the TCAD account",
  no_mailing_address: "No owner mailing address",
  zip_not_zcta: "ZIP is not a Census ZIP area",
  not_open: "Permit is not open",
  not_closed: "Permit is not closed",
  contractor_unresolved: "Contractor not matched to a company",
  bbb_blocked: "BBB blocked the lookup",
  bbb_not_found: "No BBB profile found",
  needs_review: "Needs review: could not be derived",
  first_run: "First run: no previous manifest",
  out_of_scope: "Outside Travis County",
  enum_lacks_value: "Status has no matching value (e.g. Expired)",
  owner_unparsed: "Owner name could not be parsed",
  owner_confidential: "Owner is confidential (TCAD)",
  superseded_by_later_permit: "Superseded by a later finished roofing permit",
};

/** The pilot manifest's CID (contract/v1/README.md): a real base32 CIDv1. */
const CID = "bafkreibkonskeytl2lqmaoethxvhegzjkwbeon4couanb4x26ng23cs3ka";

/** Deliberately not the production hosts: proves the helpers derive from config, not literals. */
const HOSTS = {
  cidCopyHost: "copy.example.test",
  filebaseGatewayHost: "filebase.example.test",
  pinataGatewayHost: "pinata.example.test",
  orbitorGatewayHost: "orbitor.example.test",
};

describe("A-03-TC-027: label map covers every reason in missingReasons (FR-011)", () => {
  describe("MISSING_REASON_LABELS", () => {
    it("contract/v1/columns.json missingReasons is the contract's MISSING_REASONS (22)", () => {
      const columns = readJson("contract/v1/columns.json") as { missingReasons: string[] };
      expect(columns.missingReasons).toEqual([...MISSING_REASONS]);
      expect(MISSING_REASONS).toHaveLength(22);
    });

    it("labels 22 of 22 reasons with the spec table strings, verbatim", () => {
      const gaps: string[] = [];
      for (const reason of MISSING_REASONS) {
        const label = MISSING_REASON_LABELS[reason];
        if (label !== SPEC_LABELS[reason]) gaps.push(`${reason}: ${JSON.stringify(label)}`);
      }
      expect(gaps).toEqual([]);
      expect(Object.keys(MISSING_REASON_LABELS)).toHaveLength(22);
    });

    it("has no label for a reason outside the closed list", () => {
      expect([...Object.keys(MISSING_REASON_LABELS)].sort()).toEqual([...MISSING_REASONS].sort());
    });

    it("passes the coverage check for the closed list", () => {
      expect(() => assertMissingReasonLabels(MISSING_REASONS)).not.toThrow();
      expect(() => assertMissingReasonLabels()).not.toThrow();
    });

    it("a fake reason added to a copy of missingReasons fails the check naming that reason", () => {
      const withFake = [...MISSING_REASONS, "fake_reason"];
      expect(() => assertMissingReasonLabels(withFake)).toThrow(/"fake_reason"/);
    });

    it("a reason removed from a copy of missingReasons fails the check naming the orphan label", () => {
      const withoutOne = MISSING_REASONS.filter((r) => r !== "first_run");
      expect(() => assertMissingReasonLabels(withoutOne)).toThrow(/first_run/);
    });
  });

  describe("missingLabel(field, reason)", () => {
    it('gives "Contractor not printed on permit" only for a contractor field with source_missing', () => {
      expect(missingLabel("contractor_name_raw", "source_missing")).toBe(
        "Contractor not printed on permit",
      );
      expect(missingLabel("contractor_company_cid", "source_missing")).toBe(
        "Contractor not printed on permit",
      );
      // Not a contractor field: the table label.
      expect(missingLabel("permit_number", "source_missing")).toBe("Not on the source record");
      expect(missingLabel("issue_date", "source_missing")).toBe("Not on the source record");
      // A contractor field with another reason: the table label.
      expect(missingLabel("contractor_company_cid", "contractor_unresolved")).toBe(
        "Contractor not matched to a company",
      );
      expect(missingLabel("contractor_name_raw", "no_lexicon_carrier")).toBe(
        "No place for this field in the published data model",
      );
    });

    it("keeps the table label for every reason on a non-contractor field", () => {
      for (const reason of MISSING_REASONS) {
        expect(missingLabel("owner_name", reason)).toBe(SPEC_LABELS[reason]);
      }
    });
  });

  describe("COVERAGE_LABELS (Runs page)", () => {
    it('labels permits_no_tcad_geoid "TCAD id matches no property account"', () => {
      expect(COVERAGE_LABELS.permits_no_tcad_geoid).toBe("TCAD id matches no property account");
    });
  });

  describe("SOURCE_LABELS (manifest sources[].name)", () => {
    it("maps the two A-03 sources to their display names (test plan § 3)", () => {
      expect(SOURCE_LABELS["austin-3syk-w9eu"]).toBe(
        "City of Austin Issued Construction Permits (3syk-w9eu)",
      );
      expect(SOURCE_LABELS["tcad-2026-certified-json"]).toBe("TCAD 2026 certified export");
      expect(sourceLabel("austin-3syk-w9eu")).toBe(SOURCE_LABELS["austin-3syk-w9eu"]);
    });

    it("names every source of the pilot manifest (contract/v1/pilot-manifest.json)", () => {
      const manifest = readJson("contract/v1/pilot-manifest.json") as {
        sources: { name: string }[];
      };
      expect(manifest.sources.length).toBeGreaterThan(0);
      for (const source of manifest.sources) {
        expect(sourceLabel(source.name)).toBeTruthy();
      }
    });

    it("throws on an unmapped source name, naming it", () => {
      expect(() => sourceLabel("austin-xxxx-yyyy")).toThrow(/"austin-xxxx-yyyy"/);
      expect(() => sourceLabel("")).toThrow();
    });
  });

  describe("read-path URLs (storage.md Public URL; derived from config hosts)", () => {
    it("copyUrl(cid) is https://{CID_COPY_HOST}/{cid}", () => {
      const { copyUrl } = readPathUrls(HOSTS);
      expect(copyUrl(CID)).toBe(`https://${HOSTS.cidCopyHost}/${CID}`);
    });

    it("gatewayUrl(cid, 'filebase' | 'pinata') is https://{*_GATEWAY_HOST}/ipfs/{cid}", () => {
      const { gatewayUrl, gatewayHost } = readPathUrls(HOSTS);
      expect(gatewayUrl(CID, "filebase")).toBe(`https://${HOSTS.filebaseGatewayHost}/ipfs/${CID}`);
      expect(gatewayUrl(CID, "pinata")).toBe(`https://${HOSTS.pinataGatewayHost}/ipfs/${CID}`);
      // The fallback label is "fallback · {host}": the host must be reachable as configured.
      expect(gatewayHost("filebase")).toBe(HOSTS.filebaseGatewayHost);
      expect(gatewayHost("pinata")).toBe(HOSTS.pinataGatewayHost);
      expect(gatewayUrl(CID, "orbitor")).toBe(`https://${HOSTS.orbitorGatewayHost}/ipfs/${CID}`);
      expect(gatewayHost("orbitor")).toBe(HOSTS.orbitorGatewayHost);
    });

    it("Pinata and orbitor are the independent Verify gateways; Filebase never is (AM-10)", () => {
      expect(INDEPENDENT_GATEWAYS).toEqual(["pinata", "orbitor"]);
      expect(isIndependentGateway("pinata")).toBe(true);
      expect(isIndependentGateway("orbitor")).toBe(true);
      expect(isIndependentGateway("filebase")).toBe(false);
    });

    it("changes with the configured hosts (nothing is remembered from an earlier config)", () => {
      const a = readPathUrls(HOSTS);
      const b = readPathUrls({ ...HOSTS, cidCopyHost: "other.example.test" });
      expect(a.copyUrl(CID)).not.toBe(b.copyUrl(CID));
      expect(b.copyUrl(CID)).toBe(`https://other.example.test/${CID}`);
    });

    it("pinata is optional (the web build and the Lambda have no PINATA_GATEWAY_HOST)", () => {
      const { gatewayUrl, gatewayHost } = readPathUrls({
        cidCopyHost: HOSTS.cidCopyHost,
        filebaseGatewayHost: HOSTS.filebaseGatewayHost,
      });
      expect(gatewayUrl(CID, "filebase")).toBe(`https://${HOSTS.filebaseGatewayHost}/ipfs/${CID}`);
      expect(() => gatewayUrl(CID, "pinata")).toThrow(/PINATA_GATEWAY_HOST/);
      expect(() => gatewayHost("pinata")).toThrow(/PINATA_GATEWAY_HOST/);
      expect(() => gatewayUrl(CID, "orbitor")).toThrow(/ORBITOR_GATEWAY_HOST/);
    });

    it("refuses anything that is not a CIDv1 (A3: CIDv1 only)", () => {
      const { copyUrl, gatewayUrl } = readPathUrls(HOSTS);
      const cidV0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
      expect(() => copyUrl(cidV0)).toThrow(/CIDv1/);
      expect(() => gatewayUrl(cidV0, "filebase")).toThrow(/CIDv1/);
      expect(() => copyUrl(`https://ipfs.io/ipfs/${CID}`)).toThrow(/CIDv1/);
      expect(() => copyUrl("")).toThrow(/CIDv1/);
    });

    it("refuses a host that carries a scheme, port or path (hosts are bare hostnames)", () => {
      expect(() => readPathUrls({ ...HOSTS, cidCopyHost: "https://copy.example.test" })).toThrow(
        /CID_COPY_HOST/,
      );
      expect(() =>
        readPathUrls({ ...HOSTS, filebaseGatewayHost: "filebase.example.test/ipfs" }),
      ).toThrow(/FILEBASE_GATEWAY_HOST/);
      expect(() =>
        readPathUrls({ ...HOSTS, pinataGatewayHost: "pinata.example.test:8080" }),
      ).toThrow(/PINATA_GATEWAY_HOST/);
      expect(() =>
        readPathUrls({ ...HOSTS, orbitorGatewayHost: "https://orbitor.example.test" }),
      ).toThrow(/ORBITOR_GATEWAY_HOST/);
      expect(() => readPathUrls({ ...HOSTS, cidCopyHost: "" })).toThrow(/CID_COPY_HOST/);
    });

    it("stores no gateway or copy URL: src/urls.ts carries no host literal", () => {
      const source = readFileSync(resolve(HERE, "../src/urls.ts"), "utf8");
      expect(source).not.toMatch(/https?:\/\/[a-z0-9]/i);
      expect(source).not.toMatch(
        /ipfs\.filebase\.io|gateway\.pinata\.cloud|ipfs\.orbitor\.dev|cloudfront\.net|ipfs\.io|dweb\.link|w3s\.link/i,
      );
    });
  });
});
