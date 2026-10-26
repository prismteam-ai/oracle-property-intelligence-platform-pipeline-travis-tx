// T017 TCAD probe tests. Synthetic exports only (test-only): an injected fetch serves a
// tiny invented landing page and export; traviscad.org is never called. Downloads go to
// a temporary folder except where the default folder itself is under test.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createSourceClient, type FetchLike } from "../../travis/lib/source-client.js";
import {
  INACTIVITY_LIMIT_MS,
  ExportVerifyError,
  ROLL_YEAR,
  TCAD_PUBLIC_INFO_URL,
  TCAD_RAW_DIR,
  TOTAL_LIMIT_MS,
  findTcadLinks,
  exportSummaryPath,
  layoutNameFor,
  priorExportFrom,
  probeTcad,
  scanExport,
  tcadExportPath,
  verifyExport,
} from "../../travis/discovery/probes/tcad.js";
import { fakeHttp, silent, text, type Route } from "../fixtures/fake-http.js";
import { buildZip } from "../fixtures/synthetic-zip.js";
import { must } from "../helpers.js";

const FIXED = new Date("2026-01-01T00:00:00.000Z");
const BASE = "https://traviscad.test";

const LANDING = `<!doctype html><html><body>
<h2>Downloads</h2>
<p>The 2026 appraisal roll was certified on July 25, 2026.</p>
<a href="/files/2025-certified-special-export.json">2025 Certified Special Export (JSON)</a>
<a href="/files/2026-certified-special-export.json">2026 Certified Special Export (JSON)</a>
<a href="${BASE}/files/2026-certified-appraisal-export.zip">2026 Certified Appraisal Export (July)</a>
<a href="/files/export-layouts.zip">Export Layouts</a>
<a href="/files/2026-supplemental-01.zip">2026 Supplemental Appraisal Roll Export 01</a>
<a href="/files/2026-supplemental-02.zip">2026 Supplemental Appraisal Roll Export 02</a>
</body></html>`;

const RECORDS = [
  { prop_id: 101, geo_id: "0100000101", deed_date: "", owner: { name: "SYNTHETIC A" } },
  { prop_id: 102, geo_id: "0100000102", deed_date: "2019-03-04", owner: { name: "SYNTHETIC B" } },
  { prop_id: 103, geo_id: "0100000103", deed_date: null, situs: "1 SYNTHETIC ST" },
];
const EXPORT_JSON = JSON.stringify(RECORDS);

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "tcad-probe-test-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function client(fetch: FetchLike) {
  return createSourceClient({
    fetch,
    sleep: async () => undefined,
    random: () => 0,
    now: () => FIXED,
    log: silent,
  });
}

function routes(exportBody: Buffer | string = EXPORT_JSON): Route[] {
  return [
    {
      match: (u) => u.pathname === "/publicinformation",
      respond: () => text(LANDING),
    },
    {
      match: (u) => u.pathname === "/files/export-layouts.zip",
      respond: () =>
        new Response(new Uint8Array(buildZip([{ name: "layout.txt", data: Buffer.from("x") }])), {
          headers: { "content-type": "application/zip" },
        }),
    },
    {
      match: (u) => u.pathname === "/files/2026-certified-special-export.json",
      respond: () =>
        new Response(typeof exportBody === "string" ? exportBody : new Uint8Array(exportBody), {
          headers: { "content-type": "application/octet-stream" },
        }),
    },
  ];
}

