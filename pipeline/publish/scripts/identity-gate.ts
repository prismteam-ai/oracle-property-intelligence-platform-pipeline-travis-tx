// Stop check before a publish: binds the manifest about to be published with query-core's
// bindManifest (the code the browser runs) and fails unless every Property Improvement property
// is a published County property (same CID) and v_roofing_permit returns the manifest's count.
// The logic lives in src/identity-gate.ts (the publish driver runs it as its mandatory `gate` and
// `gate-remote` steps); this file is the command line over it. Read-only: no upload, no DB.
//
// Usage: npx tsx scripts/identity-gate.ts --manifest <path> [--copy-host <host>]
//          [--expect-permits <n>] [--pids <file>] [--root <dir>] [--remote-only]
// Parts are read from the local file when it exists under --root and hashes to the manifest;
// otherwise from the CID copy. --remote-only never reads a local part.
import { readFileSync } from "node:fs";
import { runIdentityGate } from "../src/identity-gate.js";
import { openDuckDbEngine } from "./duckdb-engine.js";

function parseArgs(argv: readonly string[]) {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const manifest = value("--manifest");
  if (manifest === undefined) throw new Error("--manifest <path> is required");
  const copyHost = value("--copy-host") ?? process.env.CID_COPY_HOST;
  if (copyHost === undefined || copyHost === "") {
    throw new Error("--copy-host or CID_COPY_HOST is required");
  }
  const expect = value("--expect-permits");
  const pidsFile = value("--pids");
  return {
    manifestPath: manifest,
    copyHost,
    expectPermits: expect === undefined ? null : Number(expect),
    pids:
      pidsFile === undefined
        ? null
        : readFileSync(pidsFile, "utf8")
            .split(/\s+/)
            .filter((p) => p !== ""),
    root: value("--root") ?? process.cwd(),
    remoteOnly: argv.includes("--remote-only"),
  };
}

async function main(): Promise<void> {
  const summary = await runIdentityGate({
    ...parseArgs(process.argv.slice(2)),
    openEngine: openDuckDbEngine,
  });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.result !== "PASS") process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`[identity-gate] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
