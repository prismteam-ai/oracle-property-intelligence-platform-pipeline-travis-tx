// Offline rescan of an already-downloaded TCAD export (no network). Every record, file and
// catalog value here is synthetic (test-only); a temporary repository root holds the
// catalog and the export, and the validator is an injected stand-in.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Catalog } from "../travis/discovery/catalog.schema.js";
import { rescanTcad } from "../travis/discovery/rescan-tcad.js";
import { readCatalog, writeCatalog } from "../travis/discovery/write-catalog.js";
import { syntheticCatalog } from "./fixtures/synthetic-catalog.js";
import { buildZip } from "./fixtures/synthetic-zip.js";
import { must } from "./helpers.js";

const CATALOG_REL = "pipeline/docs/travis-sources.yaml";
const EXPORT_REL = "pipeline/data/raw/tcad/synthetic-export.zip";
const CAPTURED = "2026-01-01T00:00:00.000Z";

const records = (ids: number[]) =>
  ids.map((pID) => ({
    pID,
    propertyIdentification: [{ geoID: `G${pID}`, pID }],
    deeds: [{ deedDt: "2001-01-01T00:00:00", pID }],
  }));

const parcelOf = (c: Catalog) => must(c.parcel, "parcel");

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  catalogPath: string;
  exportPath: string;
  bytes: Buffer;
}

/** A repo root with a catalog whose parcel block lacks the key, and the export it names. */
function fixture(opts: { ids?: number[]; receiptSha?: string; count?: number } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "rescan-tcad-"));
  tmpDirs.push(root);
  const ids = opts.ids ?? [101, 102, 103];
  const bytes = buildZip([
    { name: "Synthetic-protaxExport.json", data: Buffer.from(JSON.stringify(records(ids))) },
  ]);
  const exportPath = join(root, EXPORT_REL);
  mkdirSync(dirname(exportPath), { recursive: true });
  writeFileSync(exportPath, bytes);

  const cat = syntheticCatalog();
  const count = opts.count ?? ids.length;
  const { identifier_name: _n, identifier_format: _f, ...parcel } = parcelOf(cat);
  cat.parcel = {
    ...parcel,
    identifier_proven: false,
    deed_or_sale_dates_present: true,
    assessed_parcel_count: count,
    assessed_parcel_count_measurement: {
      value: count,
      source_url: "https://example.test/export.zip",
      captured_at: CAPTURED,
      method: "streaming count",
    },
    export_receipt: {
      url: "https://example.test/export.zip",
      method: "GET",
      status: 200,
      bytes: bytes.length,
      sha256: opts.receiptSha ?? createHash("sha256").update(bytes).digest("hex"),
      captured_at: CAPTURED,
      user_agent: "synthetic-agent",
      attempts: 1,
      outcome: "ok",
      file_path: EXPORT_REL,
      seconds: 1,
      megabytes_per_minute: 1,
      roll_year: 2026,
    },
  };
  const catalogPath = join(root, CATALOG_REL);
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeCatalog(cat, catalogPath);
  return { root, catalogPath, exportPath, bytes };
}

function run(f: Fixture, validatorCode = 0) {
  const lines: string[] = [];
  let validatorCalls = 0;
  const done = rescanTcad({
    repoRoot: f.root,
    catalogPath: f.catalogPath,
    validate: async () => {
      validatorCalls += 1;
      return validatorCode;
    },
    out: (l) => lines.push(l),
  });
  return done.then((code) => ({ code, lines, validatorCalls: () => validatorCalls }));
}

