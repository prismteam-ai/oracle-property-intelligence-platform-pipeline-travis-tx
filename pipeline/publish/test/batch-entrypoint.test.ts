// T029: runBatchPublish, the Fargate task's non-interactive publishRun-equivalent. Unlike
// upload.ts's publishRun, this path takes no `approved` (no D-8 human-approval gate exists on
// its BatchPublishOptions at all); it is gated by the sequence's own readback against the run's
// own local files. Fixture style mirrors upload.test.ts's fakeCli/fakeNetwork (a fake elephant-cli
// writing real CARs/tables; a fake Kubo RPC `add` plus the gateway serving what was added), kept
// to one group to stay focused on this file's own behaviour (no build/approve split, no bind
// guard — out of this entrypoint's scope per the contract).
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { CarWriter } from "@ipld/car/writer";
import * as dagJson from "@ipld/dag-json";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { describe, expect, it } from "vitest";
import { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import { cidOfBytes, cidOfFile } from "../src/cid.js";
import { appendRun, emptyRunsIndex, parseRunsIndex, runsIndexBytes } from "../src/runs-index.js";
import { PART_SIZE_BYTES, planPublish, type CliRunner, type DataGroup } from "../src/sequence.js";
import { runBatchPublish, type BatchPublishOptions } from "../src/batch-entrypoint.js";
import type { FetchLike } from "../src/kubo-add.js";

const RUN_ID = "travis-202609-permits-20261021t160000z";
const GROUPS: readonly DataGroup[] = ["county"];
const SEED = "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu";
const COUNTY_DG = "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq";
const ENV = {
  FILEBASE_ACCESS_KEY: "FAKEACCESSKEY000",
  FILEBASE_SECRET_KEY: "fake-secret-key-value-xyz",
  FILEBASE_BUCKET: "countylens-fake",
};

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

function write(path: string, body: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

function arg(argv: string[], flag: string): string {
  const i = argv.indexOf(flag);
  if (i < 0) throw new Error(`missing ${flag}`);
  return argv[i + 1] as string;
}

async function writeCar(path: string, value: unknown): Promise<CID> {
  const bytes = dagJson.encode(value);
  const root = CID.create(1, dagJson.code, await sha256.digest(bytes));
  const { writer, out } = CarWriter.create([root]);
  const chunks: Uint8Array[] = [];
  const done = (async () => {
    for await (const c of out) chunks.push(c);
  })();
  await writer.put({ cid: root, bytes });
  await writer.close();
  await done;
  write(path, Buffer.concat(chunks));
  return root;
}

interface Add {
  name: string;
  cid: string;
  returned: string;
  authorization: string | null;
}

interface Net {
  fetch: FetchLike;
  store: Map<string, Uint8Array>;
  adds: Add[];
  gets: string[];
}

interface NetOptions {
  addHash?: (name: string, cid: string) => string;
  serveOther?: (name: string) => boolean;
}

/** A fake Filebase: Kubo RPC `add` plus the gateway serving whatever was added. */
function fakeNetwork(opts: NetOptions = {}): Net {
  const store = new Map<string, Uint8Array>();
  const adds: Add[] = [];
  const gets: string[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    if ((init?.method ?? "GET") === "POST") {
      const form = init?.body;
      if (!(form instanceof FormData)) throw new Error("expected a FormData body");
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("expected a `file` field");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const cid = await cidOfBytes(bytes);
      const returned = opts.addHash?.(file.name, cid) ?? cid;
      store.set(cid, opts.serveOther?.(file.name) ? text("not the added bytes") : bytes);
      adds.push({
        name: file.name,
        cid,
        returned,
        authorization: new Headers(init?.headers ?? {}).get("authorization"),
      });
      const line = JSON.stringify({ Name: file.name, Hash: returned, Size: String(bytes.length) });
      return new Response(`${line}\n`, { status: 200 });
    }
    const cid = url.pathname.replace(/^\/ipfs\//, "");
    gets.push(url.href);
    const bytes = store.get(cid);
    return bytes ? new Response(bytes, { status: 200 }) : new Response("", { status: 404 });
  };
  return { fetch, store, adds, gets };
}

interface FakeCliOptions {
  failAt?: number;
  tamperPart?: boolean;
}

/** A fake elephant-cli writing real CARs and tables so the manifest can be built from them. */
function fakeCli(net: Net, opts: FakeCliOptions = {}): { run: CliRunner; calls: string[][] } {
  const calls: string[][] = [];
  const roots = new Map<string, string>();
  const ok = { code: 0, stdout: "", stderr: "" };
  const run: CliRunner = async (argv) => {
    const index = calls.length;
    calls.push(argv);
    if (index === opts.failAt) return { code: 1, stdout: "", stderr: "upload failed: 503" };
    const cmd = argv[0];
    const input = argv[1] as string;
    if (cmd === "validate") {
      write(arg(argv, "--output-csv"), "property_cid,file,error\n");
      return ok;
    }
    if (cmd === "hash") {
      const car = arg(argv, "--output-car");
      write(join(arg(argv, "--output-zip"), "100008.zip"), "zip");
      const root = await writeCar(car, { label: "CountyIndex", group: basename(input) });
      write(
        arg(argv, "--output-csv"),
        `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt\n${SEED},${COUNTY_DG},${root.toString()},x/${COUNTY_DG}.json,\n`,
      );
      roots.set(car, root.toString());
      return { ...ok, stdout: `CAR written: ${car} (1 blocks, root ${root.toString()})\n` };
    }
    if (cmd === "export-tables") {
      const out = arg(argv, "--output");
      const group = basename(out);
      const countyRoot = CID.parse(roots.get(input) as string);
      const names = ["property", "structure"];
      const tables: Record<string, unknown> = {};
      const summary: Record<string, { rows: number; parts: number }> = {};
      for (const [i, name] of names.entries()) {
        const bytes = text(`PAR1 ${group} ${name} ${i}`);
        write(join(out, name, "part-00000.parquet"), bytes);
        tables[name] = {
          rows: i + 1,
          parts: [{ cid: CID.parse(await cidOfBytes(bytes)), rows: i + 1, bytes: bytes.length }],
        };
        summary[name] = { rows: i + 1, parts: 1 };
      }
      const root = await writeCar(join(out, "tables.car"), {
        label: "CountyTables",
        version: 1,
        county_root: countyRoot,
        part_size_bytes: PART_SIZE_BYTES,
        codec: "zstd",
        tables,
      });
      write(
        arg(argv, "--output-json"),
        JSON.stringify({
          output: out,
          car: join(out, "tables.car"),
          root: root.toString(),
          countyRoot: countyRoot.toString(),
          partSizeBytes: PART_SIZE_BYTES,
          codec: "zstd",
          tables: summary,
          parts: names.length,
          exportedAt: "2026-10-21T15:30:00.000Z",
        }),
      );
      roots.set(out, root.toString());
      return {
        ...ok,
        stdout: `Tables written: ${out} (${names.length} tables, ${names.length} parts, root ${root.toString()})\n`,
      };
    }
    if (cmd === "upload") {
      const summary = arg(argv, "--output-json");
      const api = arg(argv, "--api");
      const gateway = arg(argv, "--gateway");
      const uploadedAt = "2026-10-21T16:10:00.000Z";
      if (input.endsWith(".car")) {
        const root = roots.get(input) as string;
        write(
          summary,
          JSON.stringify({
            api,
            root,
            blocks: 1,
            gatewayUrl: `${gateway}/ipfs/${root}`,
            uploadedAt,
          }),
        );
        return { ...ok, stdout: `Uploaded ${input} (root ${root})\n` };
      }
      const parts = (readdirSync(input, { recursive: true }) as string[])
        .map((f) => f.split(sep).join("/"))
        .filter((f) => f.endsWith(".parquet"))
        .sort();
      for (const part of parts) {
        const path = join(input, part);
        const bytes = readFileSync(path);
        const tampered = opts.tamperPart && part === "property/part-00000.parquet";
        net.store.set(await cidOfFile(path), tampered ? text("PAR1 county property X") : bytes);
      }
      const root = roots.get(input) as string;
      const runDir = dirname(dirname(input));
      const countyRoot = roots.get(join(runDir, "car", `travis-${basename(input)}.car`)) as string;
      write(
        summary,
        JSON.stringify({
          api,
          root,
          countyRoot,
          parts: parts.length,
          gatewayUrl: `${gateway}/ipfs/${root}`,
          uploadedAt,
        }),
      );
      return { ...ok, stdout: `Uploaded ${input} (root ${root})\n` };
    }
    return ok;
  };
  return { run, calls };
}

interface Setup {
  repoRoot: string;
  runDir: string;
  runsDir: string;
}

/** A run directory as run-month.ts leaves it: groups/, capture receipts and summary.json. */
function setup(): Setup {
  const repoRoot = mkdtempSync(join(tmpdir(), "repo-"));
  const runDir = join(repoRoot, "pipeline/data/runs", RUN_ID);
  for (const g of GROUPS) mkdirSync(join(runDir, "groups", g), { recursive: true });
  write(
    join(runDir, "capture/austin/receipts.jsonl"),
    ["A", "B", "C"]
      .map((p, i) =>
        JSON.stringify({
          url: `https://data.austintexas.gov/resource/3syk-w9eu.json?permit_number=${p}`,
          captured_at: `2026-10-21T14:00:0${i + 1}.000Z`,
          outcome: "ok",
        }),
      )
      .join("\n") + "\n",
  );
  write(
    join(runDir, "capture/tcad/receipt.json"),
    JSON.stringify({ captured_at: "2026-10-21T14:30:00.000Z", records: 2 }),
  );
  const summary = {
    runId: RUN_ID,
    county: { slug: "travis", state: "TX", fips: "48453" },
    startedAt: "2026-10-21T14:00:00.000Z",
    finishedAt: "2026-10-21T15:00:00.000Z",
    coverage: {},
    owners_redacted: 0,
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
        watermark: "2026-10-20T12:36:38.000Z",
        receipts: join(runDir, "capture/austin/receipts.jsonl"),
        limitations: ["one month of issue dates (2026-09); one GET per permit"],
      },
      {
        name: "tcad-2026-certified-json",
        url: "https://traviscad.org/publicinformation",
        watermark: `entry@sha256:${"d".repeat(64)}`,
        receipts: join(runDir, "capture/tcad/receipt.json"),
        limitations: ["subset: only the parcels the emitted permits point to (geoID = tcad_id)"],
      },
    ],
    profiles: [
      {
        name: "travis-austin",
        version: "1.0.0",
        sha256: "c".repeat(64),
        path: "profiles/travis-austin@1.0.0",
        gitCommit: "17c6cd8",
      },
    ],
    groups: { county: "groups/county" },
    limitations: ["finishedAt is the end of the capture phase (the data's as-of instant)"],
  };
  write(join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return { repoRoot, runDir, runsDir: join(repoRoot, "runs") };
}

function options(
  s: Setup,
  net: Net,
  cli: { run: CliRunner },
  extra: Partial<BatchPublishOptions> = {},
): BatchPublishOptions {
  return {
    runDir: s.runDir,
    runsDir: s.runsDir,
    repoRoot: s.repoRoot,
    env: { PATH: "/usr/bin", ...ENV },
    run: cli.run,
    fetch: net.fetch,
    sleep: async () => {},
    workTreeStatus: () => "",
    ...extra,
  };
}

describe("runBatchPublish: the non-interactive Fargate entrypoint (T029)", () => {
  it("never takes a D-8 approval: BatchPublishOptions has no `approved` field", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const opts = options(s, net, cli);
    expect(Object.keys(opts)).not.toContain("approved");
    const result = await runBatchPublish(opts);
    expect(result.ok).toBe(true);
  });

  it("runs the full 6-step-per-group sequence (build+upload, no approval split) then writes manifest and index", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const result = await runBatchPublish(options(s, net, cli));
    expect(result.failed).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.runId).toBe(RUN_ID);
    expect(cli.calls).toEqual(planPublish("travis", s.runDir, GROUPS).map((p) => p.argv));
    expect(result.sequence.ok).toBe(true);
    expect(result.sequence.phase).toBe("publish");

    expect(result.readback.map((r) => [r.group, r.ok])).toEqual([["county", true]]);
    expect(net.adds.map((a) => a.name)).toEqual([
      "travis-county.car",
      "tables.car",
      "manifest.json",
    ]);
    for (const a of result.carAdds) expect(a.cid).toBe(await cidOfFile(join(s.runDir, a.name)));

    const manifestPath = join(s.runsDir, RUN_ID, "manifest.json");
    expect(result.manifestPath).toBe(manifestPath);
    const bytes = readFileSync(manifestPath);
    expect(await cidOfBytes(bytes)).toBe(result.manifestCid);
    const manifest = RunManifestV1.parse(JSON.parse(bytes.toString("utf8")));
    expect(manifest.runId).toBe(RUN_ID);
    expect(manifest.previousManifestCid).toBeNull();

    const indexPath = join(s.runsDir, "index.json");
    const index = parseRunsIndex(readFileSync(indexPath));
    expect(RunsIndexV1.parse(index).runs).toEqual([
      { runId: RUN_ID, manifestCid: result.manifestCid, finishedAt: "2026-10-21T15:00:00.000Z" },
    ]);
  });

  it("chains to the last committed run's manifestCid when the index already has entries", async () => {
    const s = setup();
    const earlier = {
      runId: "travis-202608-permits-20260920t100000z",
      manifestCid: await cidOfBytes(text("an earlier manifest")),
      finishedAt: "2026-09-20T10:00:00.000Z",
    };
    write(join(s.runsDir, "index.json"), runsIndexBytes(appendRun(emptyRunsIndex(), earlier)));
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const result = await runBatchPublish(options(s, net, cli));
    expect(result.ok).toBe(true);
    const manifest = RunManifestV1.parse(
      JSON.parse(readFileSync(result.manifestPath as string, "utf8")),
    );
    expect(manifest.previousManifestCid).toBe(earlier.manifestCid);
    const index = parseRunsIndex(readFileSync(join(s.runsDir, "index.json")));
    expect(index.runs).toHaveLength(2);
    expect(JSON.stringify(index.runs[0])).toBe(JSON.stringify(earlier));
  });

  it("writes no manifest and no index entry when a part reads back with other bytes", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net, { tamperPart: true });
    const result = await runBatchPublish(options(s, net, cli));
    expect(result.ok).toBe(false);
    expect(result.failed?.stage).toBe("readback");
    expect(net.adds).toHaveLength(0);
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(false);
    expect(existsSync(join(s.runsDir, "index.json"))).toBe(false);
  });

  it("writes neither file when a .car add returns another CID", async () => {
    const s = setup();
    const other = await cidOfBytes(text("other"));
    const net = fakeNetwork({ addHash: (name, cid) => (name === "tables.car" ? other : cid) });
    const cli = fakeCli(net);
    const result = await runBatchPublish(options(s, net, cli));
    expect(result.ok).toBe(false);
    expect(result.failed?.stage).toBe("car-add");
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(false);
    expect(existsSync(join(s.runsDir, "index.json"))).toBe(false);
  });

  it("writes neither file when the manifest add does not return cidOfBytes", async () => {
    const s = setup();
    const other = await cidOfBytes(text("other"));
    const net = fakeNetwork({ addHash: (name, cid) => (name === "manifest.json" ? other : cid) });
    const cli = fakeCli(net);
    const result = await runBatchPublish(options(s, net, cli));
    expect(result.ok).toBe(false);
    expect(result.failed?.stage).toBe("manifest-add");
    expect(result.manifestCid).toBeUndefined();
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(false);
    expect(existsSync(join(s.runsDir, "index.json"))).toBe(false);
  });

  it("reads nothing back and adds nothing when a sequence step fails: no manifest, failed attempt not listed", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net, { failAt: 4 });
    const result = await runBatchPublish(options(s, net, cli));
    expect(result.ok).toBe(false);
    expect(result.failed?.stage).toBe("sequence");
    expect(net.adds).toHaveLength(0);
    expect(result.readback).toEqual([]);
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(false);
    expect(existsSync(join(s.runsDir, "index.json"))).toBe(false);
  });

  it("refuses a run already in the index before any CLI call", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const first = await runBatchPublish(options(s, net, cli));
    expect(first.ok).toBe(true);
    const manifestBefore = readFileSync(first.manifestPath as string);
    const again = fakeCli(net);
    await expect(runBatchPublish(options(s, net, again))).rejects.toThrow(RUN_ID);
    expect(again.calls).toHaveLength(0);
    expect(readFileSync(first.manifestPath as string).equals(manifestBefore)).toBe(true);
  });
});
