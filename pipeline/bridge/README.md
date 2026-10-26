# CountyLens laptop bridge (A-16)

The bridge lets the admin Start / Stop / Retry buttons on the hosted Runs page drive the real
pipeline on the operator's laptop. The API Lambda only puts a `RunCommandV1` message on an SQS queue;
this process pulls it and runs the same gated path as Run 3. Nothing in AWS can reach the laptop
(no inbound path, no Lambda trigger). **It runs only when the operator starts it, and never in CI.**

```
Runs page (admin) -> API Lambda -> SQS countylens-admin-commands -> [this bridge, laptop]
                                                                    -> Restate (local) -> Query DB
                                                                    -> publish-run.ts (gated)
                      Runs page <- API Lambda <- s3 live/live.json <- bridge heartbeat (30 s)
```

## Start

Prerequisites: the local stack is up (Restate on 9070/8080, Postgres on 5432; see
`bootstrap-oracle-infra`), you are signed in (`aws login --profile assess`), and no other ingest runs.

```bash
export AWS_PROFILE=assess                       # account 515618610572, region eu-north-1 from the profile
export COUNTYLENS_ADMIN_QUEUE_URL=<queue url>   # CountyLensApi output / `aws sqs get-queue-url --queue-name countylens-admin-commands`
export CID_COPY_BUCKET=<bucket>                 # the CID-copy bucket (SSM /countylens/cid-copy/bucket); live.json goes here
export BRIDGE_COUNTY_DIR=<dir>                  # county-batched dir of the last published run (reused, not rebuilt)
export BRIDGE_PERMITS_SEED_JOB=<job>            # last permits job dir name under pipeline/data/runs (seeds the re-export)
export CID_COPY_HOST=<host>                     # for publish-run.ts --copy-host (publish mode only)
pnpm --filter @countylens/bridge start
```

After the first successful `publish` run the bridge remembers the last two values in
`pipeline/data/bridge/state.json`, so only the first start needs them. Optional:
`BRIDGE_MANIFEST_CONFIG` (a `build-run-manifest.ts --config` file with `coverageOverrides`),
`RESTATE_INGRESS_URL` (default `http://localhost:8080`), `BRIDGE_RELEASE_REUSE_TAGS` (comma-separated
earlier release tags whose identical CARs the release step reuses instead of re-uploading, e.g.
`run-travis-full-run4-20261026,run-travis-full-run3-1-20261025,run-travis-full-run3-20261025`) and
`BRIDGE_RELEASE_TARGET` (the branch the release tag points at, e.g. `feature/oracle-pipeline`).

A scheduled start (PO 2026-10-26) arrives the same way as the admin Start: the
`CountyLensScheduledRun` stack (deployed only with `COUNTYLENS_SCHEDULED_RUN_*` set) puts one
command on the queue at a fixed UTC time. The bridge must be polling then; the command expires
15 minutes later otherwise. Delete that stack after it has fired.

If the manifest step fails with "Supply coverageOverrides for: contractor_..., permits_trade_sub_permit",
the incremental refresh changed the published permit rows, so the carried coverage keys no longer
apply (A11-10d). Write the new counts into a `--config` file, set `BRIDGE_MANIFEST_CONFIG` to it,
restart the bridge and send Retry; finished steps are not repeated.

The first line printed is `bridge up (profile assess); polling <queue>`. live.json now shows the
bridge online; the Runs page flips from "Bridge offline" within about a minute.

## What it does with a command

| Command                                                                           | Result                                                                           |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Not a valid `RunCommandV1`                                                        | left on the queue; after 3 receives it lands in the DLQ and the DLQ alarm emails |
| Same `commandId` seen before                                                      | deleted, never rerun (`pipeline/data/bridge/commands.json`)                      |
| `expiresAt` already passed (15 min)                                               | deleted, not run, live.json `lastCommand.outcome = expired`                      |
| Start while a run is active (live.json running/stopping, or the run lock is held) | rejected, `rejected_active_run`, "A run is already running"                      |
| Start                                                                             | recorded, deleted, then runs in the background while polling continues           |
| Stop                                                                              | sets a flag; the run stops **between** steps, never inside one                   |
| Stop naming a command that has not started                                        | that Start is dropped when it arrives (`cancelled`)                              |