describe("constants", () => {
  it("names the real landing page, roll year and FR-003 limits", () => {
    expect(TCAD_PUBLIC_INFO_URL).toBe("https://traviscad.org/publicinformation");
    expect(ROLL_YEAR).toBe(2026);
    expect(INACTIVITY_LIMIT_MS).toBe(10 * 60 * 1000);
    expect(TOTAL_LIMIT_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("the default download folder is pipeline/data/raw/tcad/ (gitignored)", () => {
    expect(TCAD_RAW_DIR.endsWith(["pipeline", "data", "raw", "tcad"].join(sep))).toBe(true);
    const path = tcadExportPath(`${BASE}/files/2026-certified-special-export.json`);
    expect(path.startsWith(TCAD_RAW_DIR + sep)).toBe(true);
    expect(path).toMatch(/[\\/]2026-certified-special-export-[0-9a-f]{8}\.json$/);
  });

  it("CR-8: two URLs with the same basename get different local names", () => {
    const a = tcadExportPath(`${BASE}/files/2026/export.zip`, "/raw");
    const b = tcadExportPath(`${BASE}/files/2025/export.zip`, "/raw");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\/raw\/export-[0-9a-f]{8}\.zip$/);
    expect(b).toMatch(/^\/raw\/export-[0-9a-f]{8}\.zip$/);
    // the same URL always maps to the same name
    expect(tcadExportPath(`${BASE}/files/2026/export.zip`, "/raw")).toBe(a);
    // names stay inside one folder level (catalog file_path rule pipeline/data/raw/tcad/<name>)
    expect(tcadExportPath(`${BASE}/`, "/raw")).toMatch(
      /^\/raw\/tcad-certified-special-export-[0-9a-f]{8}$/,
    );
  });
});

describe("findTcadLinks", () => {
  it("picks the 2026 certified special export, the layouts, supplementals and the certification date", () => {
    const links = findTcadLinks(LANDING, `${BASE}/publicinformation`);
    expect(links.certified_special_export).toBe(`${BASE}/files/2026-certified-special-export.json`);
    expect(links.export_layouts).toBe(`${BASE}/files/export-layouts.zip`);
    expect(links.supplemental.map((s) => s.url)).toEqual([
      `${BASE}/files/2026-supplemental-01.zip`,
      `${BASE}/files/2026-supplemental-02.zip`,
    ]);
    expect(links.certification_date).toBe("2026-07-25");
  });

  it("returns nulls when the page lists no such links", () => {
    const links = findTcadLinks("<html><body>nothing</body></html>", `${BASE}/`);
    expect(links).toEqual({
      certified_special_export: null,
      export_layouts: null,
      supplemental: [],
      certification_date: null,
    });
  });
});

describe("scanExport (streaming)", () => {
  it("counts records, lists fields, prints the key exactly and detects deed/sale dates", async () => {
    const dir = tmp();
    const path = join(dir, "export.json");
    writeFileSync(path, EXPORT_JSON);
    const scan = await scanExport(path);
    expect(scan.count).toBe(3);
    expect(scan.record_path).toBe("");
    expect(scan.fields).toEqual(
      expect.arrayContaining(["prop_id", "geo_id", "deed_date", "owner", "owner.name", "situs"]),
    );
    expect(scan.identifier_name).toBe("prop_id");
    expect(scan.identifier_proven).toBe(true);
    expect(scan.identifier_format).toMatch(/integer/);
    expect(scan.deed_or_sale_dates_present).toBe(true);
  });

  it("keeps the identifier exactly as printed (upper case) and reports duplicates as unproven", async () => {
    const dir = tmp();
    const path = join(dir, "export.json");
    writeFileSync(path, JSON.stringify([{ PROP_ID: "7" }, { PROP_ID: "7" }, { PROP_ID: "8" }]));
    const scan = await scanExport(path);
    expect(scan.identifier_name).toBe("PROP_ID");
    expect(scan.identifier_proven).toBe(false);
    expect(scan.deed_or_sale_dates_present).toBe(false);
  });

  it("finds the record array under a top-level key and honours an explicit record path", async () => {
    const dir = tmp();
    const path = join(dir, "export.json");
    writeFileSync(path, JSON.stringify({ meta: { year: 2026 }, properties: RECORDS }));
    expect((await scanExport(path)).record_path).toBe("properties");
    expect((await scanExport(path)).count).toBe(3);
    expect((await scanExport(path, { recordPath: "properties" })).count).toBe(3);
  });

  it("reads a JSON entry inside a ZIP export", async () => {
    const dir = tmp();
    const path = join(dir, "export.zip");
    writeFileSync(
      path,
      buildZip([
        { name: "readme.txt", data: Buffer.from("synthetic"), deflate: false },
        { name: "export.json", data: Buffer.from(EXPORT_JSON) },
      ]),
    );
    const scan = await scanExport(path);
    expect(scan.zip_entry).toBe("export.json");
    expect(scan.count).toBe(3);
  });

  it("counts a larger synthetic export without loading the whole file", async () => {
    const dir = tmp();
    const path = join(dir, "big.json");
    const n = 20_000;
    writeFileSync(
      path,
      `[${Array.from({ length: n }, (_, i) => JSON.stringify({ prop_id: i + 1 })).join(",")}]`,
    );
    expect((await scanExport(path)).count).toBe(n);
    const source = readFileSync(
      fileURLToPath(new URL("../../travis/discovery/probes/tcad.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/readFileSync|readFile\(|JSON\.parse\(\s*await/);
  });
});

// The real 2026 TCAD JSON ("protaxExport") prints the property key as top-level `pID` (a
// number) and the geographic ID as `geoID` inside a one-element `propertyIdentification`
// array; every child array repeats `pID`. These records copy that SHAPE only: every value
// is invented (test-only), and no real owner, address or account appears here.
function protaxRecord(pID: number, geoIDs: Array<string | null> = [`0${pID}000`]): object {
  return {
    pID,
    pYear: 2026,
    pVersion: 0,
    propType: "R",
    geometry: "SYNTHETIC",
    propertyIdentification: geoIDs.map((geoID) => ({ geoID, refID2: null, pID })),
    deeds: [
      { deedID: 1, deedDt: "2001-01-01T00:00:00", pID },
      { deedID: 2, deedDt: null, pID },
    ],
    owners: [{ ownerID: 9, name: "SYNTHETIC OWNER", pID }],
    sales: [],
  };
}

describe("scanExport on the protax JSON shape (pID, nested geoID)", () => {
  async function scanOf(records: object[], zip = false) {
    const dir = tmp();
    const json = JSON.stringify(records);
    const path = join(dir, zip ? "export.zip" : "export.json");
    writeFileSync(
      path,
      zip ? buildZip([{ name: "Synthetic-protaxExport.json", data: Buffer.from(json) }]) : json,
    );
    return scanExport(path);
  }

  it("names top-level pID exactly as printed and proves it present and unique on every record", async () => {
    const scan = await scanOf([protaxRecord(11), protaxRecord(12), protaxRecord(13)], true);
    expect(scan.zip_entry).toBe("Synthetic-protaxExport.json");
    expect(scan.count).toBe(3);
    expect(scan.identifier_name).toBe("pID");
    expect(scan.identifier_layout_name).toBe("prop_id");
    expect(scan.identifier_proven).toBe(true);
    expect(scan.identifier_format).toBe("integer, 2 digits");
    expect(scan.deed_or_sale_dates_present).toBe(true);
    expect(scan.fields).toEqual(
      expect.arrayContaining(["pID", "propertyIdentification", "propertyIdentification[].geoID"]),
    );
  });

  it("reports every key candidate with presence and distinct counts (no values)", async () => {
    const scan = await scanOf([protaxRecord(11), protaxRecord(12)]);
    expect(scan.identifier_candidates).toEqual([
      { name: "pID", records: 2, present: 2, distinct: 2, proven: true },
      { name: "propertyIdentification[].geoID", records: 2, present: 2, distinct: 2, proven: true },
    ]);
  });

  it("a duplicated pID is not proven; a unique nested geoID is then the proven key", async () => {
    const scan = await scanOf([
      protaxRecord(11, ["A1"]),
      protaxRecord(11, ["A2"]),
      protaxRecord(12, ["A3"]),
    ]);
    expect(scan.identifier_name).toBe("propertyIdentification[].geoID");
    expect(scan.identifier_layout_name).toBe("geo_id");
    expect(scan.identifier_proven).toBe(true);
    expect(scan.identifier_format).toBe("string, 2 characters");
    expect(scan.identifier_candidates?.[0]).toMatchObject({
      name: "pID",
      distinct: 2,
      proven: false,
    });
  });

  it("when no candidate is proven, keeps the printed pID name with identifier_proven false", async () => {
    const scan = await scanOf([protaxRecord(11, ["A1"]), protaxRecord(11, ["A1"])]);
    expect(scan.identifier_name).toBe("pID");
    expect(scan.identifier_proven).toBe(false);
  });

  it("a record missing pID breaks the proof (presence on every record)", async () => {
    const { pID: _drop, ...noKey } = protaxRecord(12) as { pID: number };
    const scan = await scanOf([protaxRecord(11, [null]), noKey, protaxRecord(13, [null])]);
    expect(scan.identifier_name).toBe("pID");
    expect(scan.identifier_proven).toBe(false);
    expect(scan.identifier_candidates?.[0]).toMatchObject({ records: 3, present: 2 });
  });

  it("a record with two geoIDs is ambiguous, so the nested geoID is not proven", async () => {
    const scan = await scanOf([protaxRecord(11, ["A1", "A9"]), protaxRecord(11, ["A2"])]);
    const geo = scan.identifier_candidates?.find((c) => c.name.endsWith("geoID"));
    expect(geo).toMatchObject({ present: 1, proven: false });
    expect(scan.identifier_proven).toBe(false);
  });

  it("does not take a child array's repeated pID (e.g. deeds[].pID) as the key", async () => {
    const records = [protaxRecord(11), protaxRecord(12)].map((r) => {
      const { pID: _drop, ...rest } = r as { pID: number };
      return { ...rest, propertyIdentification: [] };
    });
    const scan = await scanOf(records);
    expect(scan.identifier_name).toBeNull();
    expect(scan.identifier_layout_name).toBeNull();
    expect(scan.identifier_proven).toBe(false);
  });

  it("recognises other printed spellings of the property id (propID)", async () => {
    const scan = await scanOf([{ propID: "1" }, { propID: "2" }]);
    expect(scan.identifier_name).toBe("propID");
    expect(scan.identifier_proven).toBe(true);
  });
});

describe("layoutNameFor (TCAD Export Layouts names, FR-003a PO 2026-10-20)", () => {
  it("maps every printed property-id spelling to the layout name prop_id", () => {
    for (const printed of ["pID", "prop_id", "PROP_ID", "propID", "property_id"]) {
      expect(layoutNameFor(printed)).toBe("prop_id");
    }
  });
  it("maps a top-level or nested geo id to the layout name geo_id", () => {
    expect(layoutNameFor("geoID")).toBe("geo_id");
    expect(layoutNameFor("geo_id")).toBe("geo_id");
    expect(layoutNameFor("propertyIdentification[].geoID")).toBe("geo_id");
  });
  it("returns null for anything else", () => {
    expect(layoutNameFor("owner_id")).toBeNull();
    expect(layoutNameFor("deeds[].pID")).toBeNull();
  });
});

describe("probeTcad", () => {
  it("downloads once, records bytes, SHA-256, download rate, roll year and certification date", async () => {
    const dir = tmp();
    const { fetch, calls } = fakeHttp(routes());
    const result = await probeTcad({
      client: client(fetch),
      now: () => FIXED,
      rawDir: dir,
      landingUrl: `${BASE}/publicinformation`,
    });
    expect(result.status).toBe("available");
    const exportCalls = calls.filter((c) => c.url.endsWith("2026-certified-special-export.json"));
    expect(exportCalls).toHaveLength(1);

    const receipt = must(result.export_receipt);
    expect(receipt.bytes).toBe(Buffer.byteLength(EXPORT_JSON));
    expect(receipt.sha256).toBe(createHash("sha256").update(EXPORT_JSON).digest("hex"));
    expect(receipt.outcome).toBe("ok");
    expect(must(result.download_rate).bytes).toBe(Buffer.byteLength(EXPORT_JSON));
    expect(must(result.download_rate).megabytes_per_minute).toBeGreaterThanOrEqual(0);

    const path = must(result.export_path);
    expect(path.startsWith(dir + sep)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(EXPORT_JSON);

    expect(result.roll_year).toBe(2026);
    expect(result.certification_date).toBe("2026-07-25");
    expect(result.assessed_parcel_count).toMatchObject({
      value: 3,
      source_url: `${BASE}/files/2026-certified-special-export.json`,
      method: "streaming count",
    });
    expect(must(result.scan).identifier_name).toBe("prop_id");
    expect(must(result.layouts_receipt).outcome).toBe("ok");
    expect(result.links?.supplemental).toHaveLength(2);
  });

  it("HTTP 403 on the landing page: blocked, one attempt, null roll count with a reason", async () => {
    const dir = tmp();
    const { fetch, calls } = fakeHttp([
      { match: () => true, respond: () => text("Forbidden", 403) },
    ]);
    const result = await probeTcad({
      client: client(fetch),
      now: () => FIXED,
      rawDir: dir,
      landingUrl: `${BASE}/publicinformation`,
    });
    expect(calls).toHaveLength(1);
    expect(result.status).toBe("blocked");
    expect(must(result.blocked_receipt)).toMatchObject({ status: 403, attempts: 1 });
    expect(result.assessed_parcel_count.value).toBeNull();
    expect(result.assessed_parcel_count.missing_reason).toMatch(/403/);
    expect(result.export_path).toBeNull();
  });

  it("a stalled download (no data within the inactivity limit) is blocked with timeout_ms", async () => {
    const dir = tmp();
    const stalled: Route = {
      match: (u) => u.pathname === "/files/2026-certified-special-export.json",
      respond: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("[{"));
              // then nothing: the server stalls
            },
          }),
          { headers: { "content-type": "application/octet-stream" } },
        ),
    };
    const { fetch, calls } = fakeHttp([stalled, ...routes()]);
    const result = await probeTcad({
      client: client(fetch),
      now: () => FIXED,
      rawDir: dir,
      landingUrl: `${BASE}/publicinformation`,
      limits: { inactivityMs: 40, totalMs: 5_000 },
    });
    expect(result.status).toBe("blocked");
    const receipt = must(result.blocked_receipt);
    expect(receipt.outcome).toBe("blocked");
    expect(receipt.blocked_reason).toBe("timeout");
    expect(must(receipt.timeout_ms)).toBeGreaterThanOrEqual(40);
    expect(calls.filter((c) => c.url.endsWith("special-export.json"))).toHaveLength(1);
    expect(result.export_path).toBeNull();
    const dest = tcadExportPath(`${BASE}/files/2026-certified-special-export.json`, dir);
    expect(existsSync(dest)).toBe(false);
    expect(result.assessed_parcel_count.missing_reason).toMatch(/timeout/);
  });

  it("a download that keeps trickling past the total limit is blocked with timeout_ms", async () => {
    const dir = tmp();
    let timer: ReturnType<typeof setInterval> | undefined;
    const trickle: Route = {
      match: (u) => u.pathname === "/files/2026-certified-special-export.json",
      respond: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              timer = setInterval(() => controller.enqueue(new TextEncoder().encode(" ")), 5);
            },
            cancel() {
              clearInterval(timer);
            },
          }),
          { headers: { "content-type": "application/octet-stream" } },
        ),
    };
    const { fetch } = fakeHttp([trickle, ...routes()]);
    const result = await probeTcad({
      client: client(fetch),
      now: () => FIXED,
      rawDir: dir,
      landingUrl: `${BASE}/publicinformation`,
      limits: { inactivityMs: 1_000, totalMs: 60 },
    });
    clearInterval(timer);
    expect(result.status).toBe("blocked");
    expect(must(must(result.blocked_receipt).timeout_ms)).toBeGreaterThanOrEqual(60);
  });
});

