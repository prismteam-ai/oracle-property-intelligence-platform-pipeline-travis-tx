// A-04 T021 (AC-5, FR-005, D-7, P0-15): owner fields are redacted right after parse, before
// mapping, storage and validate, on every account with a sale-confidentiality code. The
// account itself is loaded and counted. Synthetic test input shaped like the export: the four
// coded records carry the sentinel owner ZZCONFIDENTIALSENTINEL, the control ZZCONTROLOWNER.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { a04Record, exportText } from "../../fixtures/a04/tcad/export.js";
import { sha256Text, type ExportRecordText } from "../../../travis/tcad/export-stream.js";
import { createKeyInventory } from "../../../travis/tcad/key-inventory.js";
import { processChunk, type ChunkContext } from "../../../travis/tcad/process.js";
import {
  LIMITATION_RULE,
  OWNER_REDACTION_RULE,
  confidentialBasis,
  limitationsFor,
  redactRecord,
} from "../../../travis/tcad/redact.js";

const CIDS = {
  seed: "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu",
  county: "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq",
  propertyImprovement: "bafkreicyzywzwhmguojpi2otgrwsyi37le3u4lnavljbxu76cnrudxaxfu",
};
const SENTINEL = "ZZCONFIDENTIALSENTINEL";
const CONTROL = "ZZCONTROLOWNER";
const OUT = fileURLToPath(new URL("../../.out/", import.meta.url));

const CTX: ChunkContext = {
  jobId: "travis-a04-pilot-202610220100",
  asOf: "2026-10-22",
  exportSha256: "6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346",
  capturedAt: "2026-10-19T21:33:41.241Z",
};

function records(): Record<string, unknown>[] {
  const coded = (pID: number, o: Parameters<typeof a04Record>[0]) =>
    a04Record({
      ...o,
      pID,
      geoID: `090000000${pID - 900}`,
      ownerName: SENTINEL,
      firstName: "Zz",
      lastName: SENTINEL,
    });
  return [
    coded(901, { pID: 901, geoID: "", confidentialCode: "Q" }),
    coded(902, { pID: 902, geoID: "", confidentialCode: "O" }),
    coded(903, {
      pID: 903,
      geoID: "",
      saleDt: "2021-01-01 00:00:00",
      extraSales: [{ saleDt: "2001-01-01 00:00:00", confidentialCode: "Q" }],
    }),
    coded(904, { pID: 904, geoID: "", confidentialSale: true }),
    a04Record({ pID: 905, geoID: "0900000005", ownerName: `${CONTROL} LLC` }),
  ];
}

function texts(list: Record<string, unknown>[]): ExportRecordText[] {
  const arr = JSON.parse(exportText(list)) as unknown[];
  return arr.map((r, ordinal) => {
    const text = JSON.stringify(r, null, 1);
    return { ordinal, text, sha256: sha256Text(text), bytes: Buffer.byteLength(text) };
  });
}

describe("A-04-TC-014 sales confidentiality code → owner redacted before validate; loaded; limitations", () => {
  it("A-04-TC-014 redact → map → store → validate; coded owners gone, control kept, all loaded", async () => {
    const steps: string[] = [];
    const stored: Array<Record<string, unknown>> = [];
    const dir = mkdtempSync(join(tmpdir(), "a04-tc014-"));
    const result = await processChunk(texts(records()), CTX, createKeyInventory(), {
      cids: CIDS,
      trace: (step) => {
        if (steps[steps.length - 1] !== step) steps.push(step);
      },
      store: async (rows) => {
        stored.push(...rows.map((r) => r.parcel as unknown as Record<string, unknown>));
      },
      validate: async (groups) => {
        for (const g of groups) {
          mkdirSync(join(dir, g.dir), { recursive: true });
          for (const [name, body] of Object.entries(g.files))
            writeFileSync(join(dir, g.dir, name), body);
        }
      },
    });
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "A-04-TC-014.path"), dir);

    // (a) step order
    expect(steps[0]).toBe("parse");
    expect([...new Set(steps)].filter((s) => s !== "parse")).toEqual([
      "redact",
      "map",
      "store",
      "validate",
    ]);
    expect(steps.indexOf("redact")).toBeLessThan(steps.indexOf("map"));
    // (b) validate input: no person/company/mailing for the coded records; the control keeps its owner
    for (const pID of ["901", "902", "903", "904"]) {
      const names = readdirSync(join(dir, pID, "data"));
      expect(names.filter((n) => /^(person|company|mailing_address)_/.test(n))).toEqual([]);
    }
    expect(readdirSync(join(dir, "905", "data")).some((n) => n.startsWith("company_"))).toBe(true);
    const allText = ["901", "902", "903", "904"]
      .flatMap((p) =>
        readdirSync(join(dir, p, "data")).map((n) => readFileSync(join(dir, p, "data", n), "utf8")),
      )
      .join("\n");
    expect(allText).not.toContain(SENTINEL);
    expect(JSON.stringify(stored)).not.toContain(SENTINEL);
    // (c) limitations, exact texts
    expect(limitationsFor(result.summary.redacted)).toEqual([
      "Confidential owner records redacted (Texas Tax Code §25.025): 4",
      "source export carries no §25.025 marker; conservative suppression on sale-confidentiality codes",
    ]);
    // (d) all five loaded, the four with the redaction columns
    expect(result.reconciliation.map((r) => r.class)).toEqual(Array(5).fill("loaded"));
    const byId = new Map(stored.map((r) => [r.request_identifier, r]));
    for (const pID of ["901", "902", "903", "904"]) {
      expect(byId.get(pID)).toMatchObject({
        owner_redacted: true,
        owner_redaction_rule: "sales_confidential_code",
        owner_missing_reason: "owner_confidential",
        owner_name: null,
        owner_mailing_postal_code: null,
        owner_mailing_country: null,
        owner_area_class: "unknown",
      });
    }
    expect(byId.get("905")).toMatchObject({ owner_redacted: false, owner_name: `${CONTROL} LLC` });
  });

  it("A-04-TC-014 the basis is the sale code or flag only; the rule and its texts are fixed", () => {
    const [q, o, older, flag, control] = records() as Record<string, unknown>[];
    expect(confidentialBasis(q as Record<string, unknown>)).toEqual(["sales[].confidentialCode"]);
    expect(confidentialBasis(o as Record<string, unknown>)).toEqual(["sales[].confidentialCode"]);
    expect(confidentialBasis(older as Record<string, unknown>)).toEqual([
      "sales[].confidentialCode",
    ]);
    expect(confidentialBasis(flag as Record<string, unknown>)).toEqual([
      "sales[].confidentialSale",
    ]);
    expect(confidentialBasis(control as Record<string, unknown>)).toEqual([]);
    expect(OWNER_REDACTION_RULE).toBe("sales_confidential_code");
    expect(LIMITATION_RULE).toBe(
      "source export carries no §25.025 marker; conservative suppression on sale-confidentiality codes",
    );
    const red = redactRecord(q as Record<string, unknown>);
    expect(red.redacted).toBe(true);
    expect(JSON.stringify(red.record)).not.toContain(SENTINEL);
    expect(redactRecord(control as Record<string, unknown>).record).toEqual(control);
  });
});
