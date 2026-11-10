import { access } from "node:fs/promises";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const CONTRACTORS_TABLE = "contractors.parquet";

export async function contractorKeysOf(buildDir: string | undefined): Promise<Set<string>> {
  if (buildDir === undefined) return new Set();
  const table = join(buildDir, CONTRACTORS_TABLE);
  try {
    await access(table);
  } catch {
    return new Set();
  }
  const connection = await (await DuckDBInstance.create(":memory:")).connect();
  const reader = await connection.runAndReadAll(
    `SELECT DISTINCT contractor_key FROM read_parquet('${table.replaceAll("'", "''")}') WHERE contractor_key IS NOT NULL AND roofing_permits > 0`,
  );
  return new Set(reader.getRows().map(([key]) => String(key)));
}
