import { DuckDBInstance } from "@duckdb/node-api";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveDataset } from "./dataset-source.js";
import { DuckDbRunner } from "./duckdb-runner.js";
import { createServer } from "./server.js";

const DEFAULT_EXPLORER = "https://travis-oracle-explorer.curiousily.workers.dev";

const explorerUrl = process.env.TRAVIS_ORACLE_EXPLORER ?? DEFAULT_EXPLORER;
const gatewayUrl = process.env.TRAVIS_ORACLE_GATEWAY ?? explorerUrl;
const dataset = await resolveDataset({
  explorerUrl,
  gatewayUrl,
  rootCid: process.env.TRAVIS_ORACLE_ROOT_CID,
  fetch,
});

const connection = await (await DuckDBInstance.create(":memory:")).connect();
for (const table of dataset.tables) {
  await connection.run(
    `CREATE VIEW ${table} AS SELECT * FROM read_parquet('${dataset.tableUrl(table)}')`,
  );
}
await connection.run(`SET allowed_directories = ['${dataset.rootUrl}']`);
await connection.run("SET enable_external_access = false");
await connection.run("SET lock_configuration = true");

await createServer({ sql: new DuckDbRunner(connection), dataset: dataset.info }).connect(
  new StdioServerTransport(),
);
console.error(`travis-oracle MCP serving dataset ${dataset.info.rootCid} from ${dataset.rootUrl}`);
