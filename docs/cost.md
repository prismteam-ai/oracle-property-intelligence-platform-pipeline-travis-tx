# CountyLens cost: idle and per use

As of billing date **2026-10-24** (last full UTC day in Cost Explorer; 2026-10-25 is a partial, estimated day and is shown separately). Read 2026-10-26 from account `515618610572`, region `eu-north-1` (CloudFront, WAF and CloudWatch Logs may bill in `us-east-1`). Source: AWS Cost Explorer `GetCostAndUsage`, UnblendedCost, DAILY, grouped by SERVICE and by RECORD_TYPE; every row is flagged "Estimated" by AWS. The window is the last full billed days (PO decision 2026-10-26: no quiet-day sample). Billing data starts on 2026-10-20; the CountyLens stacks were created 2026-10-21.

## Headline

- **Fixed (idle) cost: $0.00 per month in recurring fees.** No component charges a standing fee. The only idle line is storage, billed per GB: $0.0024 observed over 2026-10-20 to 2026-10-25 (Amplify storage $0.0017 + S3 $0.0007). The S3 CID copy grew to 2.88 GB on 2026-10-25 (Run 3 copy, CloudWatch `BucketSizeBytes`), which is about **$0.07 per month** at the S3 list price of $0.023 per GB-month (pricing model, first billed day pending).
- **Per-use cost is not zero.** Gross usage over the window was **$9.2469** (2026-10-20 to 2026-10-24: $9.2469 in Usage, $9.2469 offset by Credit). 2026-10-25 so far adds $1.565 gross (partial). Almost all of it is Amplify traffic and builds (see below), not standing infrastructure.
- **Credits cover it.** Net billed cost for the window is $0.00 only because of credits. The $0 is not "no cost"; the gross figures below are the real usage.
- **Free plan** (`aws freetier get-account-plan-state`): `FREE`, `ACTIVE`, remaining credits **$125.18**, expires **2027-04-16**.
- **Budgets**: a `countylens-monthly-de74e055aa` budget exists, $10 per month, created by the CDK Ops stack (`CountyLensOps`), alerts at 85% and 100% actual and 100% forecast; its spend shows $0.00 because it counts credits (`IncludeCredit: true`). A second, older budget `assessment usd` ($10 per month, not CDK-managed) shows **$10.812 actual spend** (gross usage, credits not netted) and its 85% and 100% alerts are in ALARM. That is expected given the gross figures here, but a reader may see it and ask.

## Gross cost versus credits (Cost Explorer, by record type)

| UTC day                         | Usage (gross) | Credit      | Net        |
| ------------------------------- | ------------- | ----------- | ---------- |
| 2026-10-18, 10-19               | 0.0000        | 0.0000      | 0.0000     |
| 2026-10-20                      | 0.0001        | -0.0001     | 0.0000     |
| 2026-10-21                      | 1.2770        | -1.2770     | 0.0000     |
| 2026-10-22                      | 4.1254        | -4.1254     | 0.0000     |
| 2026-10-23                      | 1.8671        | -1.8671     | 0.0000     |
| 2026-10-24                      | 1.9772        | -1.9772     | 0.0000     |
| **Total, 7 full days**          | **9.2469**    | **-9.2469** | **0.0000** |
| 2026-10-25 (partial, estimated) | 1.5649        | -1.5649     | 0.0000     |

Read by service without the record-type split, the same days look like "$0.00 per service" because the credit is netted into each service line. Use the Usage rows below as the real number.

## Gross usage by service (RECORD_TYPE = Usage, USD)

