// A-11: one-off invocation of the existing CID-copy uploader (src/cid-copy.ts) for Run 1.
// Run 1's manifest.artifacts[].name values are already full repo-relative paths (built by
// scripts/build-run1-manifest.ts by stitching two earlier run directories,
// travis-a04-20261022052658 and travis-a11-permits-full-20261023114303), so `runDir` must be the
// repo root itself, not the pipeline/data/runs/<runId> default the CLI's `cid-copy` command
// assumes for a single-run manifest. Everything else — bucket resolution (CID_COPY_BUCKET or SSM
// /countylens/cid-copy/bucket), the assess-cid-writer S3 client, and the conditional-PUT +
// readback logic in copyManifestObjects — is the unmodified module (AD-02, contracts/storage.md).
//
// Run from the repo root:
//   pnpm --filter @countylens/publish exec tsx scripts/cid-copy-run1.ts
import { resolve } from "node:path";
import {
  copyManifestObjects,
  createCidCopyClients,
  resolveCidCopyBucket,
} from "../src/cid-copy.js";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname);
const manifestPath = resolve(repoRoot, "runs/travis-full-run1-20261023/manifest.json");

async function main() {
  const { s3, ssm } = createCidCopyClients();
  const bucket = await resolveCidCopyBucket({ env: process.env, ssm });
  const report = await copyManifestObjects({
    manifestPath,
    runDir: repoRoot,
    bucket,
    s3,
    log: (line) => console.log(line),
  });
  console.log(
    JSON.stringify(
      {
        bucket: report.bucket,
        manifestCid: report.manifestCid,
        written: report.written,
        skipped: report.skipped,
        total: report.objects.length,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
