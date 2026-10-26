// A-11 T031 (Stage 5 S5.2): the full-scale Property Improvement group export, driven directly
// against the Query DB (never a new Austin/Socrata request) rather than through the Restate
// ingress. The `PropertyImprovementBackbone` service (services/workflows/permits-backbone.ts)
// is the committed CLI/Restate entrypoint for normal operation, but the local-stack server
// process that would need to pick it up is the SAME process currently serving the live county
// (A-04) dry run (job travis-a04-…, driven by specs/011-publish-and-runs/dry-run-county.sh,
// PID 2606). Restarting that process to register the new service would interrupt the dry run
// mid-flight, which this story was explicitly told not to touch. This script reuses the exact
// same pure function (`writeGroupWith`) and real dependencies the service would use, opening
// its OWN postgres connection and making its own lexicon-manifest read -- no Restate, no shared
// process, no effect on the dry run. Writes local CARs/tables inputs only: plain files under
// `pipeline/data/runs/<jobId>/groups/property_improvement`. No upload, no Atlas step.
//
// Usage: npx tsx scripts/run-permits-full.ts [jobId]
import postgres from "postgres";
import * as travisAustin from "../../../profiles/travis-austin@1.0.0/index.js";
import { runDirFor } from "../../oracle-runtime/travis/tcad/export-source.js";
import { fetchDataGroupCids } from "../../oracle-runtime/travis/transforms/lexicon-manifest.js";
import { profileApi, type TravisAustinProfileModule } from "../../oracle-runtime/travis/pilot/profile-api.js";
import { writeGroupWith } from "../services/workflows/permits-backbone.js";

async function main() {
  const jobId = process.argv[2] ?? `travis-a11-permits-full-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 14)}`;
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.trim() === "") throw new Error("DATABASE_URL is not set");
  console.log(`[permits-full] job_id=${jobId} start=${new Date().toISOString()}`);

  const sql = postgres(url, { max: 4, onnotice: () => {} });
  const cids = (await fetchDataGroupCids()).cids;
  console.log(`[permits-full] lexicon cids resolved: property_improvement=${cids.propertyImprovement}`);
  const profile = profileApi(travisAustin as unknown as TravisAustinProfileModule);
  const defaultDir = `${runDirFor(jobId)}/groups/property_improvement`;
  console.log(`[permits-full] writing to ${defaultDir}`);

  const started = Date.now();
  let pages = 0;
  let totalGroups = 0;
  let totalPermits = 0;
  let totalEmitted = 0;
  const out = await writeGroupWith(
    {
      sql,
      cids,
      profile,
      defaultDir,
      batchSize: 500,
      onPage: (p) => {
        pages += 1;
        totalGroups += p.groups;
        totalPermits += p.permits;
        totalEmitted += p.emitted;
        if (pages % 20 === 0) {
          const elapsed = ((Date.now() - started) / 1000).toFixed(0);
          // `linked_db_rows_read`: linked permits read from the Query DB this page, before
          // roofing/status classification. `permits_written`: the property_improvement rows
          // actually emitted (roofing-classified, decided status only) -- the published count.
          // These are NOT the same number (CR-A-11-porygon finding 1); never collapse them
          // under one `permits=` label again.
          console.log(
            `[permits-full] progress pages=${pages} pids_seen=${pages * 500} groups=${totalGroups} linked_db_rows_read=${totalPermits} permits_written=${totalEmitted} elapsed_s=${elapsed}`,
          );
        }
      },
    },
    jobId,
    {},
  );
  const elapsedS = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[permits-full] done job_id=${jobId} groups=${out.groups} empty=${out.empty} linked_db_rows_read=${out.permits} permits_written=${out.emitted} dir=${out.dir} elapsed_s=${elapsedS}`,
  );
  await sql.end();
}

main().catch((error) => {
  console.error(`[permits-full] FAILED: ${(error as Error).message}`);
  process.exitCode = 1;
});
