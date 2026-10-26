// T058 (US3, written before T036): one month of Austin permits through the Socrata adapter,
// the frozen profile, the TCAD subset and the two transforms, into
// pipeline/data/runs/<runId>/groups/{county,property_improvement} plus summary.json.
//
// Interface this test fixes for T036 (travis/runs/run-month.ts):
//   runMonth({ repoRoot, month, jobId?, runId?, tcadZip, catalogPath, fetch, sleep, now, random, log })
//     → { ok, status: "ok" | "blocked" | "error", stage, reason?, runId, runDir, summary? }
//   runIdFor(month, now) · parseMonth(month) · exitCodeFor(status)
//   files: <runDir>/summary.json, <runDir>/groups/{county,property_improvement}/<pID>/data/…,
//          <runDir>/ledger/classification.jsonl, <runDir>/capture/tcad/receipt.json
//
// What is asserted (FR-005b, AC-5): a captured permit with no `tcad_id` is not in
// `groups/property_improvement`, is counted as `permits_no_tcad_geoid`, and pulls no parcel
// into `county`; an excluded trade sub-permit (profile rule D-4b) and a status-excluded
// permit pull no parcel either (only emitted permits' tcad_ids are looked up in the export).
// No network: the lexicon manifest, the Austin list and every permit GET are answered by the
// fake router, and the TCAD export is a synthetic zip whose sha256 the fake catalog records.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GAZETTEER_SHA256 } from "../../../../packages/query-core/src/sql.generated.js";
import { PROFILE, RULES } from "../../../../profiles/travis-austin@1.0.0/index.js";
import { compiledTravisRoofAgeProfile } from "../../travis/roof-age/travis-roof-age-profile.js";
import { safePermitName } from "../../travis/adapters/socrata/socrata.js";
import { LEXICON_MANIFEST_URL } from "../../travis/transforms/lexicon-manifest.js";
import { exitCodeFor, parseMonth, runIdFor, runMonth } from "../../travis/runs/run-month.js";
import { fakeHttp, json, silent } from "../fixtures/fake-http.js";
import { buildZip } from "../fixtures/synthetic-zip.js";
import { tcadExportText, tcadRecord } from "../fixtures/tcad-records.js";

const LEXICON = JSON.parse(
  readFileSync(new URL("../fixtures/lexicon-manifest.json", import.meta.url), "utf8"),
) as Record<string, { ipfsCid: string; type: string }>;
const AUSTIN = RULES.dataset.url;
const ENTRY = "Travis-protaxExport-20260719.json";

type Row = Record<string, string | null | undefined>;

/** Rows in the shape Socrata prints; the description carries the profile's first include term. */
function row(n: string, over: Row = {}): Row {
  const term = RULES.roofing.include.terms[0] as string;
  return {
    permit_number: n,
    permittype: "BP",
    work_class: "Remodel",
    status_current: "Active",
    description: `${term} of the whole house`,
    issue_date: "2026-09-02T00:00:00.000",
    tcad_id: "0100030105",
    contractor_company_name: "SAMPLE CONTRACTOR",
    ":updated_at": "2026-10-20T12:36:38.000Z",
    ...over,
  };
}

const EMITTED = "2026-100001 BP"; // accepted, tcad_id 0100030105 → parcel 100008
const NO_TCAD = "2026-100002 BP"; // accepted by the profile, no tcad_id on the source record
const TRADE = "2026-100003 EP"; // trade sub-permit (D-4b): excluded, tcad_id 0100030106
const VOIDED = "2026-100004 BP"; // status VOID: excluded, tcad_id 0100030107

function rows(): Row[] {
  const noTcad = row(NO_TCAD);
  delete noTcad.tcad_id; // Socrata omits null fields
  return [
    row(EMITTED),
    noTcad,
    row(TRADE, { permittype: "EP", tcad_id: "0100030106" }),
    row(VOIDED, { status_current: "VOID", tcad_id: "0100030107" }),
  ];
}

/** The three export records the default setup writes; a case may pass its own (T082). */
function defaultRecords(): Record<string, unknown>[] {
  return [
    tcadRecord({ pID: 100008, geoID: "0100030105" }),
    tcadRecord({ pID: 100012, geoID: "0100030106" }),
    tcadRecord({ pID: 100020, geoID: "0100030107" }),
  ];
}