A run goes: preflight, AustinPermits incremental (Restate, keyed by the command ID so a redelivery
attaches to the same workflow), pre-link facts, link, final facts, re-export of the affected permit
folders, 5 permit batches, `build-run-manifest.ts`, then `publish-run.ts` one step at a time
(`gate`, `filebase`, `car-files`, `manifest`, `cid-copy`, `gate-remote`, `release`, `index`). Every
`--step` invocation runs the identity gate first; there is no skip or force flag, and the bridge
never calls `upload.ts` or any side script. A `dry_run` command runs every local step, then
`publish-run.ts --dry-run` (gate real, nothing uploaded). A dry run writes a manifest under
`runs/travis-dryrun-<date>-<id>/`; delete that folder when you are done. Local steps still write
the local Query DB (the incremental merge and the relink), as they do for a real run.

Expect 1 to 1.5 hours end to end for a real run (capture and merge about 35 min, re-export about 3
min, batches about 10 min, publish 30 to 60 min). A Stop that arrives during the Restate capture
waits until that durable step ends.

Per-step output goes to `pipeline/data/bridge/logs/<commandId>-<step>.log`, never to the console.

## Kill switch

- **Ctrl-C** in the bridge terminal: stops polling now. A child step already running keeps running
  to its end; a half-finished run is resumable by sending Retry (publish-run.ts skips finished
  work).
- **`touch pipeline/data/bridge/KILL`**: the bridge requests a Stop (the running step finishes, no
  new step starts), then exits. Remove the file before the next start.
- **Hard stop**: close the terminal. live.json goes stale after 3 minutes and the Runs page shows
  "Bridge offline". Unread commands expire by themselves after 15 minutes.
- **Block all commands from AWS**: `aws sqs purge-queue --queue-url $COUNTYLENS_ADMIN_QUEUE_URL
--profile assess` (asks first; purge allows only once per 60 s).

## Safety facts

- IAM needed by the profile: `sqs:ReceiveMessage`, `DeleteMessage`, `ChangeMessageVisibility`,
  `GetQueueAttributes` on the command queue; `s3:PutObject` on `live/live.json` only. Nothing on the DLQ.
- live.json holds no paths, tokens or database strings; commands carry the Cognito `sub`, never an
  email or a token.
- A 403 from a source stops the run with "blocked" and is never retried.

## Tests

`pnpm --filter @countylens/bridge test` (fake SQS client, fake process runner, fake fetch; nothing
touches AWS). The real-queue rehearsal (one `dry_run` on the dev queue) is in the A-16 evidence plan.

## Alerts and the explore index (A-16 review fixes)

- `COUNTYLENS_ALERTS_TOPIC_ARN` (optional): when set, a failed run publishes one message to this SNS topic (the Ops topic `countylens-alerts`); the operator profile needs `sns:Publish` on it. Without it a failure is only in `live.json` and the bridge log.
- In publish mode the runner builds, verifies and uploads the run's Explore index (`build-explore-index.ts --source cidcopy --verify --upload`) right after the CID copy step, so a bridge-published run is searchable before it is listed. It needs `CID_COPY_HOST` and `CID_COPY_BUCKET`.
- The saved `state.json` (the last run this bridge published) wins over `BRIDGE_COUNTY_DIR` / `BRIDGE_PERMITS_SEED_JOB`; those only seed the first run. The base run is the command's `sinceRunId` and must be in `runs/index.json`.
- A retry after a failed capture uses a new Restate workflow key (`…-a<attempt>`, counted in `progress.json`), because a workflow runs once per key.
