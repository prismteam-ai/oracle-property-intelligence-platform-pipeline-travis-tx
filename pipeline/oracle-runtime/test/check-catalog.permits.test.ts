// T029 checker tests for rules 6-7 (contracts/catalog.md). Synthetic catalogs only
// (test-only); each negative case mutates a fresh copy of the synthetic catalog.
import { describe, expect, it } from "vitest";
import { checkCatalog } from "../travis/discovery/check-catalog.js";
import { syntheticUs1Catalog } from "./fixtures/synthetic-us1-catalog.js";

type Json = Record<string, unknown>;

function cat(): Json {
  return structuredClone(syntheticUs1Catalog()) as unknown as Json;
}
function permits(c: Json): Json {
  return c.permits as Json;
}
function rows(c: Json): Json[] {
  return permits(c).jurisdictions as Json[];
}
function row(c: Json, key: string): Json {
  const r = rows(c).find((x) => x.key === key);
  if (!r) throw new Error(`test: no jurisdiction ${key}`);
  return r;
}
function austin(c: Json): Json {
  const s = (c.sources as Json[]).find((x) => x.key === "austin_permits");
  if (!s) throw new Error("test: no austin_permits");
  return s;
}
function rule(c: Json, n: number): string[] {
  return checkCatalog(c).filter((l) => l.startsWith(`FAIL rule ${n}:`));
}

describe("the complete synthetic catalog", () => {
  it("passes every rule, 1 to 8", () => {
    expect(checkCatalog(cat())).toEqual([]);
  });
});

describe("rule 6: jurisdiction count equals census place_count + 1", () => {
  it("exact line when a place is missing", () => {
    const c = cat();
    rows(c).pop();
    expect(checkCatalog(c)).toContain("FAIL rule 6: jurisdictions 2 != census place_count + 1 (3)");
  });

  it("exact line when there is an extra row", () => {
    const c = cat();
    rows(c).push({ ...row(c, "synthetic"), key: "extra", jurisdiction: "Extra" });
    delete row(c, "extra").austin_issued_located_here;
    expect(checkCatalog(c)).toContain("FAIL rule 6: jurisdictions 4 != census place_count + 1 (3)");
  });

  it("expected_jurisdiction_count must equal census place_count + 1", () => {
    const c = cat();
    permits(c).expected_jurisdiction_count = 2;
    expect(rule(c, 6).join("\n")).toMatch(
      /expected_jurisdiction_count 2 != census place_count \+ 1 \(3\)/,
    );
  });

  it("a missing census_reference fails", () => {
    const c = cat();
    delete c.census_reference;
    expect(rule(c, 6)).toContain("FAIL rule 6: census_reference missing");
  });

  it("a missing permits block fails", () => {
    const c = cat();
    delete c.permits;
    expect(rule(c, 6)).toContain("FAIL rule 6: permits block missing");
  });

  it("assumes_unified_countywide_history must be false", () => {
    const c = cat();
    permits(c).assumes_unified_countywide_history = true;
    expect(rule(c, 6).join("\n")).toMatch(/assumes_unified_countywide_history/);
  });

  it("a needs-review row fails", () => {
    const c = cat();
    row(c, "synthetic").status = "needs-review";
    expect(rule(c, 6).join("\n")).toMatch(/synthetic status "needs-review"/);
  });

  it("a plain-language class written into status fails (validator vocabulary only)", () => {
    const c = cat();
    row(c, "synthetic").status = "records request";
    expect(rule(c, 6).join("\n")).toMatch(/synthetic status "records request"/);
  });

  it("a status that does not belong to the row's spec_class fails (R3)", () => {
    const c = cat();
    row(c, "austin").status = "custodian-only";
    expect(rule(c, 6).join("\n")).toMatch(
      /austin spec_class "supported" does not map to status "custodian-only"/,
    );
  });

  it("an unknown spec_class fails", () => {
    const c = cat();
    row(c, "synthetic").spec_class = "partial";
    expect(rule(c, 6).join("\n")).toMatch(/synthetic spec_class "partial"/);
  });

  it("historical_records must be a boolean and match the status", () => {
    const c = cat();
    delete row(c, "synthetic").historical_records;
    expect(rule(c, 6).join("\n")).toMatch(/synthetic historical_records/);
    const d = cat();
    row(d, "austin").historical_records = false;
    expect(rule(d, 6).join("\n")).toMatch(/austin historical_records/);
  });

  it("an intake portal is never historical records", () => {
    const c = cat();
    const r = row(c, "austin");
    r.portal_kind = "application-intake";
    expect(rule(c, 6).join("\n")).toMatch(/austin portal_kind "application-intake"/);
  });

  it("custodian-only, manual-only and blocked rows need a complete records_request", () => {
    const c = cat();
    delete row(c, "synthetic_unincorporated").records_request;
    expect(rule(c, 6).join("\n")).toMatch(/synthetic_unincorporated records_request/);
    const d = cat();
    const req = row(d, "synthetic").records_request as Json;
    delete req.request_portal_url;
    expect(rule(d, 6).join("\n")).toMatch(/synthetic records_request/);
    const e = cat();
    (row(e, "synthetic").records_request as Json).route = "ask nicely";
    expect(rule(e, 6).join("\n")).toMatch(/synthetic records_request/);
  });

  it("a blocked row needs blocked_evidence", () => {
    const c = cat();
    row(c, "synthetic").status = "blocked";
    delete row(c, "synthetic").portal_kind;
    expect(rule(c, 6).join("\n")).toMatch(/synthetic blocked_evidence/);
  });

  it("a delegated row needs issued_by", () => {
    const c = cat();
    const r = row(c, "synthetic");
    r.spec_class = "no public history";
    r.status = "delegated";
    delete r.portal_kind;
    expect(rule(c, 6).join("\n")).toMatch(/synthetic issued_by/);
    r.issued_by = "Synthetic County";
    expect(rule(c, 6)).toEqual([]);
  });

  it("a supported row needs earliest_record_date", () => {
    const c = cat();
    delete row(c, "austin").earliest_record_date;
    expect(rule(c, 6).join("\n")).toMatch(/austin earliest_record_date/);
  });

  it("every row needs evidence_url and evidence_captured_at", () => {
    const c = cat();
    delete row(c, "synthetic").evidence_url;
    delete row(c, "austin").evidence_captured_at;
    const lines = rule(c, 6).join("\n");
    expect(lines).toMatch(/synthetic evidence_url/);
    expect(lines).toMatch(/austin evidence_captured_at/);
  });

  it("duplicate keys fail", () => {
    const c = cat();
    row(c, "synthetic_unincorporated").key = "synthetic";
    expect(rule(c, 6).join("\n")).toMatch(/duplicate key synthetic/);
  });
});