| Service                                        | 10-20  | 10-21  | 10-22  | 10-23  | 10-24  | 7-day total                                            | 10-25 (partial) |
| ---------------------------------------------- | ------ | ------ | ------ | ------ | ------ | ------------------------------------------------------ | --------------- |
| AWS Amplify                                    | 0      | 1.2640 | 4.1216 | 1.8330 | 1.7772 | 8.9958                                                 | 0.8363          |
| Claude Sonnet 4.6 (Amazon Bedrock)             | 0      | 0      | 0      | 0      | 0.1198 | 0.1198                                                 | 0.7066          |
| AWS Secrets Manager (not CountyLens, see note) | 0      | 0      | 0      | 0.0263 | 0.0278 | 0.0541                                                 | 0.0066          |
| Amazon DynamoDB                                | 0      | 0      | 0      | 0.0009 | 0.0273 | 0.0282                                                 | 0.0067          |
| Amazon API Gateway                             | 0      | 0.0004 | 0.0032 | 0.0016 | 0.0169 | 0.0221                                                 | 0.0076          |
| Amazon S3                                      | 0.0001 | 0.0127 | 0.0006 | 0.0050 | 0.0083 | 0.0267                                                 | 0.0011          |
| AWS Step Functions                             | 0      | 0      | 0      | 0.0002 | 0      | 0.0002                                                 | 0               |
| Amazon CloudWatch                              | 0      | 0      | 0      | 0.0001 | 0.0001 | 0.0002                                                 | 0               |
| AWS Lambda                                     | 0      | 0      | 0      | 0      | 0      | 0 (inside the free tier; usage lines exist, see below) | 0               |

Service totals are summed from the daily rows above (the 7-day column excludes 10-25). Where a day is blank in Cost Explorer the cell is 0 only because the bill shows no line.

## Component map: idle versus per use

Resources come from CloudFormation in `eu-north-1` (stacks `CountyLensData`, `CountyLensApi`, `CountyLensWeb`, `CountyLensCert`, `CountyLensOps`, `CountyLensScheduler`).

