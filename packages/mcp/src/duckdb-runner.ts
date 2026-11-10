import { type DuckDBConnection, StatementType } from "@duckdb/node-api";
import { type Row, type SqlRunner, ToolInputError } from "@travis-oracle/query-core";

const SINGLE_STATEMENT = 1;

export class DuckDbRunner implements SqlRunner {
  constructor(private readonly connection: DuckDBConnection) {}

  async all(sql: string): Promise<Row[]> {
    return (await this.connection.runAndReadAll(sql)).getRowObjectsJson() as Row[];
  }

  async readOnly(sql: string, maxRows: number): Promise<Row[]> {
    const statements = await this.connection.extractStatements(sql);
    if (statements.count !== SINGLE_STATEMENT) {
      throw new ToolInputError("Send exactly one statement.");
    }
    const prepared = await statements.prepare(0);
    if (prepared.statementType !== StatementType.SELECT) {
      throw new ToolInputError("Only read-only SELECT queries are allowed.");
    }
    const reader = await prepared.runAndReadUntil(maxRows);
    return (reader.getRowObjectsJson() as Row[]).slice(0, maxRows);
  }
}