describe("OR-m8: the export is not downloaded again when the prior file still matches", () => {
  const EXPORT_URL = `${BASE}/files/2026-certified-special-export.json`;

  async function firstRun(dir: string) {
    const { fetch } = fakeHttp(routes());
    return probeTcad({
      client: client(fetch),
      now: () => FIXED,
      rawDir: dir,
      landingUrl: `${BASE}/publicinformation`,
    });
  }

  it("reuses the prior file by size and SHA-256: no request to the export URL", async () => {
    const dir = tmp();
    const first = await firstRun(dir);
    const receipt = must(first.export_receipt);
    const { fetch, calls } = fakeHttp(routes());
    const second = await probeTcad({
      client: client(fetch),
      now: () => FIXED,
      rawDir: dir,
      landingUrl: `${BASE}/publicinformation`,
      priorExport: { receipt, path: must(first.export_path), seconds: 1 },
    });
    expect(calls.filter((c) => c.url === EXPORT_URL)).toHaveLength(0);
    expect(second.receipts.map((r) => r.url)).not.toContain(EXPORT_URL);
    expect(second.export_receipt).toEqual(receipt);
    expect(second.export_reused_from).toBe(receipt.captured_at);
    expect(second.assessed_parcel_count.value).toBe(3);
    expect(must(second.download_rate).bytes).toBe(receipt.bytes);
  });

  it("priorExportFrom resolves the catalog's repository-relative file_path unchanged", async () => {
    const dir = tmp();
    const first = await firstRun(dir);
    const r = must(first.export_receipt);
    const name = must(first.export_path).slice(dir.length + 1);
    const prior = priorExportFrom(
      {
        url: r.url,
        method: "GET",
        status: 200,
        bytes: r.bytes,
        sha256: r.sha256,
        captured_at: r.captured_at,
        user_agent: r.user_agent,
        attempts: 1,
        outcome: "ok",
        resumes: 0,
        file_path: `pipeline/data/raw/tcad/${name}`,
        seconds: 2,
        megabytes_per_minute: 1,
        roll_year: 2026,
      },
      "/repo",
    );
    expect(prior.path).toBe(`/repo/pipeline/data/raw/tcad/${name}`);
    expect(prior.receipt).toMatchObject({
      url: r.url,
      bytes: r.bytes,
      sha256: r.sha256,
      outcome: "ok",
    });
  });

  it("downloads again when the local file changed (SHA-256 mismatch)", async () => {
    const dir = tmp();
    const first = await firstRun(dir);
    const path = must(first.export_path);
    const original = readFileSync(path);
    // same size, different bytes
    writeFileSync(path, Buffer.from(original.toString("utf8").replace("1", "9")));
    const { fetch, calls } = fakeHttp(routes());
    const second = await probeTcad({
      client: client(fetch),
      now: () => FIXED,
      rawDir: dir,
      landingUrl: `${BASE}/publicinformation`,
      priorExport: { receipt: must(first.export_receipt), path, seconds: 1 },
    });
    expect(calls.filter((c) => c.url === EXPORT_URL)).toHaveLength(1);
    expect(second.export_reused_from).toBeUndefined();
  });

  it("downloads when the landing page links a different export URL than the prior receipt", async () => {
    const dir = tmp();
    const first = await firstRun(dir);
    const receipt = { ...must(first.export_receipt), url: `${BASE}/files/2025-old-export.json` };
    const { fetch, calls } = fakeHttp(routes());
    await probeTcad({
      client: client(fetch),
      now: () => FIXED,
      rawDir: dir,
      landingUrl: `${BASE}/publicinformation`,
      priorExport: { receipt, path: must(first.export_path), seconds: 1 },
    });
    expect(calls.filter((c) => c.url === EXPORT_URL)).toHaveLength(1);
  });
});

