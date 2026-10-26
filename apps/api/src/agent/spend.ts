// A-14 T015 (data-model.md "Spend counter (new persisted entity)"; agent-design.md § "ash" >
// "Spend-cap + alarm design"; constitution A7 / P0-19): one on-demand DynamoDB item per UTC
// day, read before each model call (pre-empt to `paused` when `spent_usd >= $3`), incremented
// after a successful call. No TTL attribute is ever written — the item is one tiny row per
// day, cost is in on-demand request units, not storage, and a counter that silently expired
// mid-day would let spend quietly reset to zero.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/** The daily spend cap (USD) past which `agent.ask` returns `outcome: "paused"` (CLAUDE.md, A7).
 *  PO 2026-10-26: raised from $3 to $5 (CI's hosted agent checks alone used $2.95 that day and
 *  paused the agent for the demo recording and the evaluator). */
export const DAILY_SPEND_CAP_USD = 5;

/** Stage 5 review fix (Major #3, alakazam's review): a conservative per-call reservation
 *  (ask.ts's `reserveSpend` call), trued up to the real cost once token usage is known
 *  (ask.ts's `recordSpend(..., { incrementModelCalls: false })`). Large enough that a burst of
 *  concurrent requests cannot all slip through between a read and a later write, small enough
 *  that it does not itself meaningfully overshoot the $5/day cap on its own. */
export const SPEND_RESERVATION_USD = 0.05;

function isConditionalCheckFailed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "ConditionalCheckFailedException"
  );
}

export interface SpendStatus {
  /** `SPEND#<utc-date>`'s date part, e.g. "2026-10-23". */
  readonly date: string;
  readonly spentUsd: number;
  readonly modelCalls: number;
  /** `spentUsd >= DAILY_SPEND_CAP_USD`: the caller must not place another model call today. */
  readonly paused: boolean;
}

/** `SpendCounter.pk` for a given UTC date (data-model.md). */
export function spendKey(date: string): string {
  return `SPEND#${date}`;
}

/** Today's UTC date key (`YYYY-MM-DD`), never the Lambda's local time. */
export function utcDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function statusFromItem(date: string, item: Record<string, unknown> | undefined): SpendStatus {
  const spentUsd = typeof item?.spent_usd === "number" ? item.spent_usd : 0;
  const modelCalls = typeof item?.model_calls === "number" ? item.model_calls : 0;
  return { date, spentUsd, modelCalls, paused: spentUsd >= DAILY_SPEND_CAP_USD };
}

/**
 * Reads today's spend without mutating it — the pre-call check (`agent.ask` calls this before
 * ever invoking the model; `paused` means no model call is placed this request).
 */
export async function readSpend(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  now: Date = new Date(),
): Promise<SpendStatus> {
  const date = utcDateKey(now);
  const { Item } = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { pk: spendKey(date) } }),
  );
  return statusFromItem(date, Item);
}

export interface RecordSpendOptions {
  /** Default true. `reserveSpend` already incremented `model_calls` at reservation time, so the
   *  true-up call after the real cost is known passes `false` to avoid double-counting. */
  readonly incrementModelCalls?: boolean;
}

/**
 * Adds `deltaUsd` to today's spend (and, by default, increments `model_calls` by one) after a
 * model call completes. Uses an atomic `ADD` (not a read-modify-write) so concurrent requests on
 * the same UTC day never lose an increment; `deltaUsd` may be negative (the true-up after
 * `reserveSpend`'s reservation turns out to have over-estimated the real cost). Never sets a TTL
 * attribute.
 */
