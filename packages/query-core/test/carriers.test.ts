// T052 (A-02, FR-001 / AC-1): the carrier verdicts in docs/decisions/0002-lexicon-carriers.md.
// Written first; the ADR is T053.
//
// The ADR's "## Verdicts" table has one row per AC-1 field:
//   | # | Field | Verdict | Carrier | Schema cache | Pilot row | Fallback | Drafted request |
// - Verdict ∈ {carrier, no_carrier, no_carrier_not_emitted}.
// - carrier: Carrier is `class.property`, Schema cache cites ~/.elephant-cli/schema-cache/,
//   Pilot row is `{table: <t>, cid: <cid>}`; the committed class schema snapshot
//   (test/fixtures/schemas/<class>.json) has the property; with PILOT_DIR set, the pilot
//   Parquet row with that cid exists and its value is non-null.
// - no_carrier*: Fallback names AD-24 or AD-25, and Drafted request names a request id
//   listed under "## Drafted extension requests".
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ADR = join(ROOT, "docs/decisions/0002-lexicon-carriers.md");
const SCHEMAS = fileURLToPath(new URL("./fixtures/schemas/", import.meta.url));

export const AC1_FIELDS = [
  "printed contractor name",
  "status_raw",
  "expiry_date",
  "BBB rating",
  "BBB profile URL",
  "per-permit contractor state",
  "roof_age_basis",
  "roof_age_confidence",
  "owner sale date",
] as const;

const VERDICTS = ["carrier", "no_carrier", "no_carrier_not_emitted"] as const;

interface VerdictRow {
  field: string;
  verdict: string;
  carrier: string;
  schemaCache: string;
  pilotRow: string;
  fallback: string;
  request: string;
}

const strip = (cell: string): string => cell.trim().replace(/^`|`$/g, "").trim();

function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}`);
  if (start < 0) return "";
  const rest = text.slice(start + 1);
  const next = rest.indexOf("\n## ", 3);
  return next < 0 ? rest : rest.slice(0, next);
}

function frontMatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return {};
  return Object.fromEntries(
    (m[1] as string)
      .split("\n")
      .map((l) => /^([a-z_]+):\s*(.*)$/.exec(l))
      .filter((x): x is RegExpExecArray => x !== null)
      .map((x) => [x[1] as string, (x[2] as string).replace(/^"|"$/g, "")]),
  );
}

function verdictRows(text: string): VerdictRow[] {
  return section(text, "Verdicts")
    .split("\n")
    .filter((l) => /^\|\s*\d+\s*\|/.test(l))
    .map((l) => {
      const cells = l.split("|").slice(1, -1).map(strip);
      return {
        field: cells[1] ?? "",
        verdict: cells[2] ?? "",
        carrier: cells[3] ?? "",
        schemaCache: cells[4] ?? "",
        pilotRow: cells[5] ?? "",
        fallback: cells[6] ?? "",
        request: cells[7] ?? "",
      };
    });
}

function parsePilotRow(cell: string): { table: string; cid: string } | null {
  const m = /\{\s*table:\s*([a-z_]+)\s*,\s*cid:\s*(b[a-z2-7]+)\s*\}/.exec(cell);
  return m ? { table: m[1] as string, cid: m[2] as string } : null;
}

const text = existsSync(ADR) ? readFileSync(ADR, "utf8") : "";
const rows = verdictRows(text);

describe("ADR-0002 lexicon carriers", () => {
  it("exists with ADR front matter", () => {
    expect(existsSync(ADR), ADR).toBe(true);
    expect(frontMatter(text)).toMatchObject({
      id: "ADR-0002",
      parent: "ARD-A",
      story: "A-02",
      status: "Accepted",
    });
    expect(frontMatter(text).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has exactly the nine AC-1 fields, each with one verdict", () => {
    expect(rows.map((r) => r.field)).toEqual([...AC1_FIELDS]);
    for (const r of rows) expect(VERDICTS, r.field).toContain(r.verdict);
  });

  it("every carrier names class.property, a schema-cache entry and a pilot row", () => {
    for (const r of rows.filter((x) => x.verdict === "carrier")) {
      expect(r.carrier, r.field).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(r.schemaCache, r.field).toContain("~/.elephant-cli/schema-cache/");
      expect(parsePilotRow(r.pilotRow), r.field).not.toBeNull();
      const [cls, prop] = r.carrier.split(".") as [string, string];
      const schemaFile = join(SCHEMAS, `${cls}.json`);
      expect(existsSync(schemaFile), schemaFile).toBe(true);
      const schema = JSON.parse(readFileSync(schemaFile, "utf8")) as {
        properties: Record<string, unknown>;
      };
      expect(Object.keys(schema.properties), r.carrier).toContain(prop);
    }
  });

  it("every no-carrier verdict names its fallback (AD-24 or AD-25) and a drafted request", () => {
    const drafted = section(text, "Drafted extension requests");
    expect(drafted).toMatch(/drafted, not filed \(PO decision D-1\)/);
    for (const r of rows.filter((x) => x.verdict !== "carrier")) {
      expect(r.fallback, r.field).toMatch(/AD-2[45]/);
      const ids = r.request.match(/R\d+/g) ?? [];
      expect(ids.length, r.field).toBeGreaterThan(0);
      for (const id of ids)
        expect(drafted, `${r.field} ${id}`).toMatch(new RegExp(`\\*\\*${id}\\b`));
    }
  });

  it("the schema snapshot index lists a CID for every snapshot file", () => {
    const index = JSON.parse(readFileSync(join(SCHEMAS, "index.json"), "utf8")) as Record<
      string,
      { cid: string }
    >;
    const files = readdirSync(SCHEMAS).filter((f) => f.endsWith(".json") && f !== "index.json");
    expect(files.length).toBeGreaterThan(0);
    for (const f of files)
      expect(index[f.replace(/\.json$/, "")]?.cid, f).toMatch(/^bafkrei[a-z2-7]{52}$/);
  });

  it.runIf(process.env.PILOT_DIR !== undefined)(
    "each carrier's pilot row exists in the pilot Parquet with a non-null value",
    async () => {
      const { DuckDBInstance } = await import("@duckdb/node-api");
      const db = await DuckDBInstance.create(":memory:");
      const conn = await db.connect();
      const dir = process.env.PILOT_DIR as string;
      for (const r of rows.filter((x) => x.verdict === "carrier")) {
        const row = parsePilotRow(r.pilotRow) as { table: string; cid: string };
        const prop = r.carrier.split(".")[1] as string;
        const glob = join(dir, "tables", "*", row.table, "*.parquet").replace(/'/g, "''");
        const result = await conn.runAndReadAll(
          `SELECT "${prop}" AS v FROM read_parquet('${glob}') WHERE cid = '${row.cid}'`,
        );
        const values = result.getRowObjects();
        expect(values, `${r.field} ${row.table} ${row.cid}`).toHaveLength(1);
        expect(values[0]?.v, r.field).not.toBeNull();
      }
      conn.closeSync();
    },
  );
});
