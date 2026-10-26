#!/bin/sh
# Run 4 P8: the publish rehearsal (no upload), with Run 3.1's environment.
cd /Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx || exit 1
export CID_COPY_HOST=d2xsqoqv09bd0q.cloudfront.net
TSX_LOADER=$(cd pipeline/publish && node -e "console.log(require('path').dirname(require.resolve('tsx'))+'/loader.mjs')")
export NODE_OPTIONS="--import $TSX_LOADER --import $PWD/pipeline/publish/scripts/fetch-retry.ts"
npx tsx pipeline/publish/scripts/publish-run.ts \
  --manifest runs/travis-full-run4-20261026/manifest.json \
  --run-id travis-full-run4-20261026 \
  --dry-run \
  --copy-host d2xsqoqv09bd0q.cloudfront.net
echo "exit=$?"