function exportZip(
  dir: string,
  records: Record<string, unknown>[] = defaultRecords(),
): { zip: string; sha256: string } {
  const text = tcadExportText(records);
  const bytes = buildZip([
    { name: "Layout.pdf", data: Buffer.from("pdf") },
    { name: ENTRY, data: Buffer.from(text) },
  ]);
  const zip = join(dir, "2026 Certified JSON.zip");
  writeFileSync(zip, bytes);
  return { zip, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function catalog(dir: string, sha256: string): string {
  const path = join(dir, "travis-sources.yaml");
  writeFileSync(
    path,
    [
      'county: "Travis"',
      "parcel:",
      "  account_breakdown:",
      `    export_sha256: "${sha256}"`,
      `    zip_entry: "${ENTRY}"`,
      "",
    ].join("\n"),
  );
  return path;
}

/** A virtual clock: sleep advances it. */
function clock() {
  let t = Date.parse("2026-10-21T11:00:00.000Z");
  return {
    now: () => new Date(t),
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

function http(all: Row[]) {
  const byNumber = new Map(all.map((r) => [r.permit_number as string, r]));
  return fakeHttp([
    { match: (u) => u.href === LEXICON_MANIFEST_URL, respond: () => json(LEXICON) },
    {
      match: (u) => u.href.startsWith(AUSTIN),
      respond: (u) => {
        const n = u.searchParams.get("permit_number");
        if (n === null) {
          return json(
            all.map((r) => ({ permit_number: r.permit_number, ":updated_at": r[":updated_at"] })),
          );
        }
        const r = byNumber.get(n);
        return json(r ? [r] : []);
      },
    },
  ]);
}

interface Setup {
  repoRoot: string;
  zip: string;
  sha256: string;
  catalogPath: string;
}

function setup(records?: Record<string, unknown>[]): Setup {
  const repoRoot = mkdtempSync(join(tmpdir(), "run-month-"));
  const { zip, sha256 } = exportZip(repoRoot, records);
  return { repoRoot, zip, sha256, catalogPath: catalog(repoRoot, sha256) };
}

async function runSeptember(
  s: Setup,
  over: {
    catalogPath?: string;
    rows?: Row[];
    contractorRegistry?: Parameters<typeof runMonth>[0]["contractorRegistry"];
  } = {},
) {
  const c = clock();
  const fake = http(over.rows ?? rows());
  const result = await runMonth({
    repoRoot: s.repoRoot,
    month: "2026-09",
    jobId: "test-2026-09",
    tcadZip: s.zip,
    catalogPath: over.catalogPath ?? s.catalogPath,
    fetch: fake.fetch,
    sleep: c.sleep,
    now: c.now,
    random: () => 0,
    log: silent,
    ...(over.contractorRegistry === undefined
      ? {}
      : { contractorRegistry: over.contractorRegistry }),
  });
  return { result, fake };
}

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
const listDirs = (path: string): string[] => (existsSync(path) ? readdirSync(path).sort() : []);

describe("runMonth (September slice)", () => {
  it("captures every listed permit once, through the adapter, after the lexicon manifest", async () => {
    const s = setup();
    const { result, fake } = await runSeptember(s);
    expect(result.status).toBe("ok");
    expect(result.ok).toBe(true);
    expect(result.stage).toBe("done");
    const urls = fake.calls.map((c) => c.url);
    expect(urls[0]).toBe(LEXICON_MANIFEST_URL);
    expect(urls.filter((u) => new URL(u).searchParams.has("permit_number"))).toHaveLength(4);
    expect(
      urls.filter((u) => u.startsWith(AUSTIN) && new URL(u).searchParams.has("$where")),
    ).toHaveLength(1);
    const jobDir = join(s.repoRoot, "pipeline/data/artifacts/permits/travis/test-2026-09");
    expect(listDirs(join(jobDir, "raw"))).toHaveLength(4);
    expect(result.runDir).toBe(join(s.repoRoot, "pipeline/data/runs", result.runId));
  });

  it("does not publish the permit with no tcad_id and counts it as permits_no_tcad_geoid", async () => {
    const s = setup();
    const { result } = await runSeptember(s);
    const summary = readJson(join(result.runDir, "summary.json"));
    const coverage = summary.coverage as Record<string, { count: number; derivation: string }>;
    expect(coverage.permits_no_tcad_geoid).toEqual({
      count: 1,
      derivation: "aggregate_match",
    });
    expect(coverage.permits_captured?.count).toBe(4);
    expect(coverage.permits_emitted).toEqual({ count: 1, derivation: "published_rows" });
    expect(summary.counts).toEqual({
      captured: 4,
      accepted: 2,
      excluded: 2,
      emitted: 1,
      no_tcad: 1,
    });

    // the published rows name only the emitted permit
    const piDir = join(result.runDir, "groups/property_improvement");
    expect(listDirs(piDir)).toEqual(["100008"]);
    const files = readdirSync(join(piDir, "100008/data"));
    const permitFiles = files.filter((f) => /^property_improvement_\d+\.json$/.test(f));
    expect(permitFiles).toEqual(["property_improvement_1.json"]);
    const published = readJson(join(piDir, "100008/data/property_improvement_1.json"));
    expect(published.permit_number).toBe(EMITTED);
    const everything = permitFiles.map((f) => readFileSync(join(piDir, "100008/data", f), "utf8"));
    expect(everything.join("\n")).not.toContain(NO_TCAD);

    // the no-tcad permit is in the internal ledger as not emitted, never in a group
    const ledger = readFileSync(join(result.runDir, "ledger/classification.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(ledger.find((l) => l.permit_number === NO_TCAD)).toMatchObject({
      emitted: false,
      pID: null,
      tcad_id: null,
      tcad_match: "no_tcad_geoid",
    });
  });

  it("pulls no parcel into county for the no-tcad permit, the trade sub-permit or the voided permit", async () => {
    const s = setup();
    const { result } = await runSeptember(s);
    expect(listDirs(join(result.runDir, "groups/county"))).toEqual(["100008"]);
    // only emitted permits' tcad_ids were looked up in the export
    const receipt = readJson(join(result.runDir, "capture/tcad/receipt.json"));
    expect(receipt.counts).toMatchObject({ wanted: 1, matched: 1 });
    expect((receipt.resolution as Array<{ tcad_id: string }>).map((r) => r.tcad_id)).toEqual([
      "0100030105",
    ]);
    const summary = readJson(join(result.runDir, "summary.json"));
    const coverage = summary.coverage as Record<string, { count: number }>;
    expect(coverage.parcels_published?.count).toBe(1);
    expect(coverage.permits_excluded?.count).toBe(2);
    expect(summary.excluded_by_reason).toEqual({ trade_permit: 1, status_exclude: 1 });
  });

  it("marks each permit's status artifact with its outcome", async () => {
    const s = setup();
    await runSeptember(s);
    const statusDir = join(
      s.repoRoot,
      "pipeline/data/artifacts/permits/travis/test-2026-09/status",
    );
    const status = (n: string) => readJson(join(statusDir, `${safePermitName(n)}.json`));
    expect(status(EMITTED)).toMatchObject({ captured: true, state: "emitted", pID: "100008" });
    expect(status(NO_TCAD)).toMatchObject({ captured: true, state: "not_emitted:no_tcad_id" });
    expect(status(TRADE)).toMatchObject({ captured: true, state: "excluded:trade_permit" });
    expect(status(VOIDED)).toMatchObject({ captured: true, state: "excluded:status_exclude" });
  });

  it("records the contractor state as unresolved with the A-07 note, and both sources", async () => {
    const s = setup();
    const { result } = await runSeptember(s);
    const summary = readJson(join(result.runDir, "summary.json"));
    const coverage = summary.coverage as Record<string, { count: number; note?: string }>;
    expect(coverage.contractor_unresolved).toEqual({
      count: 1,
      derivation: "aggregate_match",
      note: "Comptroller baseline not loaded (A-07)",
    });
    expect(coverage.contractor_resolved?.count).toBe(0);
    expect(coverage.contractor_candidate?.count).toBe(0);
    const sources = summary.sources as Array<{ name: string; records: number; watermark: string }>;
    expect(sources.map((x) => x.name)).toEqual(["austin-3syk-w9eu", "tcad-2026-certified-json"]);
    expect(sources[0]?.records).toBe(4);
    expect(sources[0]?.watermark).toBe("2026-10-20T12:36:38.000Z");
    expect(sources[1]?.records).toBe(1);
    expect(sources[1]?.watermark).toBe(`${ENTRY}@sha256:${s.sha256}`);
    expect(summary.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "travis-austin", version: "1.0.0" }),
      ]),
    );
  });

  // A-11 fix: with a real Comptroller registry snapshot wired, the one emitted permit (whose
  // row fixture's `contractor_company_name` is "SAMPLE CONTRACTOR") resolves against it for
  // real, through resolver.ts's unmodified `resolveContractor` -- never defaulted to
  // `unresolved` and never carrying the A-07 "baseline not loaded" note once it is loaded.
  it("with a wired Comptroller registry, rolls up the real per-permit state and drops the A-07 note", async () => {
    const s = setup();
    const { result } = await runSeptember(s, {
      contractorRegistry: {
        registry: [
          { taxpayerNumber: "900", legalName: "SAMPLE CONTRACTOR", sosStatusCode: "active" },
        ],
        registrySnapshotDigest: "e".repeat(64),
      },
    });
    const summary = readJson(join(result.runDir, "summary.json"));
    const coverage = summary.coverage as Record<string, { count: number; note?: string }>;
    expect(coverage.contractor_candidate).toEqual({ count: 1, derivation: "aggregate_match" });
    expect(coverage.contractor_resolved).toEqual({ count: 0, derivation: "aggregate_match" });
    expect(coverage.contractor_unresolved).toEqual({ count: 0, derivation: "aggregate_match" });
    expect(coverage.contractor_unresolved?.note).toBeUndefined();
  });

  it("records travis-austin, the roof profile and travis-places with their digests (CR-A-03 F-1)", async () => {
    const s = setup();
    const { result } = await runSeptember(s);
    const summary = readJson(join(result.runDir, "summary.json"));
    const profiles = summary.profiles as Array<{ name: string; version: string; sha256: string }>;
    expect(profiles.map((p) => p.name)).toEqual([
      "travis-austin",
      "travis-austin-roof-profile",
      "travis-places",
    ]);
    expect(profiles[0]).toMatchObject({ version: PROFILE.version, sha256: PROFILE.sha256 });
    expect(profiles[1]).toMatchObject({ sha256: compiledTravisRoofAgeProfile().sha256 });
    expect(profiles[2]).toMatchObject({
      version: "1.0.0",
      sha256: GAZETTEER_SHA256,
      path: "packages/query-core/gazetteer/travis-places@1.0.0",
    });
  });

  it("stops before any group when the certified zip's sha256 differs from the catalog", async () => {
    const s = setup();
    const wrong = catalog(mkdtempSync(join(tmpdir(), "cat-")), "0".repeat(64));
    const { result } = await runSeptember(s, { catalogPath: wrong });
    expect(result.status).toBe("error");
    expect(result.stage).toBe("tcad-zip");
    expect(result.reason).toMatch(/sha256/);
    expect(existsSync(join(result.runDir, "groups"))).toBe(false);
    expect(exitCodeFor(result.status)).toBe(1);
  });

  it("names the run from the month and the UTC instant; the month is validated", () => {
    const id = runIdFor("2026-09", new Date("2026-10-21T11:00:00.000Z"));
    expect(id).toBe("travis-202609-permits-20261021t110000z");
    expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(id).not.toContain("pilot");
    expect(parseMonth("2026-09")).toEqual({ year: 2026, month: 9 });
    expect(() => parseMonth("2026-9")).toThrow(/YYYY-MM/);
    expect(exitCodeFor("blocked")).toBe(2);
  });
});

