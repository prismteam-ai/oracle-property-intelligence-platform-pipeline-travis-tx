// A-07 T009 (Track A, Foundational): the single shared Comptroller adapter (Socrata
// `9cir-efmm`, Travis-scoped, county code 227 per D-1/D-6). One writer; Track C's business
// transform (T039) reads the same loaded snapshot, never a second fetch. Must fail before
// T010 (travis/adapters/socrata/tx-comptroller.ts) lands.
//
// Fixes staging (in-memory upsert across pages, keyed on taxpayer_number, later page wins),
// the `:updated_at` watermark (max across all rows read) and the snapshot digest (sha256 of
// the canonically sorted row set, AD-26 pattern) for T010 and the T017 Loader track.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPTROLLER_SOURCE,
  TRAVIS_COUNTY_WHERE,
  loadComptrollerRegistry,
  registrySnapshotDigest,
  stageComptrollerRows,
  type ComptrollerRow,
} from "../../../../travis/adapters/socrata/tx-comptroller.js";
import { createSourceClient } from "../../../../travis/lib/source-client.js";
import { fakeHttp, json, silent } from "../../../fixtures/fake-http.js";

const BASE = "https://data.texas.gov/resource/9cir-efmm.json";

function rawRow(n: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ":id": `row-${n}`,
    ":updated_at": "2026-10-19T21:00:00.000Z",
    taxpayer_number: `3200000000${n}`,
    taxpayer_name: `SYNTHETIC ROOFING ${n} CO`,
    taxpayer_county_code: "227",
    sos_status_code: "A",
    secretary_of_state_sos_or_coa_file_number: `SOS-${n}`,
    ...over,
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function jobDir(): string {
  const d = mkdtempSync(join(tmpdir(), "a07-comptroller-"));
  dirs.push(d);
  return d;
}

describe("COMPTROLLER_SOURCE / TRAVIS_COUNTY_WHERE", () => {
  it("names the 9cir-efmm dataset and the Travis county-227 filter", () => {
    expect(COMPTROLLER_SOURCE.domain).toBe("data.texas.gov");
    expect(COMPTROLLER_SOURCE.dataset).toBe("9cir-efmm");
    expect(TRAVIS_COUNTY_WHERE).toContain("227");
  });
});

describe("registrySnapshotDigest", () => {
  it("is a deterministic sha256 independent of input row order", () => {
    const a: ComptrollerRow[] = [
      {
        taxpayerNumber: "1",
        legalName: "A",
        sosStatusCode: "ACTIVE",
        mailingAddress: null,
        sosFileNumber: null,
      },
      {
        taxpayerNumber: "2",
        legalName: "B",
        sosStatusCode: "ACTIVE",
        mailingAddress: null,
        sosFileNumber: null,
      },
    ];
    const b = [...a].reverse();
    const digestA = registrySnapshotDigest(a);
    const digestB = registrySnapshotDigest(b);
    expect(digestA).toBe(digestB);
    expect(digestA).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when a row changes", () => {
    const a: ComptrollerRow[] = [
      {
        taxpayerNumber: "1",
        legalName: "A",
        sosStatusCode: "ACTIVE",
        mailingAddress: null,
        sosFileNumber: null,
      },
    ];
    const b: ComptrollerRow[] = [
      {
        taxpayerNumber: "1",
        legalName: "A CHANGED",
        sosStatusCode: "ACTIVE",
        mailingAddress: null,
        sosFileNumber: null,
      },
    ];
    expect(registrySnapshotDigest(a)).not.toBe(registrySnapshotDigest(b));
  });
});

describe("stageComptrollerRows (in-memory upsert, ON CONFLICT keyed on taxpayer_number)", () => {
  it("a later page's row for the same taxpayer_number replaces the earlier one", () => {
    const existing = new Map<string, ComptrollerRow>([
      [
        "1",
        {
          taxpayerNumber: "1",
          legalName: "OLD NAME",
          sosStatusCode: "ACTIVE",
          mailingAddress: null,
          sosFileNumber: null,
        },
      ],
    ]);
    const staged = stageComptrollerRows(existing, [
      {
        taxpayerNumber: "1",
        legalName: "NEW NAME",
        sosStatusCode: "ACTIVE",
        mailingAddress: null,
        sosFileNumber: null,
      },
      {
        taxpayerNumber: "2",
        legalName: "ANOTHER",
        sosStatusCode: "ACTIVE",
        mailingAddress: null,
        sosFileNumber: null,
      },
    ]);
    expect(staged.get("1")?.legalName).toBe("NEW NAME");
    expect(staged.size).toBe(2);
    // the input map is untouched (pure staging, never mutated in place)
    expect(existing.get("1")?.legalName).toBe("OLD NAME");
  });
});

describe("loadComptrollerRegistry (staging + watermark + digest, over a fake Socrata host)", () => {
  it("pages until a short page, stages every row once, and records the max :updated_at watermark", async () => {
    const dir = jobDir();
    const { fetch } = fakeHttp([
      {
        match: (u) => u.href.startsWith(BASE),
        respond: (u) => {
          const where = u.searchParams.get("$where") ?? "";
          // Page 1 (no cursor): a full page (3 rows, the pageSize) so a second page is asked.
          // Page 2 (cursor row-3): 1 row, below pageSize, so paging stops there.
          const rows = where.includes(":id >")
            ? [rawRow(4, { ":updated_at": "2026-10-20T00:00:00.000Z" })]
            : [rawRow(1), rawRow(2), rawRow(3)];
          return json(rows);
        },
      },
    ]);
    const client = createSourceClient({
      fetch,
      sleep: async () => undefined,
      log: silent,
      appToken: "",
    });
    const result = await loadComptrollerRegistry({ client, jobDir: dir, pageSize: 3 });
    expect(result.status).toBe("ok");
    expect(result.pages).toBe(2);
    expect(result.rowCount).toBe(4);
    expect(result.watermark).toBe("2026-10-20T00:00:00.000Z");
    expect(result.snapshotDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.rows.map((r) => r.taxpayerNumber).sort()).toEqual([
      "32000000001",
      "32000000002",
      "32000000003",
      "32000000004",
    ]);

    const staged = JSON.parse(readFileSync(join(dir, "registry-rows.json"), "utf8")) as {
      mappingVersion: string;
      rows: unknown[];
    };
    expect(staged.mappingVersion.length).toBeGreaterThan(0);
    expect(staged.rows.length).toBe(4);
  });
});
