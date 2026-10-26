// A-11: builds a run manifest (Run 2 and later; also the pilot) from batched outputs through
// the real buildManifest(), carrying the source facts, profiles, coverage and limitations over
// from a base manifest (default: Run 1's) because the run captured nothing new. Logic lives in
// src/run-manifest.ts; this is the argv/config wrapper. Nothing here uploads or publishes.
//
// Real run (writes runs/<runId>/manifest.json, the exact JCS bytes of built.bytes):
//   npx tsx pipeline/publish/scripts/build-run-manifest.ts \
//     --run-id travis-full-run2-20261024 --started-at <iso> --finished-at <iso> \
//     --previous-manifest-cid bafkreiddef7ssybq6m4wpmah7adposaxbiawaxcmqndzk36wyhd7k4h6gu \
//     --county-dir pipeline/data/runs/travis-a04-20261022052658/publish-dry-run/county-batched \
//     --permits-dir pipeline/data/runs/<permits run>/publish-dry-run/permits-batched
// Pilot (writes specs/011-publish-and-runs/pilot/manifest.json, refuses any runs/ path; the
// run id must not contain the word "pilot": buildManifest and the runs index reject it):
//   ... --pilot --run-id travis-full-run2-trial-20261024 ...
// Or `--config <file.json>` holding the same keys in camelCase (flags win over the file).
//
// Other flags: --county-batches 1-10, --permits-batches 1-2 (default: every batch found),
// --base <manifest> (default Run 1's), --austin-receipt, --tcad-receipt, --out (pilot only),
// --linked-permits N (Run 1: 2007514; A-16 #6 check: five exclusions + N must equal the Austin records),
// --austin-facts <file> (an incremental run: the facts file written by incremental-facts.ts, with
// --austin-receipt <the receipt beside it> and --base <the previous run's manifest>),
// --overwrite (replace an existing manifest with different bytes; refused once indexed).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  buildRunManifest,
  manifestOutputPath,
  requireLinkedPermits,
  writeManifestBytes,
  type RunManifestConfig,
} from "../src/run-manifest.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function batchList(text: string | undefined): number[] | undefined {
  if (text === undefined) return undefined;
  return text.split(",").flatMap((part) => {
    const range = /^(\d+)-(\d+)$/.exec(part.trim());
    if (range !== null) {
      const [from, to] = [Number(range[1]), Number(range[2])];
      return Array.from({ length: to - from + 1 }, (_, i) => from + i);
    }
    if (!/^\d+$/.test(part.trim())) throw new Error(`bad batch list "${text}"`);
    return [Number(part)];
  });
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      "run-id": { type: "string" },
      "started-at": { type: "string" },
      "finished-at": { type: "string" },
      "previous-manifest-cid": { type: "string" },
      "county-dir": { type: "string" },
      "permits-dir": { type: "string" },
      "county-batches": { type: "string" },
      "permits-batches": { type: "string" },
      base: { type: "string" },
      "austin-receipt": { type: "string" },
      "tcad-receipt": { type: "string" },
      "austin-facts": { type: "string" },
      "linked-permits": { type: "string" },
      out: { type: "string" },
      pilot: { type: "boolean", default: false },
      overwrite: { type: "boolean", default: false },
    },
    strict: true,
  });
  const fromFile: Record<string, unknown> =
    values.config === undefined
      ? {}
      : (JSON.parse(readFileSync(values.config, "utf8")) as Record<string, unknown>);
  const flags: Record<string, unknown> = {
    runId: values["run-id"],
    startedAt: values["started-at"],
    finishedAt: values["finished-at"],
    previousManifestCid: values["previous-manifest-cid"],
    countyDir: values["county-dir"],
    permitsDir: values["permits-dir"],
    countyBatches: batchList(values["county-batches"]),
    permitsBatches: batchList(values["permits-batches"]),
    baseManifest: values.base,
    austinReceipt: values["austin-receipt"],
    tcadReceipt: values["tcad-receipt"],
    austinFacts: values["austin-facts"],
    linkedPermits:
      values["linked-permits"] === undefined ? undefined : Number(values["linked-permits"]),
  };
  const config = { ...fromFile };
  for (const [k, v] of Object.entries(flags)) if (v !== undefined) config[k] = v;

  const runId = config.runId;
  if (typeof runId !== "string") {
    console.error("--run-id (or runId in --config) is required");
    return 2;
  }
  const outPath = manifestOutputPath({
    repoRoot: REPO_ROOT,
    runId,
    pilot: values.pilot,
    ...(values.out === undefined ? {} : { out: values.out }),
  });
  // An incremental run takes its linked-permit total from the facts file; the builder cross-checks it.
  if (config.austinFacts === undefined)
    requireLinkedPermits(config as RunManifestConfig, values.pilot);
  const built = await buildRunManifest(config as RunManifestConfig, { repoRoot: REPO_ROOT });
  // built.bytes are the exact JCS bytes the manifest CID names; never re-serialize them.
  const outcome = writeManifestBytes(outPath, built, values.overwrite);

  const byKind = new Map<string, number>();
  let totalBytes = 0;
  for (const a of built.manifest.artifacts) {
    byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
    totalBytes += a.size;
  }
  console.log(
    `${outcome} ${outPath.startsWith(REPO_ROOT) ? outPath.slice(REPO_ROOT.length) : outPath}`,
  );
  console.log(`manifest CID: ${built.cid}`);
  console.log(
    `artifacts: ${built.manifest.artifacts.length} (${[...byKind.entries()]
      .map(([k, n]) => `${n} ${k}`)
      .join(", ")}), ${totalBytes} bytes`,
  );
  console.log(
    `previousManifestCid: ${String(built.manifest.previousManifestCid)}; coverage.permits_emitted: ${JSON.stringify(built.manifest.coverage.permits_emitted)}`,
  );
  console.log(
    `next: publish-run.ts --manifest ${join(outPath)} ${values.pilot ? "--pilot " : ""}--run-id ${runId} --dry-run`,
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
