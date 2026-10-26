// A-16 T076 (ARD § 16 AM-10, PO wording 2026-10-26): the Verify page result reads only the two
// counted lanes (Pinata, orbitor). Filebase never decides it; a miss names each counted lane as
// "bytes differ on X" (mismatch) or "no verified answer from X" (anything else).
import { VERIFY_TEXTS } from "@countylens/shared";
import { describe, expect, it } from "vitest";
import {
  independentResult,
  independentResultStatus,
  type LaneState,
} from "../src/data/verify-lane";

const verified: LaneState = { kind: "verified", size: 1, sha256: "a" };
const mismatch: LaneState = {
  kind: "mismatch",
  got: { size: 1, sha256: "b" },
  expected: { size: 1, sha256: "a" },
  text: "Mismatch",
};
const failed: LaneState = { kind: "failed", text: "Not verified · x", cause: "retries" };
const viaCar: LaneState = { kind: "via_car", text: VERIFY_TEXTS.viaCar };
const fetching: LaneState = { kind: "fetching", attempt: 1 };

describe("independentResult (counted lanes only)", () => {
  it("verified only when Pinata and orbitor both matched", () => {
    expect(independentResult({ pinata: verified, orbitor: verified })).toEqual({
      kind: "verified",
      text: VERIFY_TEXTS.independentVerified,
    });
    expect(VERIFY_TEXTS.independentVerified).toBe(
      "Verified on Pinata and orbitor · two public gateways CountyLens does not operate; bytes match the manifest",
    );
  });

  it("Filebase never counts: a Filebase match with no counted lanes stays pending", () => {
    expect(independentResult({ filebase: verified }).kind).toBe("pending");
    expect(independentResult({}).kind).toBe("pending");
    expect(independentResult({ pinata: verified }).kind).toBe("pending");
    expect(independentResult({ orbitor: verified, pinata: fetching }).kind).toBe("pending");
  });

  it("a Filebase mismatch never withholds a counted verification", () => {
    expect(
      independentResult({ pinata: verified, orbitor: verified, filebase: mismatch }).kind,
    ).toBe("verified");
  });

  it("names a single-lane miss on either side", () => {
    expect(independentResult({ pinata: verified, orbitor: failed }).text).toBe(
      "Not verified on two public gateways · no verified answer from orbitor",
    );
    expect(independentResult({ pinata: failed, orbitor: verified }).text).toBe(
      "Not verified on two public gateways · no verified answer from Pinata",
    );
    expect(independentResult({ pinata: mismatch, orbitor: verified }).text).toBe(
      "Not verified on two public gateways · bytes differ on Pinata",
    );
    expect(independentResult({ pinata: verified, orbitor: mismatch, filebase: verified })).toEqual({
      kind: "not_verified",
      text: "Not verified on two public gateways · bytes differ on orbitor",
      bytesDiffer: true,
    });
  });

  it("names both lanes when both missed, mismatch first", () => {
    expect(independentResult({ pinata: failed, orbitor: failed }).text).toBe(
      "Not verified on two public gateways · no verified answer from Pinata and orbitor",
    );
    expect(independentResult({ pinata: failed, orbitor: mismatch }).text).toBe(
      "Not verified on two public gateways · bytes differ on orbitor; no verified answer from Pinata",
    );
  });

  it("via_car when both counted lanes are via_car (directory or > 50 MB)", () => {
    expect(independentResult({ pinata: viaCar, orbitor: viaCar })).toEqual({
      kind: "via_car",
      text: VERIFY_TEXTS.viaCar,
    });
    expect(independentResult({ pinata: viaCar }).kind).toBe("pending");
  });

  it("pill status: error only when bytes differ; a lane out of retries is a warning", () => {
    const retriesOnly = independentResult({ pinata: failed, orbitor: verified });
    expect(retriesOnly).toMatchObject({ kind: "not_verified", bytesDiffer: false });
    expect(independentResultStatus(retriesOnly)).toBe("warning");
    expect(independentResultStatus(independentResult({ pinata: failed, orbitor: failed }))).toBe(
      "warning",
    );
    const differ = independentResult({ pinata: mismatch, orbitor: failed });
    expect(differ).toMatchObject({ kind: "not_verified", bytesDiffer: true });
    expect(independentResultStatus(differ)).toBe("error");
    expect(
      independentResultStatus(independentResult({ pinata: verified, orbitor: verified })),
    ).toBe("verified");
    expect(independentResultStatus(independentResult({}))).toBe("info");
    expect(independentResultStatus(independentResult({ pinata: viaCar, orbitor: viaCar }))).toBe(
      "info",
    );
  });
});
