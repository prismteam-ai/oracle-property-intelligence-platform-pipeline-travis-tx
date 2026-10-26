// A-13 T017 at unit level (Vitest): the hosted-harness helpers of the A-13 specs. The run
// oracle (runs/index.json from RUNTIME_URL, manifests by CID from Pinata), the real-CID
// allowlist and the prototype-placeholder denylist (research R8). Inputs are the committed run
// index and manifest of this repository (real published data, read from disk) and fetch stubs;
// nothing here reaches the network.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import { describe, expect, it, vi } from "vitest";
import {
  PLACEHOLDER_DENYLIST_PATH,
  buildCidAllowlist,
  cidTokens,
  denylistHits,
  disallowedCidTokens,
  fetchA13RunsIndex,
  fetchAllManifests,
  fetchManifestFromPinata,
  latestRunEntry,
  loadPlaceholderDenylist,
  pinataManifestUrl,
  prototypeCidTokens,
  numberedRunsByFinishedAt,
  runName,
  runNumber,
  truncateCid,
} from "./a13.js";
import { repoRoot } from "./runtime.js";

const committedIndexBytes = readFileSync(resolve(repoRoot, "runs", "index.json"));
const committedIndex = RunsIndexV1.parse(JSON.parse(committedIndexBytes.toString("utf8")));
const firstRun = committedIndex.runs[0];
if (!firstRun) throw new Error("runs/index.json lists no runs");
const first = firstRun;
const firstArtifactCid = (): string => {
  const artifact = manifest.artifacts[0];
  if (!artifact) throw new Error("the committed manifest lists no artifacts");
  return artifact.cid;
};
const manifestBytes = new Uint8Array(
  readFileSync(resolve(repoRoot, "runs", first.runId, "manifest.json")),
);
const manifest = RunManifestV1.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));

function stubFetch(routes: Record<string, Uint8Array | number>) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    const body = routes[url];
    if (body === undefined) return new Response("not routed", { status: 599 });
    if (typeof body === "number") return new Response("", { status: body });
    return new Response(new Blob([new Uint8Array(body)]), { status: 200 });
  });
}

