// The previous-run identity gate (Task B leads key on property_cid / permit_cid and the
// request_identifier): a Run 3 publish is refused unless every previous cid still exists with
// the same request_identifier, or the old -> new map is explicit and complete.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { QueryEngine } from "@countylens/query-core";
import { cidOfBytes } from "../src/cid.js";
import {
  BIND_TIMEOUT_MS_DEFAULT,
  withDeadline,
  collectIdentity,
  compareIdentity,
  loadPreviousManifest,
  type IdentitySet,
} from "../src/identity-gate.js";

const set = (
  properties: [string, string | null][],
  permits: [string, string | null][],
): IdentitySet => ({
  properties: new Map(properties),
  permits: new Map(permits),
});
const RUN2 = set(
  [
    ["p1", "100"],
    ["p2", "200"],
  ],
  [
    ["m1", "1984-025453 BP"],
    ["m2", "1985-000001 BP"],
  ],
);

describe("withDeadline (A11-16: no untimed remote bind)", () => {
  it("passes the result through and clears its timer", async () => {
    await expect(withDeadline(Promise.resolve(7), 1000, "x")).resolves.toBe(7);
  });

  it("rejects naming what timed out when the work never settles", async () => {
    await expect(
      withDeadline(new Promise<never>(() => {}), 20, "binding the manifest"),
    ).rejects.toThrow("binding the manifest timed out after 20 ms");
  });

  it("propagates the work's own rejection", async () => {
    await expect(withDeadline(Promise.reject(new Error("boom")), 1000, "x")).rejects.toThrow(
      "boom",
    );
  });

  it("the default bind deadline is finite", () => {
    expect(BIND_TIMEOUT_MS_DEFAULT).toBeGreaterThan(0);
    expect(Number.isFinite(BIND_TIMEOUT_MS_DEFAULT)).toBe(true);
  });
});

describe("compareIdentity", () => {
  it("passes on an identical set and when Run 3 only adds records", () => {
    expect(compareIdentity(RUN2, RUN2, false).failures).toEqual([]);
    const grown = set(
      [
        ["p1", "100"],
        ["p2", "200"],
        ["p3", "300"],
      ],
      [
        ["m1", "1984-025453 BP"],
        ["m2", "1985-000001 BP"],
        ["m3", "x"],
      ],
    );
    const { comparison, failures } = compareIdentity(RUN2, grown, false);
    expect(failures).toEqual([]);
    expect(comparison).toMatchObject({ missing_properties: 0, missing_permits: 0 });
  });

  it("trips when a property_cid or a permit cid is missing", () => {
    const noProp = set(
      [["p1", "100"]],
      [
        ["m1", "1984-025453 BP"],
        ["m2", "1985-000001 BP"],
      ],
    );
    const a = compareIdentity(RUN2, noProp, false);
    expect(a.failures[0]).toMatch(/1 previous property_cids and 0 permit_cids are missing/);
    expect(a.comparison.lost).toEqual(["p2"]);
    const noPermit = set(
      [
        ["p1", "100"],
        ["p2", "200"],
      ],
      [["m1", "1984-025453 BP"]],
    );
    expect(compareIdentity(RUN2, noPermit, false).failures[0]).toMatch(
      /0 previous property_cids and 1 permit_cids are missing/,
    );
  });

  it("trips when a cid survives with a different request_identifier", () => {
    const moved = set(
      [
        ["p1", "100"],
        ["p2", "999"],
      ],
      [...RUN2.permits],
    );
    expect(compareIdentity(RUN2, moved, false).failures).toEqual([
      "1 previous cids exist with a different request_identifier",
    ]);
  });

  it("accepts a re-hash only with an explicit map and when every request_identifier survives", () => {
    const rehashed = set(
      [
        ["q1", "100"],
        ["q2", "200"],
      ],
      [...RUN2.permits],
    );
    expect(compareIdentity(RUN2, rehashed, false).failures).toHaveLength(1);
    const ok = compareIdentity(RUN2, rehashed, true);
    expect(ok.failures).toEqual([]);
    expect(ok.comparison.cid_map).toEqual([
      { kind: "property", old: "p1", new: "q1" },
      { kind: "property", old: "p2", new: "q2" },
    ]);
    const partial = set([["q1", "100"]], [...RUN2.permits]);
    expect(compareIdentity(RUN2, partial, true).failures).toEqual([
      "1 previous cids have no successor with the same request_identifier",
    ]);
  });
});

describe("collectIdentity", () => {
  it("reads the (cid, request_identifier) pairs of v_property and v_roofing_permit", async () => {
    const engine: QueryEngine = {
      run: async () => undefined,
      all: async (sql) =>
        sql.includes("v_property")
          ? [{ cid: "p1", rid: "100" }]
          : [
              { cid: "m1", rid: "A" },
              { cid: "m2", rid: null },
            ],
    };
    const got = await collectIdentity(engine);
    expect([...got.properties]).toEqual([["p1", "100"]]);
    expect([...got.permits]).toEqual([
      ["m1", "A"],
      ["m2", null],
    ]);
  });
});

describe("loadPreviousManifest", () => {
  it("returns the bytes only when their CID is the previousManifestCid", async () => {
    const root = mkdtempSync(join(tmpdir(), "idgate-"));
    const bytes = Buffer.from('{"runId":"r2"}');
    const cid = await cidOfBytes(bytes);
    mkdirSync(join(root, "runs", "r2"), { recursive: true });
    writeFileSync(join(root, "runs", "r2", "manifest.json"), bytes);
    writeFileSync(
      join(root, "runs", "index.json"),
      JSON.stringify({ runs: [{ runId: "r2", manifestCid: cid }] }),
    );
    expect((await loadPreviousManifest(root, cid)).equals(bytes)).toBe(true);
    await expect(loadPreviousManifest(root, "bafkreiother")).rejects.toThrow(/not in runs\/index/);
    writeFileSync(join(root, "runs", "r2", "manifest.json"), "tampered");
    await expect(loadPreviousManifest(root, cid)).rejects.toThrow(/has CID/);
  });
});
