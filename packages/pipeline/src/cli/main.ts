#!/usr/bin/env node
import { parseArgs } from "node:util";
import { loadConfig } from "../core/config.js";
import { log } from "../core/log.js";
import { runPipeline } from "../pipeline.js";
import { publishRun } from "../publish/publish.js";
import { verifyManifest } from "../publish/verify.js";
import { writeHistory } from "../publish/history.js";

const usage = `oracle-pipeline <command> [options]

Commands:
  run       --mode full|incremental [--sources id,id] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--as-of YYYY-MM-DD]
  publish   --run <runId> [--providers name,name] [--dry-run]
  verify    --run <runId> [--gateways url,url]
  history   rebuild runs/history.json from runs/manifests/*.json
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      mode: { type: "string", default: "incremental" },
      sources: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
      "as-of": { type: "string" },
      run: { type: "string" },
      providers: { type: "string" },
      gateways: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const config = loadConfig();
  const list = (v?: string) =>
    v
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  switch (command) {
    case "run": {
      if (values.mode !== "full" && values.mode !== "incremental")
        throw new Error("--mode must be full|incremental");
      const res = await runPipeline(config, {
        mode: values.mode,
        sources: list(values.sources),
        windowStart: values.since,
        windowEnd: values.until,
        asOf: values["as-of"],
      });
      console.log(
        JSON.stringify(
          { runId: res.runId, status: res.status, exportDir: res.exportDir, derived: res.derived },
          null,
          2,
        ),
      );
      if (res.status === "failed") process.exitCode = 1;
      break;
    }
    case "publish": {
      if (!values.run) throw new Error("--run is required");
      const manifest = await publishRun(config, {
        runId: values.run,
        providers: list(values.providers),
        dryRun: values["dry-run"],
      });
      console.log(
        JSON.stringify(
          { runId: manifest.runId, rootCid: manifest.root.cid, objects: manifest.objects.length },
          null,
          2,
        ),
      );
      break;
    }
    case "verify": {
      if (!values.run) throw new Error("--run is required");
      const report = await verifyManifest(config, {
        runId: values.run,
        gateways: list(values.gateways),
      });
      console.log(JSON.stringify(report.summary, null, 2));
      if (!report.summary.allPassed) process.exitCode = 2;
      break;
    }
    case "history": {
      const h = await writeHistory(config);
      console.log(JSON.stringify({ runs: h.runs.length }, null, 2));
      break;
    }
    default:
      process.stdout.write(usage);
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((err) => {
  log.error("cli_failed", {
    error: String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exitCode = 1;
});
