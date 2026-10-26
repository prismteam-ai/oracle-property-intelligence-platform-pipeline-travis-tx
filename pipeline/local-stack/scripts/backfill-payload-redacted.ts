// A-11 fix 1c: targeted backfill of parcels.payload_redacted for one TCAD job from the verified
// export, through the loader's own processRecord (see backfill-payload-redacted/core.ts for the
// pipeline, the safety checks and how resume works). Only payload_redacted is written.
//
// Usage (from pipeline/local-stack):
//   npx tsx scripts/backfill-payload-redacted.ts [--pids <file|comma list>] [--job <jobId>]
//     [--checkpoint <path>] [--workers 6] [--writers 4] [--batch 1000] [--dry-run]
//
// DATABASE_URL comes from the environment or pipeline/local-stack/.env; it is never printed.
// Exit 0 = complete and fingerprint unchanged; 1 = any failure; 130 = interrupted (resumable).
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import postgres from "postgres";
import { z } from "zod";
import { exportSource } from "../../oracle-runtime/travis/tcad/export-source.js";
import {
  BackfillError,
  DEFAULT_JOB,
  defaultCheckpointPath,
  parsePids,
  runBackfill,
  scopeKey,
  type BackfillResult,
} from "./backfill-payload-redacted/core.js";

const Args = z.object({
  pids: z.string().min(1).optional(),
  job: z.string().regex(/^travis-a04-[a-z0-9-]+$/),
  checkpoint: z.string().min(1).optional(),
  workers: z.coerce.number().int().min(1).max(16),
  writers: z.coerce.number().int().min(1).max(16),
  batch: z.coerce.number().int().min(1).max(5000),
  "dry-run": z.boolean(),
});

function summary(r: BackfillResult): string {
  const lines = [
    `[backfill] ${r.dry_run ? "DRY RUN (nothing written)" : "done"} job=${r.job_id} scope=${r.scope} seconds=${r.seconds}`,
    `  records_seen=${r.records_seen} skipped_below_checkpoint=${r.skipped_below_checkpoint} dispatched=${r.dispatched}`,
    `  not_loaded=${r.not_loaded} out_of_scope=${r.out_of_scope} in_scope_rows=${r.in_scope_rows} batches=${r.batches}`,
    r.dry_run
      ? `  would_write=${r.would_write} already_correct=${r.in_scope_rows - (r.would_write ?? 0)}`
      : `  written=${r.written} skipped_already_correct=${r.skipped_already_correct}`,
    `  rows_covered=${r.rows_covered} db_rows_in_scope=${r.db_rows_in_scope} checkpoint_low_water=${r.checkpoint_low_water}`,
    `  computed_with_propertyLegalDescription=${r.computed_with_legal_key} db_rows_with_propertyLegalDescription=${r.db_rows_with_legal_key}`,
    `  fingerprint_equal=${r.fingerprint_equal ? "yes" : "NO"} (${r.fingerprint_before} → ${r.fingerprint_after})`,
  ];
  if (r.missing_pids.length > 0) lines.push(`  missing_pids=${r.missing_pids.join(",")}`);
  return lines.join("\n");
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      pids: { type: "string" },
      job: { type: "string", default: DEFAULT_JOB },
      checkpoint: { type: "string" },
      workers: { type: "string", default: "6" },
      writers: { type: "string", default: "4" },
      batch: { type: "string", default: "1000" },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });
  const args = Args.parse(values);
  const pids = args.pids === undefined ? null : parsePids(args.pids);
  const scope = scopeKey(pids);
  const checkpointPath = args.checkpoint ?? defaultCheckpointPath(scope);

  if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL.trim() === "") {
    config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
  }
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.trim() === "") throw new Error("DATABASE_URL is not set");

  const src = exportSource();
  process.stdout.write(
    `[backfill] job=${args.job} scope=${scope}${pids === null ? "" : ` (${pids.length} pIDs)`} ` +
      `workers=${args.workers} writers=${args.writers} batch=${args.batch} dry_run=${args["dry-run"]}\n` +
      `[backfill] checkpoint=${args["dry-run"] ? "(not used in a dry run)" : checkpointPath}\n`,
  );
  const sql = postgres(url, { max: args.writers, onnotice: () => {} });
  const abort = new AbortController();
  const onSignal = (): void => abort.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    const result = await runBackfill({
      sql,
      jobId: args.job,
      exportPath: src.exportPath,
      receipt: src.receipt,
      pids,
      checkpointPath,
      workers: args.workers,
      writers: args.writers,
      batch: args.batch,
      dryRun: args["dry-run"],
      signal: abort.signal,
    });
    process.stdout.write(`${summary(result)}\n`);
    return 0;
  } catch (error) {
    const r = (error as { result?: BackfillResult }).result;
    if (r !== undefined) process.stdout.write(`${summary(r)}\n`);
    const code = error instanceof BackfillError ? error.code : "error";
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[backfill] FAILED (${code}): ${message}\n`);
    return code === "interrupted" ? 130 : 1;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(
      `[backfill] FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  },
);
