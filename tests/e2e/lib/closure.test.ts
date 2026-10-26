// Unit tests of lib/closure.ts (A-16 TC-038 to TC-040): the closure checker rejects a missing ID,
// a Closed row without evidence and an Exception without a reason, and finds parked tests.
import { describe, expect, it } from "vitest";
import {
  checkClosure,
  evidenceRefs,
  parkMarkers,
  parseClosureTable,
  recordedParks,
  statusOf,
} from "./closure.js";

const EVIDENCE_MD = [
  "# Evidence",
  "",
  "## Closure (AC-14)",
  "",
  "Intro line.",
  "",
  "| ID | Item | Outcome | Evidence / reason |",
  "| --- | --- | --- | --- |",
  "| X11-1 | One | **Closed** | Fixed in `pipeline/a.ts`, merge `abc1234` |",
  "| X11-3 | Three | **Closed** | Done, see the deploy (G3) |",
  "| X11-4 | Four | **Exception (PO)** | — |",
  "| X11-5 | Five | **Closed** | As X11-1 |",
  "",
  "## Next section",
].join("\n");

const PLAN = ["X11-1", "X11-2", "X11-3", "X11-4", "X11-5"];

const rowsOf = (md: string) =>
  parseClosureTable(md).map((r) => ({
    id: r.id,
    outcome: r.cells[1] ?? "",
    evidence: r.cells[2] ?? "",
  }));

describe("parseClosureTable", () => {
  it("reads the rows of the first table under the Closure heading", () => {
    const rows = parseClosureTable(EVIDENCE_MD);
    expect(rows.map((r) => r.id)).toEqual(["X11-1", "X11-3", "X11-4", "X11-5"]);
    expect(rows[0]?.cells).toEqual([
      "One",
      "**Closed**",
      "Fixed in `pipeline/a.ts`, merge `abc1234`",
    ]);
    expect(rows[0]?.line).toBe(9);
  });

  it("throws when the heading or the table is absent", () => {
    expect(() => parseClosureTable("# x\n\nno table")).toThrow(/no heading/);
    expect(() => parseClosureTable("## Closure\n\ntext only\n")).toThrow(/no table rows/);
  });
});

describe("statusOf / evidenceRefs", () => {
  it("classifies mixed outcomes", () => {
    expect(statusOf("**Closed (b)(c)(d); (a), (e) Exception**")).toEqual({
      closed: true,
      exception: true,
    });
    expect(statusOf("Partly closed")).toEqual({ closed: true, exception: false });
    expect(statusOf("Open")).toEqual({ closed: false, exception: false });
  });

  it("names paths, commits, test IDs, images and row references, not labels", () => {
    const refs = evidenceRefs(
      "`run-lock.ts`, `68a7701`, TC-080/083, TC-NF-01, img/A-16-TC-001-x.png, As A11-2, (G3), ERR-76, `permitCounts`",
    );
    expect(refs).toEqual(
      expect.arrayContaining([
        { kind: "path", value: "run-lock.ts" },
        { kind: "commit", value: "68a7701" },
        { kind: "test", value: "TC-080" },
        { kind: "test", value: "TC-NF-01" },
        { kind: "image", value: "img/A-16-TC-001-x.png" },
        { kind: "row", value: "A11-2" },
      ]),
    );
    expect(refs.map((r) => r.value)).not.toContain("permitCounts");
    expect(refs.map((r) => r.value)).not.toContain("G3");
  });
});

describe("checkClosure (TC-040)", () => {
  it("fails with exactly three messages: missing, closed without evidence, exception without reason", () => {
    const issues = checkClosure(PLAN, rowsOf(EVIDENCE_MD));
    expect(issues.map((i) => [i.id, i.defect])).toEqual([
      ["X11-2", "missing"],
      ["X11-3", "closed without evidence"],
      ["X11-4", "exception without reason"],
    ]);
    for (const issue of issues) expect(issue.message.startsWith(`${issue.id}: `)).toBe(true);
  });

  it("passes a complete table, and an 'As' row inherits the evidence of a Closed row", () => {
    const rows = [
      { id: "A11-1", outcome: "Closed", evidence: "`docs/x.md`" },
      { id: "A11-2", outcome: "Closed", evidence: "As A11-1" },
      { id: "A11-3", outcome: "Exception (PO)", evidence: "External, no access" },
    ];
    expect(checkClosure(["A11-1", "A11-2", "A11-3"], rows)).toEqual([]);
  });

  it("rejects duplicates, unplanned rows, rows without status and evidence that does not resolve", () => {
    const rows = [
      { id: "A-1", outcome: "Closed", evidence: "`docs/gone.md`, `deadbee`" },
      { id: "A-1", outcome: "Closed", evidence: "TC-001" },
      { id: "A-9", outcome: "Open", evidence: "later" },
    ];
    const issues = checkClosure(["A-1"], rows, {
      fileExists: () => false,
      commitExists: () => false,
    });
    expect(issues.map((i) => `${i.id} ${i.defect}`)).toEqual([
      "A-1 duplicated",
      "A-9 not planned",
      "A-1 evidence not found",
      "A-1 evidence not found",
      "A-9 no status",
    ]);
  });
});

describe("parkMarkers / recordedParks (TC-038)", () => {
  it("finds parkGap and Parked fixme calls with the scenario above them, not comments or other skips", () => {
    const src = [
      'test(scenario("053"), async () => {',
      "  parkGap(PARKED_GAPS.catalogFooters);",
      "});",
      'test(scenario("054"), async () => {',
      '  test.skip(x, "not present in this run");',
      "  // parkGap(PARKED_GAPS.old);",
      "});",
      'test("@scenario:A-03-TC-034", async () => {',
      "  test.fixme(",
      "    true,",
      '    "Parked: A-16 item 19",',
      "  );",
      "});",
    ].join("\n");
    const found = parkMarkers(src, "x.spec.ts", "A-13");
    expect(found.map((m) => [m.testId, m.tc, m.marker, m.line])).toEqual([
      ["A-13-TC-053", "TC-053", "parkGap", 2],
      ["A-03-TC-034", "TC-034", "test.fixme", 9],
    ]);
  });

  it("collects the TC IDs of clauses that say parked, not unparked or passed", () => {
    const parks = recordedParks([
      {
        id: "A13-8",
        outcome: "Closed for 25 of 28",
        evidence:
          "28 unparked (`68a7701`); TC-004 and TC-081 re-parked; item 19 parks (TC-053) kept",
      },
      { id: "A11-18", outcome: "Closed", evidence: "passes TC-080/083; TC-023 re-parked" },
    ]);
    expect([...parks].sort()).toEqual(["TC-004", "TC-023", "TC-053", "TC-081"]);
  });
});