export async function recordSpend(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  deltaUsd: number,
  now: Date = new Date(),
  options: RecordSpendOptions = {},
): Promise<SpendStatus> {
  const incrementModelCalls = options.incrementModelCalls ?? true;
  const date = utcDateKey(now);
  const { Attributes } = await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: spendKey(date) },
      UpdateExpression: incrementModelCalls
        ? "ADD spent_usd :delta, model_calls :one"
        : "ADD spent_usd :delta",
      ExpressionAttributeValues: incrementModelCalls
        ? { ":delta": deltaUsd, ":one": 1 }
        : { ":delta": deltaUsd },
      ReturnValues: "ALL_NEW",
    }),
  );
  return statusFromItem(date, Attributes);
}

/**
 * Stage 5 review fix (Major #3): the spend-cap gate as one atomic conditional `UpdateCommand`
 * instead of a separate `readSpend` (check) then a later `recordSpend` (act) -- the gap between
 * those two calls (while the model call itself runs) is exactly where two concurrent requests
 * could both observe `spentUsd < cap` and both proceed, overrunning the cap. This reserves
 * `reservationUsd` up front, conditioned on today's pre-reservation `spent_usd` still being
 * under `capUsd` (DynamoDB evaluates the condition against the item's state immediately before
 * applying this update, so concurrent requests on the same day serialize through it one at a
 * time); `agent.ask` trues the reservation up to the real cost afterwards via `recordSpend(...,
 * { incrementModelCalls: false })`. On a failed condition (the cap was already reached), no
 * reservation is taken and the current status is read back so the caller still gets accurate
 * numbers for its `paused` response.
 */
export async function reserveSpend(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  now: Date = new Date(),
  reservationUsd: number = SPEND_RESERVATION_USD,
  capUsd: number = DAILY_SPEND_CAP_USD,
): Promise<SpendStatus> {
  return (await tryReserveSpend(ddb, tableName, now, reservationUsd, capUsd)).status;
}

/** Same as `reserveSpend`, but also says whether the reservation was actually taken (`false` =
 *  the conditional check failed, nothing to give back). The caller needs it: a reservation that
 *  was taken yet lands at or over the cap must be released, a refused one must not. */
export async function tryReserveSpend(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  now: Date = new Date(),
  reservationUsd: number = SPEND_RESERVATION_USD,
  capUsd: number = DAILY_SPEND_CAP_USD,
): Promise<{ reserved: boolean; status: SpendStatus }> {
  const date = utcDateKey(now);
  try {
    const { Attributes } = await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: spendKey(date) },
        UpdateExpression: "ADD spent_usd :delta, model_calls :one",
        ConditionExpression: "attribute_not_exists(spent_usd) OR spent_usd < :cap",
        ExpressionAttributeValues: { ":delta": reservationUsd, ":one": 1, ":cap": capUsd },
        ReturnValues: "ALL_NEW",
      }),
    );
    return { reserved: true, status: statusFromItem(date, Attributes) };
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      return { reserved: false, status: await readSpend(ddb, tableName, now) };
    }
    throw error;
  }
}

/**
 * T048: gives back a reservation taken by `reserveSpend` when no model call succeeded (aborted,
 * throttled or failed request), so those calls do not permanently burn `reservationUsd`. One
 * atomic `ADD` of the negative amounts: the real cost of such a call is 0, and the speculative
 * `model_calls` increment `reserveSpend` made is taken back too. Never sets a TTL attribute.
 */
export async function releaseSpend(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  now: Date = new Date(),
  reservationUsd: number = SPEND_RESERVATION_USD,
): Promise<SpendStatus> {
  const date = utcDateKey(now);
  const { Attributes } = await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: spendKey(date) },
      UpdateExpression: "ADD spent_usd :delta, model_calls :minusOne",
      ExpressionAttributeValues: { ":delta": -reservationUsd, ":minusOne": -1 },
      ReturnValues: "ALL_NEW",
    }),
  );
  return statusFromItem(date, Attributes);
}

/** Lazily-constructed singleton Document client (one per Lambda sandbox, like `s3-read.ts`). */
let documentClient: DynamoDBDocumentClient | undefined;

export function getSpendDocumentClient(): DynamoDBDocumentClient {
  documentClient ??= DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return documentClient;
}
