import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { beforeEach, describe, expect, it } from "vitest";
import type { MemberExtractor } from "../../src/application/ports.js";
import { FieldType, type FixedWidthTable } from "../../src/domain/fixed-width.js";
import { DuckDbFixedWidthTransformer } from "../../src/infrastructure/duckdb-fixed-width-transformer.js";

const TABLE: FixedWidthTable = {
  name: "properties",
  member: "PROP.TXT",
  dateFormat: "%m-%d-%Y",
  fields: [
    { name: "prop_id", start: 1, length: 6, type: FieldType.Integer },
    { name: "owner_name", start: 7, length: 10, type: FieldType.Text },
    { name: "land_acres", start: 17, length: 6, type: FieldType.Decimal, impliedDecimals: 4 },
    { name: "area", start: 23, length: 10, type: FieldType.Decimal },
    { name: "deed_date", start: 33, length: 10, type: FieldType.Date },
    { name: "homestead", start: 43, length: 1, type: FieldType.Flag },
    { name: "homesite", start: 44, length: 1, type: FieldType.Flag },
  ],
};

const LINES = [
  "000042O'BRIEN, J0053980000175.5012-31-2013TY",
  "000043          000000          ..........FN",
];

class PlainFileExtractor implements MemberExtractor {
  readonly requests: { archive: string; member: string }[] = [];
  constructor(private readonly text: string) {}
  async extract(archive: string, member: string, destination: string) {
    this.requests.push({ archive, member });
    await writeFile(destination, this.text);
  }
}

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "travis-oracle-fw-"));
});

async function readParquet(path: string) {
  const connection = await (await DuckDBInstance.create(":memory:")).connect();
  const reader = await connection.runAndReadAll(`SELECT * FROM '${path}' ORDER BY prop_id`);
  return reader.getRowObjectsJson();
}

describe("DuckDbFixedWidthTransformer", () => {
  it("cuts each record at the layout's offsets and types every column", async () => {
    const extractor = new PlainFileExtractor(`${LINES.join("\r\n")}\r\n`);
    const output = join(workDir, "tables", "properties.parquet");

    const rows = await new DuckDbFixedWidthTransformer(extractor, workDir).transform(
      "/archives/export.zip",
      TABLE,
      output,
    );

    expect(rows).toBe(2);
    expect(extractor.requests).toEqual([{ archive: "/archives/export.zip", member: "PROP.TXT" }]);
    expect(await readParquet(output)).toEqual([
      {
        prop_id: "42",
        owner_name: "O'BRIEN, J",
        land_acres: 0.5398,
        area: 175.5,
        deed_date: "2013-12-31",
        homestead: true,
        homesite: true,
      },
      {
        prop_id: "43",
        owner_name: null,
        land_acres: 0,
        area: null,
        deed_date: null,
        homestead: false,
        homesite: false,
      },
    ]);
  });
});
