// A-03 T006 (G-A2): the Lambda's Zod-validated environment (plan § "Fixed texts and config
// keys"; constitution III "region from config", V "Zod on every input"). Written before
// src/config.ts exists: the red run fails with "Cannot find module '../src/config'".
// The required keys are the ones the Lambda reads (s3-read.ts); a missing one must fail at load
// time, naming the key. /code-review Minor 7: CID_COPY_HOST and FILEBASE_GATEWAY_HOST are read by
// no Lambda code, so they are not required (a deploy without them must still serve).
import { describe, expect, it } from "vitest";
import { REQUIRED_ENV_KEYS, loadConfig } from "../src/config.js";

type Env = Record<string, string | undefined>;

/** In-test values only (plan Notes: unit tests build their own data); nothing here is real. */
const VALID: Env = {
  CID_COPY_BUCKET: "copy-bucket",
  READPATH_PRIVATE_PREFIX: "private/bench/",
};

const without = (key: string): Env =>
  Object.fromEntries(Object.entries(VALID).filter(([name]) => name !== key));

describe("apps/api config (Zod env)", () => {
  it("requires exactly the keys the Lambda reads: CID_COPY_BUCKET, READPATH_PRIVATE_PREFIX", () => {
    expect([...REQUIRED_ENV_KEYS].sort()).toEqual(["CID_COPY_BUCKET", "READPATH_PRIVATE_PREFIX"]);
  });

  it("loads the two keys from the given env", () => {
    expect(loadConfig(VALID)).toEqual({
      cidCopyBucket: "copy-bucket",
      readPathPrivatePrefix: "private/bench/",
    });
  });

  it("serves without CID_COPY_HOST / FILEBASE_GATEWAY_HOST and ignores them when set (no Lambda code reads them)", () => {
    expect(() => loadConfig(VALID)).not.toThrow();
    expect(
      loadConfig({ ...VALID, CID_COPY_HOST: "https://not-bare", FILEBASE_GATEWAY_HOST: "x/y" }),
    ).toEqual(loadConfig(VALID));
  });

  it.each([...REQUIRED_ENV_KEYS])("throws naming %s when it is missing", (key) => {
    expect(() => loadConfig(without(key))).toThrow(key);
  });

  it("treats an empty value as missing and names the key", () => {
    expect(() => loadConfig({ ...VALID, CID_COPY_BUCKET: "" })).toThrow("CID_COPY_BUCKET");
  });

  it("names every missing key when several are absent", () => {
    expect(() => loadConfig({})).toThrow(/CID_COPY_BUCKET.*READPATH_PRIVATE_PREFIX/s);
  });

  it("rejects a private prefix outside private/<name>/, naming the key", () => {
    expect(() => loadConfig({ ...VALID, READPATH_PRIVATE_PREFIX: "ipfs/" })).toThrow(
      "READPATH_PRIVATE_PREFIX",
    );
    expect(() => loadConfig({ ...VALID, READPATH_PRIVATE_PREFIX: "private/bench" })).toThrow(
      "READPATH_PRIVATE_PREFIX",
    );
  });

  it("ignores unrelated keys and carries no region (the SDK reads AWS_REGION itself)", () => {
    const config = loadConfig({ ...VALID, UNRELATED: "x" });
    expect(Object.keys(config).sort()).toEqual(["cidCopyBucket", "readPathPrivatePrefix"]);
  });
});
