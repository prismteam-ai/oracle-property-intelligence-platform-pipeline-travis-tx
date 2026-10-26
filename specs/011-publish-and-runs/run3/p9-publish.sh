#!/bin/sh
# Run 3 public publish, core steps only (no release, no index). Resumable: rerun this script; finished items are skipped by receipts.
cd /Users/hebagaber/Github/run3-integration || exit 1
export CID_COPY_HOST=d2xsqoqv09bd0q.cloudfront.net
# ERR-33: elephant-cli stays the uploader; the fetch retry wrapper is loaded into it (and into this driver).
TSX_LOADER=$(cd /Users/hebagaber/Github/run3-integration && node -e "console.log(require('path').dirname(require.resolve('tsx'))+'/loader.mjs')")
export NODE_OPTIONS="--import $TSX_LOADER --import /Users/hebagaber/Github/run3-integration/pipeline/publish/scripts/fetch-retry.ts"
for step in filebase car-files manifest cid-copy gate-remote; do
  echo "[p9] $(date -u +%FT%TZ) step $step start"
  npx tsx pipeline/publish/scripts/publish-run.ts --manifest runs/travis-full-run3-20261025/manifest.json --run-id travis-full-run3-20261025 --step $step
  rc=$?
  echo "[p9] $(date -u +%FT%TZ) step $step exit=$rc"
  [ $rc -ne 0 ] && { echo "[p9] STOPPED at $step; fix the cause, then rerun this script"; exit $rc; }
done
echo "[p9] core steps complete (release and index NOT run)"