describe("rule 7: Austin-issued counts located elsewhere stay under Austin", () => {
  it("Austin's located_in_other_jurisdictions must be present", () => {
    const c = cat();
    delete austin(c).located_in_other_jurisdictions;
    expect(rule(c, 7)).toContain(
      "FAIL rule 7: austin_permits located_in_other_jurisdictions missing",
    );
  });

  it("a city row's austin_issued_located_here must equal the sum of the matching Austin entries", () => {
    const c = cat();
    (row(c, "synthetic").austin_issued_located_here as Json).value = 4;
    expect(rule(c, 7).join("\n")).toMatch(
      /synthetic austin_issued_located_here 4 != Austin entries 5/,
    );
  });

  it("several Austin entries for one city (full purpose + ETJ) are summed", () => {
    const c = cat();
    (austin(c).located_in_other_jurisdictions as Json[]).push({
      jurisdiction: "SYNTHETIC ETJ",
      value: 3,
      source_url: "https://example.test/g",
      captured_at: "2026-01-01T00:00:00Z",
    });
    expect(rule(c, 7).join("\n")).toMatch(
      /synthetic austin_issued_located_here 5 != Austin entries 8/,
    );
    (row(c, "synthetic").austin_issued_located_here as Json).value = 8;
    expect(rule(c, 7).join("\n")).toMatch(/synthetic austin_issued_etj 0 != Austin entries 3/);
    (row(c, "synthetic").austin_issued_etj as Json).value = 3;
    expect(rule(c, 7)).toEqual([]);
  });

  it("OR-m6: the full-purpose and ETJ parts must match their Austin labels", () => {
    const c = cat();
    (row(c, "synthetic").austin_issued_full_purpose as Json).value = 4;
    expect(rule(c, 7).join("\n")).toMatch(
      /synthetic austin_issued_full_purpose 4 != Austin entries 5/,
    );
    delete row(c, "synthetic").austin_issued_etj;
    expect(rule(c, 7).join("\n")).toMatch(/synthetic austin_issued_etj missing/);
  });

  it("an Austin entry that matches a city row without austin_issued_located_here fails", () => {
    const c = cat();
    delete row(c, "synthetic").austin_issued_located_here;
    expect(rule(c, 7).join("\n")).toMatch(/synthetic austin_issued_located_here missing/);
  });

  it("a city's class never rests on the Austin dataset", () => {
    const c = cat();
    row(c, "synthetic").evidence_url = "https://data.austintexas.gov/resource/3syk-w9eu.json";
    expect(rule(c, 7).join("\n")).toMatch(/synthetic evidence_url is the Austin permits dataset/);
  });

  it("a city row's Austin-issued count does not change its own status", () => {
    const c = cat();
    // A large Austin-issued count on a records-request row: the row stays records request.
    (austin(c).located_in_other_jurisdictions as Json[])[0] = {
      jurisdiction: "SYNTHETIC FULL PURPOSE",
      value: 50_000,
      source_url: "https://example.test/g",
      captured_at: "2026-01-01T00:00:00Z",
    };
    (row(c, "synthetic").austin_issued_located_here as Json).value = 50_000;
    (row(c, "synthetic").austin_issued_full_purpose as Json).value = 50_000;
    expect(row(c, "synthetic").status).toBe("manual-only");
    expect(rule(c, 6)).toEqual([]);
    expect(rule(c, 7)).toEqual([]);
  });
});