// T082 (P0-15, Texas Tax Code §25.025): the County transform applies the TCAD confidentiality
// redaction while the groups are built, so the redaction precedes anything written under
// groups/ (the `validate` input of pipeline/publish). The summary counts the redactions as
// `owners_redacted`; the manifest's TCAD limitation note repeats that number (T083).
describe("runMonth owners_redacted (T082, P0-15)", () => {
  const CONFIDENTIAL_OWNER = "REDACTED SAMPLE PERSON";
  const SECOND = "2026-100005 BP"; // accepted, tcad_id 0100030106 → parcel 100012 (not confidential)
  const OWNER_FILE = /^(person|company|mailing_address)_\d+\.json$/;

  /** Every file under `dir`, recursively, as one text (what `validate` would read). */
  function treeText(dir: string): string {
    const out: string[] = [];
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const path = join(d, entry.name);
        if (entry.isDirectory()) walk(path);
        else out.push(readFileSync(path, "utf8"));
      }
    };
    walk(dir);
    return out.join("\n");
  }

  it("writes owners_redacted = 0 when no published parcel carries a confidentiality flag", async () => {
    const s = setup();
    const { result } = await runSeptember(s);
    expect(result.summary?.owners_redacted).toBe(0);
    const summary = readJson(join(result.runDir, "summary.json"));
    expect(summary.owners_redacted).toBe(0);
    const coverage = summary.coverage as Record<string, { count: number }>;
    expect(coverage.confidential_suppressed?.count).toBe(0);
    expect(coverage.owner_confidential?.count).toBe(0);
    // the fixture owner is not confidential: it is published as a company (name ends in LLC)
    expect(readdirSync(join(result.runDir, "groups/county/100008/data"))).toContain(
      "company_1.json",
    );
    expect(treeText(join(result.runDir, "groups"))).toContain("SAMPLE OWNER LLC");
  });

  it("counts each confidential TCAD record in owners_redacted and keeps its owner out of groups/county (before validate)", async () => {
    const s = setup([
      tcadRecord({
        pID: 100008,
        geoID: "0100030105",
        ownerName: CONFIDENTIAL_OWNER,
        confidentialCode: "C",
      }),
      tcadRecord({ pID: 100012, geoID: "0100030106" }),
      tcadRecord({ pID: 100020, geoID: "0100030107" }),
    ]);
    const { result } = await runSeptember(s, {
      rows: [...rows(), row(SECOND, { tcad_id: "0100030106" })],
    });
    expect(result.status).toBe("ok");
    expect(result.summary?.owners_redacted).toBe(1);
    const summary = readJson(join(result.runDir, "summary.json"));
    expect(summary.owners_redacted).toBe(1);
    const coverage = summary.coverage as Record<string, { count: number }>;
    expect(coverage.parcels_published?.count).toBe(2);
    expect(coverage.permits_emitted?.count).toBe(2);
    expect(coverage.confidential_suppressed?.count).toBe(1);
    expect(coverage.owner_confidential?.count).toBe(1);

    // the redacted parcel is still published (a redaction, not an exclusion), without any
    // owner, company or mailing-address entity; the other parcel's owner is still written
    const countyDir = join(result.runDir, "groups/county");
    expect(listDirs(countyDir)).toEqual(["100008", "100012"]);
    const redacted = readdirSync(join(countyDir, "100008/data"));
    expect(redacted).toContain("property.json");
    expect(redacted.filter((f) => OWNER_FILE.test(f))).toEqual([]);
    expect(readdirSync(join(countyDir, "100012/data"))).toContain("company_1.json");

    // neither the name nor the mailing address of the confidential owner reaches any
    // validate input, in either group
    const redactedText = treeText(join(countyDir, "100008"));
    expect(redactedText).not.toContain(CONFIDENTIAL_OWNER);
    expect(redactedText).not.toContain("41 SAMPLE DR");
    expect(redactedText).not.toContain("WOODCREEK");
    const groupsText = treeText(join(result.runDir, "groups"));
    expect(groupsText).not.toContain(CONFIDENTIAL_OWNER);
    expect(groupsText).not.toContain("Redacted Sample Person");
    expect(groupsText).toContain("SAMPLE OWNER LLC");

    // the internal transform report records the redaction and its basis
    const report = readJson(join(result.runDir, "reports/transform-counts.json"));
    const county = report.county as Array<{ pID: string; owner: string; confidential: boolean }>;
    expect(county.find((c) => c.pID === "100008")).toMatchObject({
      owner: "suppressed",
      confidential: true,
    });
    expect(county.find((c) => c.pID === "100012")).toMatchObject({ confidential: false });
  });
});

