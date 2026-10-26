#!/bin/sh
# Run 3 publish, steps after filebase. Waits for all 15 tables receipts and no filebase worker; stops at the first failed step.
cd /Users/hebagaber/Github/run3-integration || exit 1
R=specs/011-publish-and-runs/upload-receipts/travis-full-run3-20261025
until [ "$(ls $R | grep -c -- '-tables.json$')" -ge 15 ] && [ "$(ls $R | grep -c -- '-car.json$')" -ge 15 ] && ! pgrep -f "p9-worker[0-9].sh" > /dev/null; do sleep 30; done
export CID_COPY_HOST=d2xsqoqv09bd0q.cloudfront.net
# PO 2026-10-25: Pinata readback of the carCid files deferred to A-16 item 14.
export PUBLISH_DEFER_PINATA=1
# Both gateways hang on new CIDs; skip the "already served?" probe (local receipts still skip done files).
export PUBLISH_CARFILES_NO_PROBE=1
TSX_LOADER=$(node -e "console.log(require('path').dirname(require.resolve('tsx'))+'/loader.mjs')")
export NODE_OPTIONS="--import $TSX_LOADER --import /Users/hebagaber/Github/run3-integration/pipeline/publish/scripts/fetch-retry.ts"
for step in car-files manifest cid-copy gate-remote release index; do  # manifest already has its receipt (skipped)
  # cid-copy also runs on its own (p9-cidcopy.log): wait for it so the two never overlap.
  if [ "$step" = cid-copy ]; then while pgrep -f -- "--step cid-copy" > /dev/null; do sleep 60; done; fi
  echo "[rest] $(date -u +%FT%TZ) step $step start"
  npx tsx pipeline/publish/scripts/publish-run.ts --manifest runs/travis-full-run3-20261025/manifest.json --run-id travis-full-run3-20261025 --release-target feature/oracle-pipeline --step $step
  rc=$?
  echo "[rest] $(date -u +%FT%TZ) step $step exit=$rc"
  [ $rc -ne 0 ] && { echo "[rest] STOPPED at $step"; exit $rc; }
done
echo "[rest] ALL STEPS COMPLETE"