describe("run oracle: runs/index.json from RUNTIME_URL", () => {
  it("reads {RUNTIME_URL}/runs/index.json and validates RunsIndexV1", async () => {
    const fetchImpl = stubFetch({
      "https://preview.example.invalid/runs/index.json": new Uint8Array(committedIndexBytes),
    });
    const index = await fetchA13RunsIndex({
      runtimeUrl: "https://preview.example.invalid",
      fetchImpl,
    });
    expect(index).toEqual(committedIndex);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("an unreadable index is an error naming the URL and the status", async () => {
    const fetchImpl = stubFetch({ "https://preview.example.invalid/runs/index.json": 404 });
    await expect(
      fetchA13RunsIndex({ runtimeUrl: "https://preview.example.invalid", fetchImpl }),
    ).rejects.toThrow(/runs\/index\.json → HTTP 404/);
  });

  it("latest = greatest finishedAt; Run {n} = 1-based finishedAt order (not array order)", () => {
    const a = { runId: "a", manifestCid: first.manifestCid, finishedAt: "2026-10-01T00:00:00Z" };
    const b = { runId: "b", manifestCid: first.manifestCid, finishedAt: "2026-10-03T00:00:00Z" };
    const c = { runId: "c", manifestCid: first.manifestCid, finishedAt: "2026-10-02T00:00:00Z" };
    const index = { schema: committedIndex.schema, runs: [a, b, c] } as RunsIndexV1;
    expect(latestRunEntry(index).runId).toBe("b");
    expect(runNumber(index, "a")).toBe(1);
    expect(runNumber(index, "c")).toBe(2);
    expect(runNumber(index, "b")).toBe(3);
    expect(() => runNumber(index, "missing")).toThrow(/missing/);
    expect(() => latestRunEntry({ ...index, runs: [] })).toThrow(/no runs/);
  });

  it("the A-03 pilot slice is listed but never numbered; the full runs are Run 1..n", () => {
    const pilot = {
      runId: "travis-202609-permits-20261021t103516z",
      manifestCid: first.manifestCid,
      finishedAt: "2026-10-21T10:40:00Z",
    };
    const run = (id: string, day: string) => ({
      runId: id,
      manifestCid: first.manifestCid,
      finishedAt: `2026-10-${day}T00:00:00Z`,
    });
    const index = {
      schema: committedIndex.schema,
      runs: [pilot, run("r1", "23"), run("r2", "24"), run("r3", "25")],
    } as RunsIndexV1;
    expect(runNumber(index, pilot.runId)).toBeNull();
    expect(runNumber(index, "r1")).toBe(1);
    expect(runNumber(index, "r3")).toBe(3);
    expect(numberedRunsByFinishedAt(index).map((r) => r.runId)).toEqual(["r1", "r2", "r3"]);
    expect(runName(null)).toBe("Pilot slice");
    expect(runName(3)).toBe("Run 3");
  });

  it("takes the number in the run ID: run3-1 is Run 3.1, and the next plain run follows the highest", () => {
    const index = {
      schema: "oracle-travis-runs-index.v1",
      runs: [
        {
          runId: "travis-full-run3-20261025",
          manifestCid: "x3",
          finishedAt: "2026-10-25T12:00:00Z",
        },
        {
          runId: "travis-full-run3-1-20261025",
          manifestCid: "x31",
          finishedAt: "2026-10-25T22:00:00Z",
        },
        { runId: "travis-bridge-20261101", manifestCid: "x4", finishedAt: "2026-11-01T00:00:00Z" },
      ],
    } as unknown as RunsIndexV1;
    expect(runNumber(index, "travis-full-run3-1-20261025")).toBe("3.1");
    expect(runName(runNumber(index, "travis-full-run3-1-20261025"))).toBe("Run 3.1");
    expect(runNumber(index, "travis-bridge-20261101")).toBe(4);
  });
});

describe("manifests by CID from the Pinata gateway (independent of the app's read path)", () => {
  it("builds https://gateway.pinata.cloud/ipfs/{cid} by default", () => {
    expect(pinataManifestUrl(first.manifestCid)).toBe(
      `https://gateway.pinata.cloud/ipfs/${first.manifestCid}`,
    );
  });

  it("fetches, checks the bytes hash to the CID and parses RunManifestV1", async () => {
    const fetchImpl = stubFetch({ [pinataManifestUrl(first.manifestCid)]: manifestBytes });
    const got = await fetchManifestFromPinata(first.manifestCid, { fetchImpl });
    expect(got.manifest).toEqual(manifest);
    expect(got.url).toBe(`https://gateway.pinata.cloud/ipfs/${first.manifestCid}`);
  });

  it("refuses bytes that do not hash to the requested CID", async () => {
    const tampered = new Uint8Array(manifestBytes);
    const at = tampered.length - 2;
    tampered[at] = (tampered[at] ?? 0) ^ 1;
    const fetchImpl = stubFetch({ [pinataManifestUrl(first.manifestCid)]: tampered });
    await expect(fetchManifestFromPinata(first.manifestCid, { fetchImpl })).rejects.toThrow(
      /hash to .* not /,
    );
  });

  it("fetches every manifest listed in the index", async () => {
    const fetchImpl = stubFetch(
      Object.fromEntries(
        committedIndex.runs.map((r) => [
          pinataManifestUrl(r.manifestCid),
          new Uint8Array(readFileSync(resolve(repoRoot, "runs", r.runId, "manifest.json"))),
        ]),
      ),
    );
    const all = await fetchAllManifests(committedIndex, { fetchImpl });
    expect(all.map((m) => m.manifestCid)).toEqual(committedIndex.runs.map((r) => r.manifestCid));
  });
});

describe("real-CID allowlist (research R8)", () => {
  const allow = buildCidAllowlist([{ manifestCid: first.manifestCid, manifest }]);

  it("is the union of manifest CID, previousManifestCid, artifacts[].cid and carCid", () => {
    expect(allow.has(first.manifestCid)).toBe(true);
    for (const artifact of manifest.artifacts) {
      expect(allow.has(artifact.cid)).toBe(true);
      if (artifact.carCid) expect(allow.has(artifact.carCid)).toBe(true);
    }
    const expected = new Set<string>([first.manifestCid]);
    if (manifest.previousManifestCid) expected.add(manifest.previousManifestCid);
    for (const a of manifest.artifacts) {
      expected.add(a.cid);
      if (a.carCid) expected.add(a.carCid);
    }
    expect([...allow].sort()).toEqual([...expected].sort());
  });

  it("includes previousManifestCid when a later manifest names one", () => {
    const later = { ...manifest, previousManifestCid: first.manifestCid };
    const other = firstArtifactCid();
    const set = buildCidAllowlist([{ manifestCid: other, manifest: later }]);
    expect(set.has(first.manifestCid)).toBe(true);
  });

  it("finds full and {4}…{4} CID tokens; real ones pass, invented ones fail", () => {
    const real = firstArtifactCid();
    const fake = `bafybei${"q".repeat(52)}`;
    const text = `manifest ${truncateCid(first.manifestCid)} car ${real} fake ${fake} short ${truncateCid(fake)}`;
    expect(cidTokens(text)).toEqual([
      truncateCid(first.manifestCid),
      real,
      fake,
      truncateCid(fake),
    ]);
    expect(disallowedCidTokens(text, allow)).toEqual([fake, truncateCid(fake)]);
  });

  it("a hex digest truncated as {4}…{4} is not mistaken for a CID", () => {
    expect(cidTokens("SHA-256 0b77…e19f")).toEqual([]);
  });
});

describe("prototype-placeholder denylist (research R8)", () => {
  const denylist = loadPlaceholderDenylist();

  it("lives at tests/e2e/fixtures/prototype-placeholders.json with the curated R8 strings", () => {
    expect(PLACEHOLDER_DENYLIST_PATH).toMatch(
      /tests\/e2e\/fixtures\/prototype-placeholders\.json$/,
    );
    const texts = denylist.strings.map((s) => s.text);
    for (const text of [
      "SAMPLE, JORDAN A",
      "128 within 5 mi",
      "Run 4",
      "38.2 MB",
      "not wired",
      "city hall",
    ]) {
      expect(texts).toContain(text);
    }
    expect(denylist.selectors).toContain('[name="ProtoBar"]');
  });

  it("matches whole phrases case-insensitively, not inside longer tokens", () => {
    expect(denylistHits("Owner SAMPLE, JORDAN A", denylist, { runCount: 1 })).toEqual([
      "SAMPLE, JORDAN A",
    ]);
    expect(denylistHits("Near City Hall", denylist, { runCount: 1 })).toEqual(["city hall"]);
    expect(denylistHits("Run 40 · 138.2 MB", denylist, { runCount: 1 })).toEqual([]);
  });

  it('"Run 4" is a placeholder only while the index lists fewer than four runs', () => {
    expect(denylistHits("Run 4", denylist, { runCount: 3 })).toEqual(["Run 4"]);
    expect(denylistHits("Run 4", denylist, { runCount: 4 })).toEqual([]);
  });

  it("extracts the prototype's CID-shaped tokens (full, or truncated with …) but no bare prefix", () => {
    const tokens = prototypeCidTokens();
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(token).toMatch(/^(baf|bag)[a-z2-7]+(…[a-z2-7]+)?$/);
      expect(token.includes("…") || token.length >= 23).toBe(true);
    }
    expect(tokens).not.toContain("bafybei");
    expect(tokens).not.toContain("bafkrei");
  });
});
