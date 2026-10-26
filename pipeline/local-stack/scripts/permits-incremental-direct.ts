// A-11 Run 3: runs the AustinPermits workflow (incremental mode, or link) in this process, with no
// Restate and no journal, merging through the real Loader (`runMerge`, one transaction per merge)
// into the database DATABASE_URL names. The logic is the committed workflow
// (oracle-runtime travis/permits/workflow.ts); only the durable wrapper is missing, so a crash
// restarts the job from the start of the pass. It exists to REHEARSE an incremental refresh on a
// scratch copy of the permit staging tables before the real, durable run.
//
// Safety: it refuses to run unless the database name starts with "scratch_" (a throwaway copy),
// or you pass --real, which the real run does not need (the real run uses
// `backbone permits --mode incremental`, durable through Restate).
//
// Source etiquette (the source client's Austin host policy): one request in flight, at least 1 s
// between request starts including retries, backoff on 429 and 5xx, the project's identified
// User-Agent, no app token, 50,000 rows per page, one pass.
//
// Usage (from pipeline/local-stack):
//   DATABASE_URL=<scratch db> npx tsx scripts/permits-incremental-direct.ts incremental \
//        --artifacts <dir> [--job-suffix <text>]
//   DATABASE_URL=<scratch db> npx tsx scripts/permits-incremental-direct.ts link
import { setTimeout as sleepMs } from "node:timers/promises";
import postgres from "postgres";
import { createSourceClient } from "../../oracle-runtime/travis/lib/source-client.js";
import { AustinWatermark, PERMITS_SOURCE_KEY } from "../../oracle-runtime/travis/permits/merge-input.js";
import {
  runAustinPermits,
  type PermitsDeps,
  type PermitsIO,
} from "../../oracle-runtime/travis/permits/workflow.js";
import { loadTracks, runMerge } from "../services/loader.js";

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? undefined : argv[i + 1];
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = argv[0];
  if (mode !== "incremental" && mode !== "link")
    throw new Error("usage: permits-incremental-direct.ts incremental|link [--artifacts <dir>] [--real]");
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url.trim() === "") throw new Error("DATABASE_URL is not set");
  if (!databaseName(url).startsWith("scratch_") && !argv.includes("--real"))
    throw new Error("refusing to run on a database whose name does not start with scratch_ (see the file header)");
  const artifacts = arg(argv, "artifacts");
  if (mode === "incremental" && artifacts === undefined) throw new Error("--artifacts <dir> is required");

  const sql = postgres(url, { max: 4, onnotice: () => {} });
  try {
    const tracks = await loadTracks();
    const permits = tracks.get("permits");
    if (permits === undefined) throw new Error("the permits track is not registered");
    const io: PermitsIO = {
      now: async () => new Date(),
      run: (_name, fn) => fn(),
      sleep: (ms) => sleepMs(ms),
      merge: async (_name, input) => runMerge(sql, permits, input),
      fail: (message) => new Error(message),
    };
    const deps: PermitsDeps = {
      client: createSourceClient({ hostSpacing: true, appToken: "" }),
      artifactsRoot: artifacts ?? "/nonexistent",
      readWatermark: async () => {
        const rows = await sql<{ value: unknown }[]>`
          SELECT value FROM watermarks WHERE track = 'permits' AND source_key = ${PERMITS_SOURCE_KEY}`;
        const parsed = AustinWatermark.safeParse(rows[0]?.value);
        return parsed.success ? parsed.data : null;
      },
      limitations: () => [],
    };
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const suffix = arg(argv, "job-suffix");
    const jobId = `travis-a04-permits-${mode}-${stamp}${suffix === undefined ? "" : `-${suffix}`}`;
    console.log(`[direct] job ${jobId} on ${databaseName(url)} started ${new Date().toISOString()}`);
    const result = await runAustinPermits(io, { jobId, mode }, deps);
    console.log(`[direct] ${JSON.stringify({ ...result, restamp: result.restamp?.detected ?? null })}`);
    process.exitCode = result.exitCode;
  } finally {
    await sql.end();
  }
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e: unknown) => {
    console.error(`[direct] FAILED: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
}