// A-04 T020 (CR2-10, A-04-TC-016 step 1): the 3.5 GB export is re-hashed only when its
// {size, mtime, inode} differ from `<zip>.summary.json`; a SHA-256 that is not the A-01
// receipt's stops with export_sha256_mismatch. Synthetic test input (a tiny invented zip).
describe("A-04-TC-016 export verification (CR2-10)", () => {
  const zipAt = (dir: string): string => {
    const path = join(dir, "export.zip");
    writeFileSync(path, buildZip([{ name: "x.json", data: Buffer.from("[]") }]));
    return path;
  };
  const sha = (path: string): string =>
    createHash("sha256").update(readFileSync(path)).digest("hex");

  it("A-04-TC-016 re-hashes only when {size, mtime, inode} changed", async () => {
    const path = zipAt(tmp());
    let hashes = 0;
    const hashFile = async (p: string): Promise<string> => {
      hashes += 1;
      return sha(p);
    };
    const first = await verifyExport(path, sha(path), { hashFile });
    expect(first).toMatchObject({ sha256: sha(path), rehashed: true });
    expect(existsSync(exportSummaryPath(path))).toBe(true);
    const second = await verifyExport(path, sha(path), { hashFile });
    expect(second.rehashed).toBe(false);
    expect(hashes).toBe(1);
    const later = new Date("2026-10-21T00:00:00Z");
    utimesSync(path, later, later);
    const third = await verifyExport(path, sha(path), { hashFile });
    expect(third.rehashed).toBe(true);
    expect(hashes).toBe(2);
  });

  it("A-04-TC-016 a SHA-256 different from the A-01 receipt stops with export_sha256_mismatch", async () => {
    const path = zipAt(tmp());
    let error: unknown;
    try {
      await verifyExport(path, "6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ExportVerifyError);
    expect((error as ExportVerifyError).code).toBe("export_sha256_mismatch");
  });

  it("A-04-TC-016 a missing export stops with export_missing", async () => {
    await expect(verifyExport(join(tmp(), "absent.zip"), "0".repeat(64))).rejects.toMatchObject({
      code: "export_missing",
    });
  });
});