| Component (stack)                                                                                  | Idle cost per month                                                                                  | Cost per use                                                        | Who pays                                                               | Seen in the bill                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Amplify static hosting, app `countylens-web` + custom domain (`CountyLensWeb`, `CountyLensCert`)   | $0.00 fixed. Storage $0.023 per GB-month (billed $0.0017 in the window)                              | Data transfer out $0.15 per GB; build minutes $0.01 each            | Visitors and CI pay through usage; the project pays the bill (credits) | **Yes, the largest line**: 42.3 GB out ($6.3472) and 348 build minutes ($3.4833) over 2026-10-20 to 10-25 for the two Amplify apps. CloudWatch `BytesDownloaded` for `countylens-web` was about 39 GB of that, so the demo site and its Playwright runs drive it.            |
| Lambda: query API, agent, MCP (`CountyLensApi`, 3 functions) and budget provider (`CountyLensOps`) | $0.00 (no provisioned concurrency)                                                                   | Requests and GB-seconds (arm64 for the API functions)               | Caller traffic; the project pays                                       | Usage lines exist (for example 10-24: 15,757 ARM requests, 1,353 ARM GB-s) but the monthly free tier absorbs them: $0.00 billed, not zero usage.                                                                                                                             |
| API Gateway HTTP APIs (3 APIs, `CountyLensApi`)                                                    | $0.00                                                                                                | $1.00 per million requests                                          | Caller traffic                                                         | $0.0296 for 27,899 requests                                                                                                                                                                                                                                                  |
| S3 + CloudFront CID copy (`CountyLensData`)                                                        | Storage only: 2.88 GB measured on 10-25, about $0.07 per month (pricing model)                       | S3 requests, CloudFront transfer (first 1 TB per month free)        | Reader traffic                                                         | S3 $0.0277 (requests $0.027, storage $0.0007). No CloudFront line billed.                                                                                                                                                                                                    |
| DynamoDB on-demand, table `CountyLensAiSpend` (`CountyLensApi`)                                    | $0.00 (PAY_PER_REQUEST, 51 bytes stored)                                                             | $1.25 per million write units, $0.25 per million read units         | Agent traffic                                                          | $0.0348 (47,239 write units, 23,205 read units). The account also has three `crm-*` tables from another project.                                                                                                                                                             |
| SSM parameters (several, standard tier)                                                            | $0.00                                                                                                | $0.00                                                               | n/a                                                                    | No SSM line.                                                                                                                                                                                                                                                                 |
| CloudWatch Logs and alarms (`CountyLensApi`, `CountyLensOps`, `CountyLensScheduler`)               | $0.00 within free ingestion and storage; retention 14 days, access logs 30                           | $0.50 per GB ingested; $0.10 per alarm per month after the first 10 | Traffic                                                                | $0.0001 (metrics). Alarms stay inside the free 10.                                                                                                                                                                                                                           |
| Scheduler `countylens-incremental-run` (`CountyLensScheduler`)                                     | $0.00. **State: DISABLED** (read from EventBridge Scheduler)                                         | One ECS task per run when enabled, never by default                 | The project, only when the PO enables it                               | Not billed. The stack also holds a VPC with an internet gateway and no NAT gateway (none exists in the region), an ECS cluster, an SQS dead-letter queue `countylens-scheduler-run-task-dlq` and SNS topics `countylens-alerts`, `countylens-scheduler-alerts`: all $0 idle. |
| Step Functions                                                                                     | $0.00                                                                                                | Per transition                                                      | Run traffic                                                            | $0.0002 (cross-region out-bytes)                                                                                                                                                                                                                                             |
| Bedrock, Claude Sonnet 4.6 via `eu.` profile (agent)                                               | $0.00                                                                                                | Per token: input, output, cache write, cache read                   | Evaluators and tests asking the agent                                  | **$0.8264** gross over 10-24 and 10-25 (output $0.3055, cache write $0.3505, input $0.1655, cache read $0.0049). The budget guard pauses the agent at $3 per day.                                                                                                            |
| Cognito user pool, Lite plan (deployed 2026-10-26, `CountyLensApi`)                                | $0.00 (pricing model: free tier of 10,000 monthly active users; first billed day pending)            | Per monthly active user above the free tier                         | Operator sign-ins                                                      | Not yet billed                                                                                                                                                                                                                                                               |
| SQS command queue + DLQ (deployed 2026-10-26, `CountyLensApi`)                                     | $0.00 (pricing model: per request, first million per month free; first billed day pending)           | $0.40 per million requests after the free tier                      | Operator commands                                                      | Not yet billed (the existing scheduler DLQ has no billed line either)                                                                                                                                                                                                        |
| SNS alert topic `countylens-alerts` (CountyLensOps; admin alarms added 2026-10-26)                 | $0.00 (pricing model: first million publishes free, email deliveries free; first billed day pending) | Per publish and delivery above the free tier                        | Alarm events                                                           | Not yet billed                                                                                                                                                                                                                                                               |

Not deployed and not allowed: Secrets Manager, RDS, KMS customer keys, provisioned concurrency, WAF, Route 53 hosted zone (AC-2 assertions cover these).

## Per-use lines seen in the window

- **Amplify data transfer out**: 42.3 GB, $6.3472 (about 65% of gross usage, 2026-10-20 to 10-25). Largest day 2026-10-22: 20 GB, the day of the heaviest test and demo traffic.
- **Amplify build duration**: 348 minutes, $3.4833, from branch deploys and CI.
- **Bedrock Claude Sonnet 4.6**: $0.8264 across 10-24 and 10-25, first billed on 10-24.
- **Lambda**: about 21,650 requests on 2026-10-24 alone (5,895 x86 + 15,757 ARM) and 1,500+ GB-s, inside the free tier ($0.00).
- **DynamoDB writes**: 47,239 write units, $0.0317.
- **API Gateway**: 27,899 requests, $0.0296.
- **S3 requests**: 35,004 Tier-2 and 2,600 Tier-1, $0.0270.

## Honest exceptions

