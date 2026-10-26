// T007: RunManifestV1 and RunsIndexV1 (contracts/manifest.md, data-model.md § RunManifestV1 additions).
import { describe, expect, it } from "vitest";
import { PILOT_LIMITATION, RunManifestV1, RunsIndexV1 } from "../src/index.js";

const RAW = "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu";
const RAW2 = "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq";
const DAG_JSON = "baguqeerasords4njcts6vs7qvdjfcvgnume4hqohf65zsfguprqphs3icwea";
const V0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const SHA = "a".repeat(64);

function manifest(): Record<string, unknown> {
  return {
    schema: "oracle-travis-run-manifest.v1",
    runId: "travis-pilot-20261020",
    county: "travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-20T22:00:00.000Z",
    finishedAt: "2026-10-20T23:00:00.000Z",
    previousManifestCid: null,
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
        watermark: "2026-10-20T12:36:38.000Z",
        captured_at: "2026-10-20T22:10:00.000Z",
        records: 50,
        added: 50,
        changed: 0,
        removed: 0,
        limitations: [],
      },
    ],
    artifacts: [
      {
        name: "travis-county.car",
        cid: DAG_JSON,
        codec: "dag-json",
        size: 1000,
        sha256: SHA,
        kind: "car",
      },
      {
        name: "tables/county/property/part-00000.parquet",
        cid: RAW,
        codec: "raw",
        size: 2000,
        sha256: SHA,
        kind: "table",
      },
      {
        name: "tables/county",
        cid: DAG_JSON,
        codec: "dag-json",
        size: 300,
        sha256: SHA,
        kind: "directory",
        carCid: RAW2,
      },
    ],
    profiles: [
      {
        name: "travis-austin",
        version: "1.0.0",
        sha256: SHA,
        path: "profiles/travis-austin@1.0.0/rules.json",
        gitCommit: "17c6cd8",
      },
    ],
    coverage: {
      parcel_match_matched: { count: 40, derivation: "capture_receipt" },
      permits_published: { count: 47, derivation: "published_rows" },
    },
    limitations: [PILOT_LIMITATION],
  };
}

const withArtifact = (patch: Record<string, unknown>, index = 0): Record<string, unknown> => {
  const m = manifest();
  const artifacts = m.artifacts as Record<string, unknown>[];
  artifacts[index] = { ...artifacts[index], ...patch };
  return m;
};