describe("runMonth stop labels and per-run receipts (CR-A-03 OR-9, OR-10)", () => {
  it("labels a timed-out permit GET an error (exit 1), not blocked (exit 2), and writes no group", async () => {
    const s = setup();
    const c = clock();
    const base = http(rows());
    const fetch: typeof base.fetch = async (url, init) => {
      if (new URL(url).searchParams.get("permit_number") === NO_TCAD) {
        const error = new Error("the request timed out");
        error.name = "TimeoutError";
        throw error;
      }
      return base.fetch(url, init);
    };
    const result = await runMonth({
      repoRoot: s.repoRoot,
      month: "2026-09",
      jobId: "test-2026-09",
      tcadZip: s.zip,
      catalogPath: s.catalogPath,
      fetch,
      sleep: c.sleep,
      now: c.now,
      random: () => 0,
      log: silent,
    });
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("austin");
    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/timeout/);
    expect(exitCodeFor(result.status)).toBe(1);
    expect(existsSync(join(result.runDir, "groups"))).toBe(false);
  });

  it("does not abort when a permit GET returns the same permit twice; counts it in the summary (code-review #5)", async () => {
    const s = setup();
    const c = clock();
    const base = http(rows());
    const fetch: typeof base.fetch = async (url, init) =>
      new URL(url).searchParams.get("permit_number") === EMITTED
        ? json([row(EMITTED), row(EMITTED)])
        : base.fetch(url, init);
    const result = await runMonth({
      repoRoot: s.repoRoot,
      month: "2026-09",
      jobId: "test-2026-09",
      tcadZip: s.zip,
      catalogPath: s.catalogPath,
      fetch,
      sleep: c.sleep,
      now: c.now,
      random: () => 0,
      log: silent,
    });
    expect(result.status).toBe("ok");
    expect(result.summary?.counts.emitted).toBe(1);
    expect(result.summary?.duplicates_by_reason).toEqual({ identical_rows: 1 });
    expect(result.summary?.limitations.join("\n")).toMatch(/1 permit number returned several rows/);
  });

  it("keeps exit 2 for a 403 (blocked)", async () => {
    const s = setup();
    const c = clock();
    const base = http(rows());
    const fetch: typeof base.fetch = async (url, init) =>
      new URL(url).searchParams.get("permit_number") === NO_TCAD
        ? json({ message: "forbidden" }, 403)
        : base.fetch(url, init);
    const result = await runMonth({
      repoRoot: s.repoRoot,
      month: "2026-09",
      jobId: "test-2026-09",
      tcadZip: s.zip,
      catalogPath: s.catalogPath,
      fetch,
      sleep: c.sleep,
      now: c.now,
      random: () => 0,
      log: silent,
    });
    expect(result.status).toBe("blocked");
    expect(exitCodeFor(result.status)).toBe(2);
  });

  it("counts sources[0].records from this run's receipts only, not the job's shared receipts.jsonl", async () => {
    const s = setup();
    const first = await runSeptember(s);
    expect(first.result.ok).toBe(true);
    // A second run of the same job lists one permit fewer; its earlier captures are reused.
    const c = clock();
    const second = await runMonth({
      repoRoot: s.repoRoot,
      month: "2026-09",
      jobId: "test-2026-09",
      runId: "travis-202609-permits-20261021t120000z",
      tcadZip: s.zip,
      catalogPath: s.catalogPath,
      fetch: http(rows().filter((r) => r.permit_number !== VOIDED)).fetch,
      sleep: c.sleep,
      now: c.now,
      random: () => 0,
      log: silent,
    });
    expect(second.ok).toBe(true);
    const jobDir = join(s.repoRoot, "pipeline/data/artifacts/permits/travis/test-2026-09");
    const shared = readFileSync(join(jobDir, "receipts.jsonl"), "utf8").trim().split("\n");
    expect(shared).toHaveLength(4);
    const summary = readJson(join(second.runDir, "summary.json"));
    const counts = summary.counts as { captured: number };
    const sources = summary.sources as Array<{ records: number; receipts: string }>;
    const austin = sources[0] as { records: number; receipts: string };
    expect(austin.receipts.startsWith(second.runDir)).toBe(true);
    const lines = readFileSync(austin.receipts, "utf8").trim().split("\n");
    const receipts = lines.map((l) => JSON.parse(l) as { permit_number: string; outcome: string });
    expect(receipts.map((r) => r.permit_number)).toEqual([EMITTED, NO_TCAD, TRADE]);
    expect(receipts.every((r) => r.outcome === "ok")).toBe(true);
    expect(austin.records).toBe(3);
    expect(counts.captured).toBe(3);
  });
});
