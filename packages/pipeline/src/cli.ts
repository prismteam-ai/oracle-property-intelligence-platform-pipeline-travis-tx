import { parseArgs } from "node:util";
import { runBuild } from "./commands/build-command.js";
import { isSourceId, runIngest } from "./commands/ingest-command.js";
import { runPublish } from "./commands/publish-command.js";
import { runVerify } from "./commands/verify-command.js";
import { isoDateOf } from "./domain/iso-date.js";
import { runIdAt } from "./domain/run-id.js";

const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_DATA_DIR = "data";
const DEFAULT_BUDGET_MINUTES = 20;

enum Command {
  Ingest = "ingest",
  Build = "build",
  Publish = "publish",
  Verify = "verify",
}

const USAGE = [
  "usage: cli ingest austin-permits [--since YYYY-MM-DD] [--lookback-days N] [--data-dir DIR] [--run-id ID]",
  "       cli ingest tcad-appraisal-export [--data-dir DIR] [--run-id ID]",
  "       cli ingest tcad-parcels [--data-dir DIR] [--run-id ID]",
  "       cli ingest travis-address-points [--data-dir DIR] [--run-id ID]",
  "       cli ingest bbb-archive [--budget-minutes N] [--data-dir DIR] [--run-id ID]",
  "       cli ingest tx-sales-tax-permits|tx-franchise-taxpayers|tdlr-licenses [--data-dir DIR] [--run-id ID]",
  "       cli build [--as-of YYYY-MM-DD] [--data-dir DIR] [--run-id ID]",
  "       cli publish [--run-id BUILD_ID] [--dry-run] [--data-dir DIR]",
  "       cli verify --cid MANIFEST_CID",
].join("\n");

async function main(argv: string[]): Promise<unknown> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      since: { type: "string" },
      "lookback-days": { type: "string", default: String(DEFAULT_LOOKBACK_DAYS) },
      "data-dir": { type: "string", default: DEFAULT_DATA_DIR },
      "run-id": { type: "string" },
      "as-of": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      cid: { type: "string" },
      "budget-minutes": { type: "string", default: String(DEFAULT_BUDGET_MINUTES) },
    },
  });

  const [command, source] = positionals;
  const dataDir = values["data-dir"];
  const runId = values["run-id"] ?? runIdAt(new Date());

  switch (command) {
    case Command.Ingest:
      if (!isSourceId(source)) throw new Error(USAGE);
      return runIngest(source, {
        dataDir,
        runId,
        lookbackDays: Number(values["lookback-days"]),
        since: values.since,
        budgetMinutes: Number(values["budget-minutes"]),
      });
    case Command.Build:
      return runBuild(dataDir, runId, values["as-of"] ?? isoDateOf(new Date().toISOString()));
    case Command.Publish:
      return runPublish(dataDir, values["run-id"], values["dry-run"]);
    case Command.Verify:
      if (!values.cid) throw new Error(USAGE);
      return runVerify(values.cid);
    default:
      throw new Error(USAGE);
  }
}

main(process.argv.slice(2))
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