describe("RunManifestV1", () => {
  it("accepts the pilot shape", () => {
    expect(RunManifestV1.parse(manifest()).runId).toBe("travis-pilot-20261020");
  });

  it("carries the exact pilot limitation line", () => {
    expect(PILOT_LIMITATION).toBe(
      "pilot: local, unpublished; CIDs are real content addresses of local files, replaced in A-03",
    );
  });

  it("rejects a CIDv0 anywhere a CID goes", () => {
    expect(RunManifestV1.safeParse(withArtifact({ cid: V0 })).success).toBe(false);
    expect(RunManifestV1.safeParse({ ...manifest(), previousManifestCid: V0 }).success).toBe(false);
    expect(RunManifestV1.safeParse(withArtifact({ carCid: V0 }, 2)).success).toBe(false);
  });

  it("rejects a gateway URL anywhere", () => {
    expect(
      RunManifestV1.safeParse(withArtifact({ cid: `https://ipfs.io/ipfs/${RAW}` })).success,
    ).toBe(false);
    const m = manifest();
    at(m.sources as Record<string, unknown>[], 0).url = `https://dweb.link/ipfs/${RAW}`;
    expect(RunManifestV1.safeParse(m).success).toBe(false);
    const n = manifest();
    n.limitations = [`see https://gateway.pinata.cloud/ipfs/${RAW}`];
    expect(RunManifestV1.safeParse(n).success).toBe(false);
  });

  it("rejects a directory artifact without carCid", () => {
    const m = manifest();
    const dir = at(m.artifacts as Record<string, unknown>[], 2);
    delete dir.carCid;
    expect(RunManifestV1.safeParse(m).success).toBe(false);
  });

  it("rejects any IPNS field, at the top level or nested", () => {
    expect(RunManifestV1.safeParse({ ...manifest(), ipns: "k51q" }).success).toBe(false);
    expect(RunManifestV1.safeParse(withArtifact({ ipnsName: "k51q" })).success).toBe(false);
    expect(
      RunManifestV1.safeParse({ ...manifest(), limitations: ["/ipns/k51qzi5uqu5d"] }).success,
    ).toBe(false);
  });

  it("requires sources[].captured_at", () => {
    const m = manifest();
    delete at(m.sources as Record<string, unknown>[], 0).captured_at;
    expect(RunManifestV1.safeParse(m).success).toBe(false);
  });

  it("requires profiles[] {name, version, sha256, path, gitCommit}", () => {
    for (const key of ["name", "version", "sha256", "path", "gitCommit"]) {
      const m = manifest();
      const profile = at(m.profiles as Record<string, unknown>[], 0);
      m.profiles = [Object.fromEntries(Object.entries(profile).filter(([k]) => k !== key))];
      expect(RunManifestV1.safeParse(m).success, key).toBe(false);
    }
    const m = manifest();
    delete m.profiles;
    expect(RunManifestV1.safeParse(m).success).toBe(false);
  });

  it("requires a derivation on every coverage count, from the closed list", () => {
    const ok = ["published_rows", "capture_receipt", "aggregate_match"];
    for (const derivation of ok) {
      const m = manifest();
      m.coverage = { x: { count: 1, derivation } };
      expect(RunManifestV1.safeParse(m).success, derivation).toBe(true);
    }
    const bad = manifest();
    bad.coverage = { x: { count: 1, derivation: "estimated" } };
    expect(RunManifestV1.safeParse(bad).success).toBe(false);
    const none = manifest();
    none.coverage = { x: { count: 1 } };
    expect(RunManifestV1.safeParse(none).success).toBe(false);
    const neg = manifest();
    neg.coverage = { x: { count: -1, derivation: "published_rows" } };
    expect(RunManifestV1.safeParse(neg).success).toBe(false);
  });

  it("rejects an artifact kind outside car|table|directory and a bad sha256", () => {
    expect(RunManifestV1.safeParse(withArtifact({ kind: "zip" })).success).toBe(false);
    expect(RunManifestV1.safeParse(withArtifact({ sha256: "abc" })).success).toBe(false);
  });

  it("rejects finishedAt before startedAt", () => {
    expect(
      RunManifestV1.safeParse({ ...manifest(), finishedAt: "2026-10-20T21:00:00.000Z" }).success,
    ).toBe(false);
  });
});

describe("RunsIndexV1", () => {
  const run = (runId: string, finishedAt: string) => ({ runId, manifestCid: RAW, finishedAt });

  it("accepts runs ordered by finishedAt", () => {
    const index = {
      schema: "oracle-travis-runs-index.v1",
      runs: [
        run("travis-20261101", "2026-11-01T00:00:00.000Z"),
        run("travis-20261108", "2026-11-08T00:00:00.000Z"),
      ],
    };
    expect(RunsIndexV1.parse(index).runs).toHaveLength(2);
  });

  it("rejects runs out of finishedAt order", () => {
    const index = {
      schema: "oracle-travis-runs-index.v1",
      runs: [
        run("travis-20261108", "2026-11-08T00:00:00.000Z"),
        run("travis-20261101", "2026-11-01T00:00:00.000Z"),
      ],
    };
    expect(RunsIndexV1.safeParse(index).success).toBe(false);
  });

  it("never lists the pilot, and rejects a v0 manifest CID", () => {
    const pilot = {
      schema: "oracle-travis-runs-index.v1",
      runs: [run("travis-pilot-20261020", "2026-10-20T23:00:00.000Z")],
    };
    expect(RunsIndexV1.safeParse(pilot).success).toBe(false);
    const v0 = {
      schema: "oracle-travis-runs-index.v1",
      runs: [{ runId: "travis-20261101", manifestCid: V0, finishedAt: "2026-11-01T00:00:00.000Z" }],
    };
    expect(RunsIndexV1.safeParse(v0).success).toBe(false);
  });
});

/** The element at `i`, failing the test when it is absent. */
function at<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`no element at ${i}`);
  return v;
}
