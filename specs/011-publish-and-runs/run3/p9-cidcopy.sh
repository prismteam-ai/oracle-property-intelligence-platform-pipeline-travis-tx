#!/bin/sh
# Run 3 step 5 on its own (CID copy to S3/CloudFront); resumes, finished objects are skipped. Retries a network drop up to 5 times.
cd /Users/hebagaber/Github/run3-integration || exit 1
export CID_COPY_HOST=d2xsqoqv09bd0q.cloudfront.net
TSX_LOADER=$(node -e "console.log(require('path').dirname(require.resolve('tsx'))+'/loader.mjs')")
export NODE_OPTIONS="--import $TSX_LOADER --import /Users/hebagaber/Github/run3-integration/pipeline/publish/scripts/fetch-retry.ts"
for try in 1 2 3 4 5; do
  echo "[cidcopy] $(date -u +%FT%TZ) try $try start"
  npx tsx pipeline/publish/scripts/publish-run.ts --manifest runs/travis-full-run3-20261025/manifest.json --run-id travis-full-run3-20261025 --release-target feature/oracle-pipeline --step cid-copy
  rc=$?
  echo "[cidcopy] $(date -u +%FT%TZ) try $try exit=$rc"
  [ $rc -eq 0 ] && exit 0
  sleep 60
done
exit 1
