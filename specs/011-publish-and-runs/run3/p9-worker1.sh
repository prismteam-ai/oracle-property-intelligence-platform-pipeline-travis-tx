#!/bin/sh
# First filebase worker (forward order, per-unit locks). Filebase step only; resumable.
cd /Users/hebagaber/Github/run3-integration || exit 1
export CID_COPY_HOST=d2xsqoqv09bd0q.cloudfront.net
export PUBLISH_FILEBASE_REVERSE=0
export PUBLISH_FILEBASE_KINDS=car
TSX_LOADER=$(node -e "console.log(require('path').dirname(require.resolve('tsx'))+'/loader.mjs')")
export NODE_OPTIONS="--import $TSX_LOADER --import /Users/hebagaber/Github/run3-integration/pipeline/publish/scripts/fetch-retry.ts"
echo "[w1] $(date -u +%FT%TZ) filebase (forward) start"
npx tsx pipeline/publish/scripts/publish-run.ts --manifest runs/travis-full-run3-20261025/manifest.json --run-id travis-full-run3-20261025 --step filebase
echo "[w1] $(date -u +%FT%TZ) exit=$?"
