// T017: the AC-5 measurement (research R-09) against a fake Socrata endpoint.
import { describe, expect, it } from "vitest";
import {
  PROFILE,
  classifyPermit,
  toSoqlInclude,
  toSoqlSamplePopulation,
  type PermitRow,
} from "../index.js";
import { measure, whereAuxPower } from "../scripts/measure.js";
import { SocrataClient } from "../scripts/socrata.js";
import { fakeSocrata, type FakeOptions } from "./fake-socrata.js";

const include = toSoqlInclude();
const r = (
  permit_number: string,
  description: string,
  extra: Partial<PermitRow> = {},
): PermitRow => ({
  permit_number,
  permittype: "BP",
  work_class: "Remodel",
  status_current: "Final",
  description,
  ...extra,
});

// Real Austin descriptions (2026-10-21).
const ROWS: PermitRow[] = [
  r(
    "2025-154684 BP",
    "Reroof using like-for-like materials. Take this opportunity to replace window trim.",
  ),
  r(
    "2024-010050 BP",
    "Express: Residential roof replacement-Roof decking replacement (not going past roof decking)",
  ),
  r("2022-076553 BP", "Roof membrane Re-roof- white PVC membrane overlay.", {
    status_current: "Expired",
  }),
  r("2026-131734 BP", "Express - Reroof: tear off and replace existing shingle roof", {
    status_current: "Active",
  }),
  r("2019-030807 BP", "reroof mounted solar"),
  r("2010-013218 BP", "Non-Structural Reroof and RTU Change Out to existing Restaurant"),
  r(
    "2021-068116 EP",
    "Removal and Reinstallation of existing Solar Electric PV array so that building can be reroofed.",
    {
      permittype: "EP",
      work_class: "Auxiliary Power",
    },
  ),
  r("2019-030807 EP", "reroof mounted solar", { permittype: "EP", work_class: "Auxiliary Power" }),
  r("1984-003963 PP", "Reroof Ext Duplex", { permittype: "PP" }),
  r("2025-014791 EP", "Helios Glass - Austin Art Roof Sign", {
    permittype: "EP",
    work_class: "Roof",
  }),
  r("2025-123881 BP", "Repair of sliding warehouse doors."),
];

const hasInclude = (x: PermitRow): boolean =>
  /REROOF|RE-ROOF|ROOF REPLACE/.test((x.description ?? "").toUpperCase());
const predicates: FakeOptions["predicates"] = {
  [include]: hasInclude,
  [whereAuxPower(include)]: (x) => hasInclude(x) && x.work_class === "Auxiliary Power",
  [whereAuxPower(toSoqlSamplePopulation())]: (x) =>
    x.work_class === "Auxiliary Power" &&
    /ROOF/.test(`${x.description ?? ""} ${x.work_class}`.toUpperCase()),
};

const client = (o: Partial<FakeOptions> = {}): { c: SocrataClient; urls: string[] } => {
  const f = fakeSocrata({ rows: ROWS, predicates, ...o });
  return {
    c: new SocrataClient({
      get: f.get,
      sleep: async () => {},
      now: () => new Date("2026-10-21T10:00:00Z"),
    }),
    urls: f.urls,
  };
};