1. **Not all of the bill is CountyLens.** The account also hosts the separate `roofing-crm` project (stacks `Crm*`, Amplify app `roofing-crm-web`, a Cognito pool, three DynamoDB tables, three Secrets Manager secrets). Cost Explorer here is not split by stack or tag. **Secrets Manager ($0.0541 in the window, $0.0607 with 10-25) comes from the `roofing-crm/*` secrets, not CountyLens**; CountyLens has no secret. Amplify and DynamoDB also contain `roofing-crm` usage: by CloudWatch download bytes, `countylens-web` served about 39 GB and `roofing-crm-web` about 2.2 GB over 10-20 to 10-24, but build minutes and DynamoDB are not split. The figures above are therefore an upper bound for CountyLens.
2. **The window is short.** Cost Explorer holds five billed days with traffic (2026-10-20 to 10-24), all marked estimated. This is the PO-approved window (2026-10-26), recorded as a gate exception.
3. **No fixed line observed, but not "zero".** What stays on the bill with no traffic is storage cents. The $0.00 claim is about recurring fees, not about total usage.
4. **Part 2 resources** (Cognito, the admin SQS queue and DLQ, the admin alarms on the SNS topic) were deployed on 2026-10-26; they are stated from their pricing models until their first billed day appears in Cost Explorer (about 24 h later).
5. **Lambda reads $0.00** only because of the monthly free tier; at higher traffic it would bill.
6. **Leftover resource**: log group `/aws/lambda/CountyLensSpike-CustomS3AutoDeleteObjectsCustomRes-*` has no retention set (belongs to no current stack); it holds almost nothing, but it breaks the 14-day rule and should be deleted or given a retention.
7. **Account, not stack, budget**: the `assessment usd` budget is already over its $10 threshold on gross usage ($10.812); the CDK `countylens-monthly-*` budget is the one this project owns.

## Filebase (pinning vendor)

Filebase usage: **not available · reason: Filebase publishes usage and billing only in its dashboard; its S3-compatible API reports no billing or plan usage, and summing object sizes would need a full listing against a service that rate-limits (HTTP 429 seen).** Known from the run log: the free plan is 5 GB; one full county publication is about 2.95 GB (upper bound 3.73 GB), so a second pinned run would not fit (5.90 GB). Who pays: the PO's Filebase account. Pinata (second gateway) is on a plan that refuses pin-by-CID (`PAID_FEATURE_ONLY`), so any paid Pinata or self-hosted node is a cost line that does not exist yet.

## Pinata (second copy, AM-10)

Pinata cost: **$0.00 per month** on the free plan (1 GB, 500 files). Usage was read from Pinata's API (`GET /data/userPinnedDataTotal`) right after the Run 3.1 copy on 2026-10-26: **206 pins, 947,494,513 bytes**. That covers all 5 run manifests, 201 of Run 3.1's 255 table files and one Run 3 table part. The copy tool keeps a 950 MB budget and stops before the quota (`specs/016-cost-and-admin/pinata-receipts/travis-full-run3-1-20261025/summary.json`). Who pays: the PO's Pinata account, $0.

Not bought: a paid Pinata plan (about $20 a month) would hold every artifact, including the 4.0 GB of CARs, as a full second live pin. It is a recurring cost, so it conflicts with the README's no-ongoing-cost default (PO decision 2026-10-26, ARD § 16 AM-10).

The two public gateways, Pinata's `gateway.pinata.cloud` and `ipfs.orbitor.dev`, cost nothing and need no account. Storacha (planned 2026-10-26) is not used: its upload service ended on 2026-04-15.

## How to re-read this

```
aws ce get-cost-and-usage --profile assess --region us-east-1 \
  --time-period Start=2026-10-18,End=2026-10-25 --granularity DAILY \
  --metrics UnblendedCost --group-by Type=DIMENSION,Key=RECORD_TYPE
aws ce get-cost-and-usage ... --filter '{"Dimensions":{"Key":"RECORD_TYPE","Values":["Usage"]}}' \
  --group-by Type=DIMENSION,Key=SERVICE
aws freetier get-account-plan-state --profile assess --region us-east-1
```

Billing screenshot: `docs/evidence/img/A-16-billing.png` (Cost Explorer, daily, by service), added by the operator.
