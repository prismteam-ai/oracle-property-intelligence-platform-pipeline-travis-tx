// A-14 T008 (data-model.md "Spend counter"; agent-design.md § "ash" > "Spend-cap + alarm
// design"): one on-demand DynamoDB item per UTC day, `spent_usd` increments after a call,
// read-before-call returns `paused` when `spent_usd >= 3`, no TTL/idle cost (constitution A7).
// DynamoDB is aws-sdk-client-mock (the Golden Path mock, same pattern as apps/api/test/
// s3-read-observability.test.ts), so no AWS call happens here.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DAILY_SPEND_CAP_USD,
  readSpend,
  releaseSpend,
  recordSpend,
  spendKey,
  utcDateKey,
} from "../src/agent/spend.js";

const TABLE_NAME = "CountyLensAiSpendTest";
// Same fake region/credentials convention as test/helpers/fakes.ts ENV (never real, just enough
// for the SDK client to construct offline). aws-sdk-client-mock must be given the *document*
// client instance (not the base DynamoDBClient class) to intercept DynamoDBDocumentClient's
// document-marshalled GetCommand/UpdateCommand sends.
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: "xx-test-1",
    credentials: { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "test" },
  }),
);
const ddbMock = mockClient(ddb);

beforeEach(() => ddbMock.reset());

describe("spend counter (A-14 T008/T015)", () => {
  it("utcDateKey/spendKey: one key per UTC day, independent of local time", () => {
    const date = utcDateKey(new Date("2026-10-23T23:59:59.000Z"));
    expect(date).toBe("2026-10-23");
    expect(spendKey(date)).toBe("SPEND#2026-10-23");
  });

  it("readSpend with no item yet: spentUsd 0, not paused, a Get (not Scan/Query) on the one pk", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const now = new Date("2026-10-23T12:00:00.000Z");
    const status = await readSpend(ddb, TABLE_NAME, now);
    expect(status).toEqual({ date: "2026-10-23", spentUsd: 0, modelCalls: 0, paused: false });
    const calls = ddbMock.commandCalls(GetCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0].input).toMatchObject({
      TableName: TABLE_NAME,
      Key: { pk: "SPEND#2026-10-23" },
    });
  });

  it("readSpend below the cap is not paused", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { pk: "SPEND#2026-10-23", spent_usd: 1.5, model_calls: 4 },
    });
    const status = await readSpend(ddb, TABLE_NAME, new Date("2026-10-23T12:00:00.000Z"));
    expect(status).toEqual({ date: "2026-10-23", spentUsd: 1.5, modelCalls: 4, paused: false });
  });

  it("readSpend returns paused when spent_usd >= the $3 cap (exactly at the cap)", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { pk: "SPEND#2026-10-23", spent_usd: DAILY_SPEND_CAP_USD, model_calls: 20 },
    });
    const status = await readSpend(ddb, TABLE_NAME, new Date("2026-10-23T12:00:00.000Z"));
    expect(status.paused).toBe(true);
    expect(status.spentUsd).toBe(DAILY_SPEND_CAP_USD);
  });

  it("readSpend returns paused when spent_usd is above the cap", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { pk: "SPEND#2026-10-23", spent_usd: 5.42, model_calls: 25 },
    });
    const status = await readSpend(ddb, TABLE_NAME, new Date("2026-10-23T12:00:00.000Z"));
    expect(status.paused).toBe(true);
  });

  it("recordSpend increments spent_usd and model_calls via an atomic Update ADD (never a read-then-write)", async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { pk: "SPEND#2026-10-23", spent_usd: 0.08, model_calls: 1 },
    });
    const status = await recordSpend(ddb, TABLE_NAME, 0.08, new Date("2026-10-23T12:00:00.000Z"));
    expect(status).toEqual({ date: "2026-10-23", spentUsd: 0.08, modelCalls: 1, paused: false });
    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]?.args[0].input;
    expect(input).toMatchObject({
      TableName: TABLE_NAME,
      Key: { pk: "SPEND#2026-10-23" },
      UpdateExpression: expect.stringContaining("ADD"),
    });
    // Never a Put (which would clobber the running total) and never a TTL attribute anywhere.
    expect(JSON.stringify(input)).not.toMatch(/ttl|expires?_at/i);
  });

  it("recordSpend never sets a TTL/expiry attribute (constitution A7: no idle cost, but also no silent daily reset)", async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { pk: "SPEND#2026-10-23", spent_usd: 3, model_calls: 40 },
    });
    await recordSpend(ddb, TABLE_NAME, 0.01, new Date("2026-10-23T12:00:00.000Z"));
    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.ExpressionAttributeValues).not.toHaveProperty(":ttl");
    expect(String(input?.UpdateExpression)).not.toMatch(/ttl/i);
  });

  it("a day boundary (UTC midnight) produces a different key, so yesterday's spend never bleeds into today", () => {
    const beforeMidnight = utcDateKey(new Date("2026-10-23T23:59:59.999Z"));
    const afterMidnight = utcDateKey(new Date("2026-10-24T00:00:00.000Z"));
    expect(beforeMidnight).toBe("2026-10-23");
    expect(afterMidnight).toBe("2026-10-24");
    expect(beforeMidnight).not.toBe(afterMidnight);
  });
});

describe("releaseSpend (T048)", () => {
  it("is one atomic ADD of the negative reservation and -1 model call, no TTL", async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { pk: "SPEND#2026-10-23", spent_usd: 0, model_calls: 0 },
    });
    const status = await releaseSpend(ddb, TABLE_NAME, new Date("2026-10-23T12:00:00.000Z"), 0.05);
    expect(status.spentUsd).toBe(0);
    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input).toMatchObject({
      Key: { pk: "SPEND#2026-10-23" },
      ExpressionAttributeValues: { ":delta": -0.05, ":minusOne": -1 },
    });
    expect(String(input?.UpdateExpression)).toMatch(/^ADD /);
    expect(JSON.stringify(input)).not.toMatch(/ttl/i);
  });
});
