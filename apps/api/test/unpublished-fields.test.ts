// ERR-78: contract v1.1 publishes contractor_name_as_printed, so the agent must never tell a user
// the contractor's name is not published (it is, on 4,139 of 15,025 Run 3 permits).
import { VIEWS } from "@countylens/contract";
import { describe, expect, it } from "vitest";
import { UNPUBLISHED_FIELDS } from "../src/agent/citations.js";

describe("unpublished fields (ERR-78)", () => {
  it("the contractor's printed name is not declarable as unpublished", () => {
    expect(Object.keys(UNPUBLISHED_FIELDS)).not.toContain("contractor.name_as_printed");
  });
  it("and the contract really carries it on v_roofing_permit", () => {
    expect(JSON.stringify(VIEWS)).toContain("contractor_name_as_printed");
  });
});

describe("system prompt (ERR-78)", () => {
  it("never tells the model that contractor names are unavailable", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/agent/ask.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/Contractor names and BBB ratings are likewise/);
    expect(src).toMatch(/contractor_name_as_printed on each permit row/);
  });
});

// A-16 (PO audit items 4, 5, 11): the printed contractor name and the BBB search link reach the
// model and the citations; BBB status is published (blocked / not_checked), so the agent says BBB
// blocks automated lookups, never "unpublished"; a field only some rows lack is field_unknown.
describe("A-16 contractor, BBB and field_unknown", () => {
  const bbbUrl =
    "https://www.bbb.org/search?find_country=USA&find_text=Roofer%20A&find_loc=Austin%2C%20TX";
  const permitRow = {
    cid: "bafkreipermit",
    property_cid: "bafkreiprop",
    permit_number: "2024-000001 BP",
    status_class: "closed",
    contractor_name_as_printed: "Roofer A",
    bbb_url: bbbUrl,
    bbb_status: "blocked",
    bbb_status_reason: "bbb_blocked",
    contractor: { name_as_printed: "Roofer A", resolution: "unresolved", company_cid: "c1" },
    source_url: null,
    captured_at: "2026-10-25T00:00:00Z",
    table: "property_improvement",
    table_cid: "bafkreitable",
    run_id: "r",
    manifest_cid: "m",
    as_of: "2026-10-25T12:44:21Z",
    missing: [],
  };

  it("the model-facing permit projection keeps the printed name and the BBB link", async () => {
    const { projectPermit } = await import("../src/agent/tools.js");
    expect(projectPermit(1, permitRow)).toMatchObject({
      contractor_name_as_printed: "Roofer A",
      bbb_url: bbbUrl,
    });
  });

  it("citations keep the printed name and the BBB link", async () => {
    const { createCitationRegistry } = await import("../src/agent/citations.js");
    const registry = createCitationRegistry();
    registry.register(permitRow);
    expect(registry.matches()[0]).toMatchObject({
      contractor_name_as_printed: "Roofer A",
      bbb_url: bbbUrl,
    });
  });

  it("BBB status is declared with bbb_blocked, not no_lexicon_carrier", () => {
    expect(UNPUBLISHED_FIELDS.bbb_status).toBe("bbb_blocked");
  });

  it("the answer says BBB blocks automated lookups, not 'not available in the published data'", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/agent/ask.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/BBB status is not available in the published data/);
    expect(src).toMatch(/BBB blocks automated lookups/);
  });

  it("field_unknown is its own outcome with its own sentence", async () => {
    const { EMPTY_OUTCOME_SENTENCES, emptyOutcomeOf } = await import("../src/agent/citations.js");
    expect(emptyOutcomeOf(0, [{ applied: {}, rows: [], empty_reason: "field_unknown" }])).toBe(
      "field_unknown",
    );
    expect(EMPTY_OUTCOME_SENTENCES.field_unknown).not.toMatch(/not published/);
  });
});