describe("rescanTcad", () => {
  it("rewrites only the parcel identifier fields and re-runs the validator", async () => {
    const f = fixture();
    const before = readCatalog(f.catalogPath);
    const { code, validatorCalls, lines } = await run(f);
    expect(code).toBe(0);
    expect(validatorCalls()).toBe(1);
    const after = readCatalog(f.catalogPath);
    expect(parcelOf(after).identifier_name).toBe("pID");
    expect(parcelOf(after).identifier_layout_name).toBe("prop_id");
    expect(parcelOf(after).identifier_proven).toBe(true);
    expect(parcelOf(after).identifier_format).toBe("integer, 3 digits");
    // provenance stays the original download's: receipt, count measurement, snapshot time
    expect(parcelOf(after).export_receipt).toEqual(parcelOf(before).export_receipt);
    expect(parcelOf(after).assessed_parcel_count_measurement).toEqual(
      parcelOf(before).assessed_parcel_count_measurement,
    );
    expect(after.snapshot_time).toBe(before.snapshot_time);
    const strip = (c: Catalog) => {
      const {
        identifier_name: _n,
        identifier_layout_name: _l,
        identifier_proven: _p,
        identifier_format: _f,
        ...rest
      } = parcelOf(c);
      const { amendments: _a, ...cat } = c;
      return { ...cat, parcel: rest };
    };
    expect(strip(after)).toEqual(strip(before));
    // OR-M5: the change is recorded as an amendment naming the fields and the export
    const amendment = must(after.amendments?.at(-1));
    expect(amendment.command).toBe("rescan-tcad");
    expect(amendment.fields).toContain("parcel.identifier_name");
    expect(amendment.ref).toContain(parcelOf(before).export_receipt?.sha256 ?? "missing");
    expect(lines.join("\n")).toMatch(/sha256 matches the export receipt/);
    expect(lines.join("\n")).not.toMatch(/G101|101,/);
  });

  it("passes the validator's exit code through (1 = BLOCKED for another gate)", async () => {
    const { code } = await run(fixture(), 1);
    expect(code).toBe(1);
  });

  it("refuses when the file's SHA-256 does not match the receipt: nothing written, no validator", async () => {
    const f = fixture({ receiptSha: "0".repeat(64) });
    const before = readFileSync(f.catalogPath, "utf8");
    const { code, validatorCalls, lines } = await run(f);
    expect(code).toBe(2);
    expect(validatorCalls()).toBe(0);
    expect(readFileSync(f.catalogPath, "utf8")).toBe(before);
    expect(lines.join("\n")).toMatch(/SHA-256.*does not match.*fresh discovery run/i);
  });

  it("refuses when the file size differs from the receipt (a truncated or replaced file)", async () => {
    const f = fixture();
    writeFileSync(f.exportPath, f.bytes.subarray(0, f.bytes.length - 1));
    const before = readFileSync(f.catalogPath, "utf8");
    const { code, validatorCalls } = await run(f);
    expect(code).toBe(2);
    expect(validatorCalls()).toBe(0);
    expect(readFileSync(f.catalogPath, "utf8")).toBe(before);
  });

  it("refuses when the export file is missing", async () => {
    const f = fixture();
    rmSync(f.exportPath);
    const { code, lines } = await run(f);
    expect(code).toBe(2);
    expect(lines.join("\n")).toMatch(/not found/);
  });

  it("refuses when the catalog has no export receipt (nothing downloaded to rescan)", async () => {
    const f = fixture();
    const cat = readCatalog(f.catalogPath);
    const { export_receipt: _r, ...parcel } = parcelOf(cat);
    writeCatalog({ ...cat, parcel }, f.catalogPath);
    const { code, lines } = await run(f);
    expect(code).toBe(2);
    expect(lines.join("\n")).toMatch(/no export_receipt/);
  });

  it("refuses when the rescan count disagrees with the recorded roll count", async () => {
    const f = fixture({ count: 4 });
    const before = readFileSync(f.catalogPath, "utf8");
    const { code, validatorCalls, lines } = await run(f);
    expect(code).toBe(2);
    expect(validatorCalls()).toBe(0);
    expect(readFileSync(f.catalogPath, "utf8")).toBe(before);
    expect(lines.join("\n")).toMatch(/count 3 != recorded assessed_parcel_count 4/);
  });

  it("records an unproven key honestly (duplicate pID)", async () => {
    const f = fixture({ ids: [7, 7, 8] });
    // make geoIDs collide too so no candidate is proven
    writeFileSync(
      f.exportPath,
      buildZip([
        {
          name: "Synthetic-protaxExport.json",
          data: Buffer.from(
            JSON.stringify(
              [7, 7, 8].map((pID) => ({ pID, propertyIdentification: [{ geoID: "G", pID }] })),
            ),
          ),
        },
      ]),
    );
    const cat = readCatalog(f.catalogPath);
    const bytes = readFileSync(f.exportPath);
    const parcel = parcelOf(cat);
    parcel.export_receipt = {
      ...must(parcel.export_receipt, "export_receipt"),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    writeCatalog(cat, f.catalogPath);
    const { code } = await run(f);
    expect(code).toBe(0);
    const after = readCatalog(f.catalogPath);
    expect(parcelOf(after).identifier_name).toBe("pID");
    expect(parcelOf(after).identifier_proven).toBe(false);
  });
});
