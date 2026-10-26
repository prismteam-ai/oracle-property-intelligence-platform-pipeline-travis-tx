// T007 status-map tests: exhaustive over the 6 rows of research R3.
import { describe, expect, it } from "vitest";
import {
  JURISDICTION_CASES,
  SPEC_CLASSES,
  STATUS_MAP,
  VALIDATOR_STATUSES,
  mapStatus,
  resolveJurisdictionStatus,
} from "../travis/discovery/status-map.js";

const R3 = [
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
] as const;

const VALIDATOR_WORDS = [
  "supported",
  "delegated",
  "manual-only",
  "blocked",
  "unavailable",
  "excluded",
  "custodian-only",
];

describe("status map (research R3)", () => {
  it("has exactly the 6 R3 rows", () => {
    expect(STATUS_MAP).toHaveLength(6);
    expect(STATUS_MAP.map((r) => [r.spec_class, r.case, r.status])).toEqual(
      R3.map((r) => [r.spec_class, r.case, r.status]),
    );
  });

  it("validator vocabulary is exactly the kit's 7 words", () => {
    expect([...VALIDATOR_STATUSES].sort()).toEqual([...VALIDATOR_WORDS].sort());
  });

  for (const row of R3) {
    it(`${row.spec_class} + ${row.case} -> ${row.status}`, () => {
      const mapped = mapStatus(row.spec_class, row.case);
      expect(mapped.status).toBe(row.status);
      expect([...mapped.required_extras]).toEqual([...row.required_extras]);
      expect(mapped.historical_records).toBe(row.historical_records);
      const resolved = resolveJurisdictionStatus({ spec_class: row.spec_class, case: row.case });
      expect(resolved).toEqual({ status: row.status, historical_records: row.historical_records });
    });
  }

  it("every valid combination yields a validator word; every invalid one throws", () => {
    let valid = 0;
    for (const spec_class of SPEC_CLASSES) {
      for (const c of JURISDICTION_CASES) {
        const listed = R3.some((r) => r.spec_class === spec_class && r.case === c);
        if (listed) {
          valid += 1;
          expect(VALIDATOR_WORDS).toContain(mapStatus(spec_class, c).status);
        } else {
          expect(() => mapStatus(spec_class, c)).toThrow();
        }
      }
    }
    expect(valid).toBe(6);
  });

  it("portal_kind application-intake never yields historical_records true", () => {
    for (const row of R3) {
      let result: { historical_records: boolean } | null;
      try {
        result = resolveJurisdictionStatus({
          spec_class: row.spec_class,
          case: row.case,
          portal_kind: "application-intake",
        });
      } catch {
        result = null; // refusing the combination is also acceptable
      }
      if (result) expect(result.historical_records).toBe(false);
    }
    expect(() =>
      resolveJurisdictionStatus({
        spec_class: "supported",
        case: "history-online",
        portal_kind: "application-intake",
      }),
    ).toThrow();
  });

  it("other central portal kinds are treated like application intake", () => {
    for (const portal_kind of ["onestop", "central-submission", "supplemental-approval"]) {
      expect(() =>
        resolveJurisdictionStatus({ spec_class: "supported", case: "history-online", portal_kind }),
      ).toThrow();
    }
  });
});
