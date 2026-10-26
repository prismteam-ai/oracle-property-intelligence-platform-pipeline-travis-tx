// A-16 T079 (AM-10): copy a run's manifest(s) and table files to Pinata as a second copy.
//
// RUNBOOK (from the repo root, after Run 3.1 publishes and runs/index.json lists it; PINATA_JWT
// must be exported in the shell beforehand and is never echoed):
//   1. Probe (uploads ONLY the run manifest, stops; must print "ok ... match"):
//        npx tsx pipeline/publish/scripts/pinata-copy.ts --manifest runs/<runId>/manifest.json \
//          --run-id <runId> --files-root . --first-only
//   2. Plan the full copy (no network, nothing written):   ...same flags without --first-only... --dry-run
//   3. Full copy: the run manifest, then every other run manifest runs/index.json lists (read from
//      runs/<runId>/manifest.json, each checked against its index CID), then the run's table files
//      until the budget:
//        npx tsx pipeline/publish/scripts/pinata-copy.ts --manifest runs/<runId>/manifest.json \
//          --run-id <runId> --files-root .
//   If the run is not in runs/index.json yet, add --manifest-cid <cid> (fail closed: no expected
//   CID, no upload). Receipts: specs/016-cost-and-admin/pinata-receipts/<runId>/*.json, plus
//   summary-<UTC>.json per run and summary.json (latest). Re-running is safe: CIDs already pinned
//   are skipped and an existing "pinned" receipt is kept. Exit 0 ok (a clean budget stop
//   included), 1 a mismatch or upload error, 2 bad input.
//
// Flags: --manifest <path> --run-id <id> --files-root <dir> [--manifest-cid <cid>]
//   [--kinds manifest,table] [--budget-bytes <n>] [--budget-files <n>] (both capped at the
//   free-plan quota minus current usage) [--extra-manifest <path>[=<cid>]]...
//   [--runs-index runs/index.json] [--no-index-manifests] [--receipts-root <dir>]
//   [--concurrency 1..3] [--stop-on-mismatch] (tables too) [--no-stop-on-mismatch] (not even the
//   manifest) [--dry-run] [--first-only]
//
// PINATA_JWT is read from process.env only, never from a file by this script, and is redacted
// from every line it prints (see ../src/pinata-copy.ts).
import { redactJwt } from "../src/pinata-pin.js";
import {
  COPY_KINDS,
  PreconditionError,
  runPinataCopy,
  type CopyKind,
  type ExtraManifest,
  type PinataCopyOptions,
} from "../src/pinata-copy.js";

const USAGE =
  "usage: pinata-copy.ts --manifest <runs/<runId>/manifest.json> --run-id <id> --files-root <dir> [--kinds manifest,table] [--budget-bytes N] [--budget-files N] [--manifest-cid <cid>] [--extra-manifest <path>[=<cid>]]... [--runs-index <path>] [--no-index-manifests] [--receipts-root <dir>] [--concurrency 1..3] [--stop-on-mismatch|--no-stop-on-mismatch] [--dry-run] [--first-only]";

class UsageError extends Error {}

function positiveInt(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0)
    throw new UsageError(`${flag} must be a whole number, not "${raw}"`);
  return n;
}

export function parseArgs(argv: string[], jwt: string): PinataCopyOptions {
  const opts: Partial<PinataCopyOptions> & { extraManifests: ExtraManifest[] } = {
    jwt,
    extraManifests: [],
    runsIndexPath: "runs/index.json",
  };
  const valueFlags = new Set([
    "--manifest",
    "--manifest-cid",
    "--run-id",
    "--files-root",
    "--kinds",
    "--budget-bytes",
    "--budget-files",
    "--extra-manifest",
    "--runs-index",
    "--receipts-root",
    "--concurrency",
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    let arg = argv[i] as string;
    let value: string | undefined;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq > 0 && valueFlags.has(arg.slice(0, eq))) {
      value = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    } else if (valueFlags.has(arg)) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--"))
        throw new UsageError(`${arg} needs a value`);
      i += 1;
    }
    switch (arg) {
      case "--manifest":
        opts.manifestPath = value as string;
        break;
      case "--manifest-cid":
        opts.manifestCid = value as string;
        break;
      case "--no-index-manifests":
        opts.indexManifests = false;
        break;
      case "--run-id":
        opts.runId = value as string;
        break;
      case "--files-root":
        opts.filesRoot = value as string;
        break;
      case "--kinds": {
        const kinds = (value as string)
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
        for (const k of kinds)
          if (!COPY_KINDS.includes(k as CopyKind))
            throw new UsageError(`--kinds: ${k} is not one of ${COPY_KINDS.join(",")}`);
        opts.kinds = kinds as CopyKind[];
        break;
      }
      case "--budget-bytes":
        opts.budgetBytes = positiveInt(arg, value as string);
        break;
      case "--budget-files":
        opts.budgetFiles = positiveInt(arg, value as string);
        break;
      case "--extra-manifest": {
        const v = value as string;
        const at = v.lastIndexOf("=");
        opts.extraManifests.push(
          at > 0 ? { path: v.slice(0, at), cid: v.slice(at + 1) } : { path: v },
        );
        break;
      }
      case "--runs-index":
        opts.runsIndexPath = value as string;
        break;
      case "--receipts-root":
        opts.receiptsRoot = value as string;
        break;
      case "--concurrency": {
        const n = positiveInt(arg, value as string);
        if (n < 1 || n > 3) throw new UsageError("--concurrency must be 1, 2 or 3");
        opts.concurrency = n;
        break;
      }
      case "--stop-on-mismatch":
        opts.stopOnMismatchManifest = true;
        opts.stopOnMismatchTable = true;
        break;
      case "--no-stop-on-mismatch":
        opts.stopOnMismatchManifest = false;
        opts.stopOnMismatchTable = false;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--first-only":
        opts.firstOnly = true;
        break;
      default:
        throw new UsageError(`unknown argument ${arg}`);
    }
  }
  if (!opts.manifestPath || !opts.runId || !opts.filesRoot)
    throw new UsageError("--manifest, --run-id and --files-root are required");
  return opts as PinataCopyOptions;
}

export async function main(
  argv: string[],
  env: NodeJS.ProcessEnv,
  io: { out: (l: string) => void; err: (l: string) => void },
  /** Test seams only (a fake fetch, a no-op sleep); the CLI passes none. */
  overrides: Pick<Partial<PinataCopyOptions>, "fetch" | "sleep"> = {},
): Promise<number> {
  const jwt = env.PINATA_JWT ?? "";
  try {
    const options = parseArgs(argv, jwt);
    const result = await runPinataCopy({ ...options, ...overrides, log: io.out });
    return result.exitCode;
  } catch (err) {
    const text = redactJwt(err instanceof Error ? err.message : String(err), jwt);
    if (err instanceof UsageError) {
      io.err(text);
      io.err(USAGE);
      return 2;
    }
    io.err(err instanceof PreconditionError ? `refused: ${text}` : `failed: ${text}`);
    return err instanceof PreconditionError ? 2 : 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], "file:").href) {
  const code = await main(process.argv.slice(2), process.env, {
    out: (l) => console.log(l),
    err: (l) => console.error(l),
  });
  process.exit(code);
}
