// A-11, AD-22: thin CLI wrapper over ../src/pinata-pin.ts. Reads PINATA_JWT from the real
// process.env (never from a committed file, never logged) and pins one CID — or, as a fallback,
// one local file — to Pinata via Pinata's own REST API, polling until Pinata actually reports
// the CID as present (not just an initial ack).
//
// Usage:
//   PINATA_JWT=... npx tsx pipeline/publish/scripts/pinata-pin.ts --cid=<cid> [--name=<name>]
//   PINATA_JWT=... npx tsx pipeline/publish/scripts/pinata-pin.ts --cid=<cid> --file=<path> [--name=<name>]
//
// This script only pins. It never touches the manifest, runs/index.json, the GitHub Release, or
// docs/atlas-pr.md — those are wired up separately once the primary (Filebase) upload's real
// CIDs are known.
import { pinataPin } from "../src/pinata-pin.js";

function argValue(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return found?.slice(prefix.length);
}

async function main(): Promise<void> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    console.error("PINATA_JWT is not set in the environment");
    process.exitCode = 1;
    return;
  }
  const cid = argValue("cid");
  const filePath = argValue("file");
  const name = argValue("name");
  if (!cid && !filePath) {
    console.error("usage: pinata-pin.ts --cid=<cid> [--file=<path>] [--name=<name>]");
    process.exitCode = 1;
    return;
  }
  const args: { cid?: string; filePath?: string; name?: string } = {};
  if (cid) args.cid = cid;
  if (filePath) args.filePath = filePath;
  if (name) args.name = name;
  const result = await pinataPin(args, { jwt });
  // Never log the JWT; `result` carries only the CID, id, method and timing.
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
