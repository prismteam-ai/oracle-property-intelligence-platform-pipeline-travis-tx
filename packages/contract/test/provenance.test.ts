// T006: the Provenance schema and the closed missing-reason enum (data-model.md § Provenance).
import { describe, expect, it } from "vitest";
import { MISSING_REASONS, Missing, MissingReason, Provenance } from "../src/index.js";

const CID_RAW = "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu";
const CID_DAG_JSON = "baguqeerasords4njcts6vs7qvdjfcvgnume4hqohf65zsfguprqphs3icwea";

function valid(): Record<string, unknown> {
  return {
    cid: CID_DAG_JSON,
    source_url:
      "https://data.austintexas.gov/resource/3syk-w9eu.json?permit_number=2026-034767%20BP",
    captured_at: "2026-10-20T23:00:00.000Z",
    table: "property_improvement",
    table_cid: CID_RAW,
    run_id: "travis-pilot-20261020",
    manifest_cid: CID_RAW,
    as_of: "2026-10-20T23:10:00.000Z",
    missing: [{ field: "status_raw", reason: "no_lexicon_carrier" }],
  };
}

describe("MissingReason", () => {
  it("is exactly the closed list from data-model.md (mew B.7 + zip_not_zcta, D-4c)", () => {
    expect([...MISSING_REASONS]).toEqual([
      "no_lexicon_carrier",
      "not_in_export",
      "source_missing",
      "no_coordinates",
      "no_roof_date",
      "basis_unmatched",
      "no_dated_sale",
      "no_owner_record",
      "no_mailing_address",
      "zip_not_zcta",
      "not_open",
      "not_closed",
      "contractor_unresolved",
      "bbb_blocked",
      "bbb_not_found",
      "needs_review",
      "first_run",
      "out_of_scope",
      // D-9 (additive): the carrier exists but its enum has no value for the source word.
      "enum_lacks_value",
      // D-9 (additive, donphan M1): why an owner is missing although a dated sale exists.
      "owner_unparsed",
      "owner_confidential",
      "superseded_by_later_permit",
    ]);
    expect(MissingReason.options).toEqual([...MISSING_REASONS]);
  });

  it("rejects a reason outside the list (oracle's draft names are not members)", () => {
    expect(MissingReason.safeParse("no_deed_date").success).toBe(false);
    expect(MissingReason.safeParse("not_emitted_by_export").success).toBe(false);
  });

  it("Missing is {field, reason} and nothing else", () => {
    expect(Missing.parse({ field: "tenure_years", reason: "no_dated_sale" })).toEqual({
      field: "tenure_years",
      reason: "no_dated_sale",
    });
    expect(Missing.safeParse({ field: "", reason: "no_dated_sale" }).success).toBe(false);
    expect(Missing.safeParse({ field: "x", reason: "no_dated_sale", note: "extra" }).success).toBe(
      false,
    );
  });
});

describe("Provenance", () => {
  it("accepts a complete provenance block", () => {
    expect(Provenance.parse(valid())).toEqual(valid());
  });

  it("allows a null source_url only as data (the row's missing list carries not_in_export)", () => {
    const p = {
      ...valid(),
      source_url: null,
      missing: [{ field: "source_url", reason: "not_in_export" }],
    };
    expect(Provenance.safeParse(p).success).toBe(true);
  });

  for (const field of ["cid", "table", "table_cid", "run_id", "manifest_cid", "as_of"]) {
    it(`rejects a null ${field}`, () => {
      expect(Provenance.safeParse({ ...valid(), [field]: null }).success).toBe(false);
    });
    it(`rejects a missing ${field}`, () => {
      const p = Object.fromEntries(Object.entries(valid()).filter(([k]) => k !== field));
      expect(Provenance.safeParse(p).success).toBe(false);
    });
  }

  it("rejects a CIDv0 or a gateway URL in a CID column", () => {
    expect(
      Provenance.safeParse({
        ...valid(),
        table_cid: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
      }).success,
    ).toBe(false);
    expect(
      Provenance.safeParse({ ...valid(), manifest_cid: `https://ipfs.io/ipfs/${CID_RAW}` }).success,
    ).toBe(false);
  });

  it("rejects a non-ISO as_of and an unknown key", () => {
    expect(Provenance.safeParse({ ...valid(), as_of: "yesterday" }).success).toBe(false);
    expect(Provenance.safeParse({ ...valid(), extra: 1 }).success).toBe(false);
  });
});
