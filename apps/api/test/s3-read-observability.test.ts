// metagross N3 (CR-A-03 re-score): `getManifest` maps a GetObject 403 to NOT_FOUND (the reader
// has no ListBucket on ipfs/, so a missing key answers 403). If the GetObject grant itself ever
// broke, every runs.summary would be NOT_FOUND and the 5xx alarm would stay silent. So the 403
// branch emits exactly one Powertools `logger.warn` (identifiers only: CID, key, status, error
// name) and one `ManifestAccessDenied` Count metric; a 404 emits neither. S3 is
// aws-sdk-client-mock; no AWS call happens here.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetricUnit } from "@aws-lambda-powertools/metrics";
import { GetObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  METRIC_MANIFEST_ACCESS_DENIED,
  getManifest,
  setS3ReadObservability,
} from "../src/engine/s3-read.js";
import { ENV, fixtureManifest } from "./helpers/fakes.js";

const REAL_TMP = tmpdir();
const s3 = mockClient(S3Client);
const warn = vi.fn();
const addMetric = vi.fn();
const publishStoredMetrics = vi.fn();
let tmp: string;

const s3Error = (httpStatusCode: number, name: string, message: string): Error =>
  Object.assign(new Error(message), { name, $fault: "client", $metadata: { httpStatusCode } });

beforeAll(() => {
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
  setS3ReadObservability({ logger: { warn }, metrics: { addMetric, publishStoredMetrics } });
});

beforeEach(() => {
  tmp = mkdtempSync(join(REAL_TMP, "countylens-api-s3obs-"));
  vi.stubEnv("TMPDIR", tmp);
  s3.reset();
  warn.mockClear();
  addMetric.mockClear();
  publishStoredMetrics.mockClear();
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

afterAll(() => {
  setS3ReadObservability(undefined);
  vi.unstubAllEnvs();
});

describe("getManifest: a 403 mapped to NOT_FOUND stays visible (metagross N3)", () => {
  it("A-03-N3: a 403 AccessDenied is NOT_FOUND and emits one logger.warn (IDs only) and one ManifestAccessDenied metric", async () => {
    const { cid } = await fixtureManifest({ runId: "travis-n3-403" });
    s3.on(GetObjectCommand, { Key: `ipfs/${cid}` }).rejects(
      s3Error(
        403,
        "AccessDenied",
        "Access Denied https://copy-bucket.s3.amazonaws.com/?X-Amz-Signature=secret",
      ),
    );
    await expect(getManifest(cid)).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(warn).toHaveBeenCalledTimes(1);
    const [message, fields] = warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toMatch(/403/);
    expect(fields).toEqual({
      manifestCid: cid,
      key: `ipfs/${cid}`,
      httpStatusCode: 403,
      errorName: "AccessDenied",
    });
    expect(JSON.stringify(warn.mock.calls), "no URL, signature or raw error text").not.toMatch(
      /https?:|X-Amz|Access Denied/,
    );

    expect(METRIC_MANIFEST_ACCESS_DENIED).toBe("ManifestAccessDenied");
    expect(addMetric).toHaveBeenCalledTimes(1);
    expect(addMetric).toHaveBeenCalledWith("ManifestAccessDenied", MetricUnit.Count, 1);
    expect(publishStoredMetrics).toHaveBeenCalledTimes(1);
  });

  it("A-03-N3: a 403 identified by status only (no AccessDenied name) is reported the same way", async () => {
    const { cid } = await fixtureManifest({ runId: "travis-n3-403-status" });
    s3.on(GetObjectCommand, { Key: `ipfs/${cid}` }).rejects(
      s3Error(403, "UnknownError", "Forbidden"),
    );
    await expect(getManifest(cid)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(addMetric).toHaveBeenCalledWith("ManifestAccessDenied", MetricUnit.Count, 1);
  });

  it.each([
    [
      "NoSuchKey",
      () => new NoSuchKey({ $metadata: {}, message: "The specified key does not exist." }),
    ],
    ["a 404 by status", () => s3Error(404, "UnknownError", "Not Found")],
  ])("A-03-N3: %s is NOT_FOUND with no warning and no metric", async (_, error) => {
    const { cid } = await fixtureManifest({ runId: `travis-n3-404-${_.length}` });
    s3.on(GetObjectCommand, { Key: `ipfs/${cid}` }).rejects(error());
    await expect(getManifest(cid)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(warn).not.toHaveBeenCalled();
    expect(addMetric).not.toHaveBeenCalled();
    expect(publishStoredMetrics).not.toHaveBeenCalled();
  });
});
