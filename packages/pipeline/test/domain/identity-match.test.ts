import { describe, expect, it } from "vitest";
import { Confidence } from "../../src/domain/confidence.js";
import { IdentityMatchMethod, matchIdentities } from "../../src/domain/identity-match.js";

const contractor = (contractorKey: string, phoneKeys: string[] = [], namedAsPerson = false) => ({
  contractorKey,
  phoneKeys,
  namedAsPerson,
});
const candidate = (id: string, nameKeys: string[], phoneKeys: string[] = [], local = true) => ({
  id,
  nameKeys,
  phoneKeys,
  local,
});

describe("matchIdentities", () => {
  it("prefers a candidate with the same name and phone", () => {
    const matches = matchIdentities(
      [contractor("wilson roofing", ["5125550142"])],
      [candidate("A", ["wilson roofing"]), candidate("B", ["wilson roofing"], ["5125550142"])],
    );

    expect(matches).toEqual([
      {
        contractorKey: "wilson roofing",
        candidateId: "B",
        method: IdentityMatchMethod.NameAndPhone,
        confidence: Confidence.High,
      },
    ]);
  });

  it("falls back to a unique phone, then a unique name", () => {
    const matches = matchIdentities(
      [contractor("acme", ["5125550100"]), contractor("best homes")],
      [candidate("P", ["acme builders"], ["5125550100"]), candidate("N", ["best homes"])],
    );

    expect(matches.map((match) => [match.candidateId, match.method])).toEqual([
      ["P", IdentityMatchMethod.Phone],
      ["N", IdentityMatchMethod.Name],
    ]);
  });

  it("picks the only local candidate among same-named ones, with low confidence", () => {
    const matches = matchIdentities(
      [contractor("lone star roofing")],
      [
        candidate("DALLAS", ["lone star roofing"], [], false),
        candidate("AUSTIN", ["lone star roofing"]),
      ],
    );

    expect(matches).toEqual([
      {
        contractorKey: "lone star roofing",
        candidateId: "AUSTIN",
        method: IdentityMatchMethod.LocalName,
        confidence: Confidence.Low,
      },
    ]);
  });

  it("matches a contractor known only by a person's name by phone, never by the name alone", () => {
    const matches = matchIdentities(
      [contractor("heather smith", [], true), contractor("john doe", ["5125550199"], true)],
      [candidate("SOLE", ["heather smith"]), candidate("DOE", ["john doe"], ["5125550199"])],
    );

    expect(matches.map((match) => [match.contractorKey, match.method])).toEqual([
      ["john doe", IdentityMatchMethod.NameAndPhone],
    ]);
  });

  it("leaves ambiguous contractors unmatched", () => {
    const matches = matchIdentities(
      [contractor("abc construction")],
      [candidate("1", ["abc construction"]), candidate("2", ["abc construction"])],
    );

    expect(matches).toEqual([]);
  });
});
