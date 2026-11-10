import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import type { MemberExtractor, TableTransformer } from "../application/ports.js";
import { FieldType, type FixedWidthField, type FixedWidthTable } from "../domain/fixed-width.js";

const LINE = "line";
const DECIMAL_BASE = 10;

export class DuckDbFixedWidthTransformer implements TableTransformer {
  constructor(
    private readonly extractor: MemberExtractor,
    private readonly workDir: string,
  ) {}

  async transform(archive: string, table: FixedWidthTable, output: string): Promise<number> {
    const extracted = join(this.workDir, `${table.name}-${table.member}`);
    await this.extractor.extract(archive, table.member, extracted);
    await mkdir(dirname(output), { recursive: true });

    try {
      const connection = await (await DuckDBInstance.create(":memory:")).connect();
      const columns = table.fields
        .map((field) => `${columnValue(field, table.dateFormat)} AS "${field.name}"`)
        .join(",\n  ");
      const result = await connection.runAndReadAll(
        `COPY (SELECT ${columns} FROM ${linesOf(extracted)}) TO ${sqlString(output)} (FORMAT parquet, COMPRESSION zstd)`,
      );
      return Number(result.getRows()[0]?.[0] ?? 0);
    } finally {
      await rm(extracted, { force: true });
    }
  }
}

function linesOf(path: string): string {
  return `read_csv(${sqlString(path)}, columns={'${LINE}': 'VARCHAR'}, delim=chr(1), header=false, quote='', escape='', auto_detect=false)`;
}

function columnValue(field: FixedWidthField, dateFormat: string): string {
  const raw = `NULLIF(trim(substr(${LINE}, ${field.start}, ${field.length})), '')`;
  switch (field.type) {
    case FieldType.Text:
      return raw;
    case FieldType.Integer:
      return `TRY_CAST(${raw} AS BIGINT)`;
    case FieldType.Decimal: {
      const value = `TRY_CAST(${raw} AS DOUBLE)`;
      return field.impliedDecimals === undefined
        ? value
        : `${value} / ${DECIMAL_BASE ** field.impliedDecimals}`;
    }
    case FieldType.Date:
      return `CAST(TRY_STRPTIME(${raw}, ${sqlString(dateFormat)}) AS DATE)`;
    case FieldType.Flag:
      return `CASE upper(${raw}) WHEN 'T' THEN true WHEN 'Y' THEN true WHEN 'F' THEN false WHEN 'N' THEN false END`;
  }
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