describe("measure (AC-5)", () => {
  it("candidates = include − excluded − trade − needs_review, in one run", async () => {
    const { c } = client();
    const res = await measure(c, { pageSize: 3 });
    expect(res.outcome).toBe("ok");
    if (res.outcome !== "ok") return;
    const e = res.expectations;
    const excluded = Object.values(e.excluded).reduce((a, b) => a + b, 0);
    expect(e.include_matches).toBe(9);
    expect(e.include_matches_recount).toBe(9);
    expect(e.fetched_rows).toBe(9);
    expect(e.dataset_rows).toBe(ROWS.length);
    expect(e.excluded).toEqual({
      aux_power: 2,
      solar_pv: 1,
      rtu: 1,
      roof_mounted: 0,
      roof_deck: 0,
    });
    expect(e.trade_permits).toBe(1);
    expect(e.needs_review).toBe(0);
    expect(e.candidates).toBe(e.include_matches - excluded - e.trade_permits - e.needs_review);
    expect(e.candidates).toBe(4);
    expect(e.rules_sha256).toBe(PROFILE.sha256);
    expect(e.attempts).toBe(1);
    expect(e.query_urls.length).toBeGreaterThan(0);
    for (const rc of e.receipts) {
      expect(rc.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(rc.status).toBe(200);
    }
  });

  it("the SoQL Auxiliary Power permit numbers equal the classifier's aux_power set; 0 aux candidates", async () => {
    const { c } = client();
    const res = await measure(c, { pageSize: 50_000 });
    if (res.outcome !== "ok") throw new Error(res.outcome);
    const aux = res.expectations.aux_power_check;
    expect(aux.soql_permit_numbers).toEqual(["2019-030807 EP", "2021-068116 EP"]);
    expect(aux.classifier_permit_numbers).toEqual(aux.soql_permit_numbers);
    expect(aux.equal).toBe(true);
    expect(aux.candidates_with_aux_power).toBe(0);
    expect(aux.roof_mentions_aux_power).toBe(2);
    expect(ROWS.filter((x) => classifyPermit(x).reason === "aux_power")).toHaveLength(2);
  });

  it("fetched ≠ count gives exactly one re-measure, then succeeds when consistent", async () => {
    const { c } = client({
      countOverride: (w, call) => (w === include && call === 1 ? 11 : undefined),
    });
    const res = await measure(c, { pageSize: 50_000 });
    expect(res.outcome).toBe("ok");
    if (res.outcome === "ok") expect(res.expectations.attempts).toBe(2);
  });

  it("a mismatch that persists stops with a reason after one re-measure", async () => {
    const { c } = client({ countOverride: (w) => (w === include ? 12 : undefined) });
    const res = await measure(c, { pageSize: 50_000 });
    expect(res.outcome).toBe("stopped");
    if (res.outcome === "stopped") {
      expect(res.attempts).toBe(2);
      expect(res.reason).toMatch(/fetched 9.*count 12/);
    }
  });

  it("a 403 stops with a blocked receipt and no further request", async () => {
    const { c, urls } = client({ failOn: { request: 2, status: 403 } });
    const res = await measure(c, { pageSize: 50_000 });
    expect(res.outcome).toBe("blocked");
    if (res.outcome === "blocked") {
      expect(res.receipt.status).toBe(403);
      expect(res.receipt.outcome).toBe("blocked");
      expect(res.receipt.blocked_reason).toBe("http-403");
    }
    expect(urls).toHaveLength(2);
  });

  it("a 200 challenge page is blocked too", async () => {
    const { c } = client({
      failOn: { request: 1, status: 200, body: "<html>Just a moment...</html>" },
    });
    const res = await measure(c, { pageSize: 50_000 });
    expect(res.outcome).toBe("blocked");
    if (res.outcome === "blocked") expect(res.receipt.blocked_reason).toBe("challenge");
  });
});

describe("SocrataClient guard rails", () => {
  it("waits so requests are at least 1 s apart and sends an identified User-Agent, no app token", async () => {
    const waits: number[] = [];
    let t = 0;
    const seen: RequestInit[] = [];
    const c = new SocrataClient({
      fetch: async (_u, init) => {
        seen.push(init);
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      },
      sleep: async (ms) => {
        waits.push(ms);
        t += ms;
      },
      clock: () => t,
    });
    await c.query({ $select: "permit_number", $limit: "1" });
    await c.query({ $select: "permit_number", $limit: "1" });
    expect(waits.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1000);
    const headers = new Headers(seen[0]?.headers);
    expect(headers.get("user-agent")).toMatch(/countylens.*github\.com\/prismteam-ai/);
    expect(headers.get("x-app-token")).toBeNull();
  });

  it("refuses a page size above 50,000 and any other host", async () => {
    const c = new SocrataClient({
      get: async () => ({ status: 200, headers: {}, body: "[]" }),
      sleep: async () => {},
    });
    await expect(c.query({ $limit: "50001" })).rejects.toThrow(/50,000/);
    expect(c.datasetUrl).toBe("https://data.austintexas.gov/resource/3syk-w9eu.json");
  });
});
