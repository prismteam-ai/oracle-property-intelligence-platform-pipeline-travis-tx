// T028: publishRun, the `upload` command's whole phase 2, against a fake CLI and a fake Kubo RPC:
// sequence (12 steps) → readback (roots by digest, part count, every part by size + SHA-256)
// → Kubo add of each .car (carCid) → manifest → manifest add (CID = cidOfBytes)
// → runs/<runId>/manifest.json + runs/index.json. Any mismatch leaves no manifest and no index.
// No network, no elephant-cli, no credential read from disk: the fake values below carry the
// real variable names only.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
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
import { COMPTROLLER_LIMITATION } from "../src/manifest.js";
import { emptyRunsIndex, appendRun, parseRunsIndex, runsIndexBytes } from "../src/runs-index.js";
import {
  PART_SIZE_BYTES,
  planPublish,
  planUpload,
  runBuild,
  type CliRunner,
  type DataGroup,
} from "../src/sequence.js";
import {
  PINATA_CLIENT,
  PINATA_GATEWAY,
  PreflightError,
  RunSummaryFile,
  addSecondPin,
  addToPin,
  bindBuild,
  inMemoryPinRegistry,
  loadRunSummary,
  publicFiles,
  publishRun,
} from "../src/upload.js";
import type { LocalBinder } from "../src/bind-guard.js";
import { PROFILE } from "../../../profiles/travis-austin@1.0.0/index.js";
import { PublicFilesListing, writePublicFiles } from "../src/approval.js";
import type { FetchLike } from "../src/kubo-add.js";

const RUN_ID = "travis-202609-permits-20261021t160000z";
const GROUPS: readonly DataGroup[] = ["county", "property_improvement"];
const SEED = "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu";
const COUNTY_DG = "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq";
/** Fake credentials with the real variable names; never the real values. */
const ENV = {
  FILEBASE_ACCESS_KEY: "FAKEACCESSKEY000",
  FILEBASE_SECRET_KEY: "fake-secret-key-value-xyz",
  FILEBASE_BUCKET: "countylens-fake",
};
const TOKEN = Buffer.from(
  `${ENV.FILEBASE_ACCESS_KEY}:${ENV.FILEBASE_SECRET_KEY}:${ENV.FILEBASE_BUCKET}`,
).toString("base64");
const SECRETS = [TOKEN, ENV.FILEBASE_SECRET_KEY, ENV.FILEBASE_ACCESS_KEY];

/** The commit summary.json records for the profile (profiles[].gitCommit) and the fake HEAD. */
const HEAD = "17c6cd8";

const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
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

/** The element at `i`, failing the test when it is absent. */
function at<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`no element at ${i}`);
  return v;
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
  bytes: Uint8Array;
  authorization: string | null;
  url: URL;
}

interface Net {
  fetch: FetchLike;
  /** Bytes the fake gateway serves, by CID (filled by the fake CLI's part adds and by `add`). */
  store: Map<string, Uint8Array>;
  adds: Add[];
  gets: string[];
  /** `GET <cid>` and `ADD <name>` in call order. */
  events: string[];
}

interface NetOptions {
  /** Rewrites the Hash `add` returns for one file (default: the local CID of its bytes). */
  addHash?: (name: string, cid: string) => string;
  /** Serve other bytes from the gateway for this add (a carCid readback mismatch). */
  serveOther?: (name: string) => boolean;
}

/** A fake Filebase: Kubo RPC `add` plus the gateway serving whatever was added. */
function fakeNetwork(opts: NetOptions = {}): Net {
  const store = new Map<string, Uint8Array>();
  const adds: Add[] = [];
  const gets: string[] = [];
  const events: string[] = [];
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
        bytes,
        authorization: new Headers(init?.headers ?? {}).get("authorization"),
        url,
      });
      events.push(`ADD ${file.name}`);
      const line = JSON.stringify({ Name: file.name, Hash: returned, Size: String(bytes.length) });
      return new Response(`${line}\n`, { status: 200 });
    }
    const cid = url.pathname.replace(/^\/ipfs\//, "");
    gets.push(url.href);
    events.push(`GET ${cid}`);
    const bytes = store.get(cid);
    return bytes ? new Response(bytes, { status: 200 }) : new Response("", { status: 404 });
  };
  return { fetch, store, adds, gets, events };
}

interface FakeCliOptions {
  /** Fail the call with this zero-based index. */
  failAt?: number;
  /** Serve other bytes for the county `property` part (a readback mismatch). */
  tamperPart?: boolean;
  /**
   * Replace the county `property` part on disk during the tables upload, after the approval
   * check, and serve the new bytes under their own CID (CR-A-03 F-5: local = served ≠ approved).
   */
  swapPartAfterApproval?: boolean;
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
      const names =
        group === "county" ? ["property", "structure"] : ["property", "property_improvement"];
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
      // The real CLI adds every part through Kubo: from here on the gateway serves them.
      const parts = (readdirSync(input, { recursive: true }) as string[])
        .map((f) => f.split(sep).join("/"))
        .filter((f) => f.endsWith(".parquet"))
        .sort();
      for (const part of parts) {
        const path = join(input, part);
        if (
          opts.swapPartAfterApproval &&
          basename(input) === "county" &&
          part === "property/part-00000.parquet"
        )
          writeFileSync(path, text("PAR1 county property swapped"));
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

interface SetupOptions {
  /** `null` leaves `owners_redacted` out of the summary. */
  ownersRedacted?: number | null;
  /** summary.json profiles[] (default: one travis-austin profile with a stand-in digest). */
  profiles?: Record<string, unknown>[];
}

/** A run directory as run-month.ts leaves it: groups/, capture receipts and summary.json. */
function setup(opts: SetupOptions = {}): Setup {
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
  const ownersRedacted = opts.ownersRedacted === undefined ? 1 : opts.ownersRedacted;
  const summary = {
    runId: RUN_ID,
    month: "2026-09",
    jobId: "austin-2026-09",
    county: { slug: "travis", state: "TX", fips: "48453" },
    startedAt: "2026-10-21T14:00:00.000Z",
    finishedAt: "2026-10-21T15:00:00.000Z",
    status: "ok",
    counts: { captured: 3, accepted: 3, excluded: 0, emitted: 2, no_tcad: 1 },
    excluded_by_reason: {},
    needs_review_by_reason: {},
    coverage: {
      permits_captured: { count: 3, derivation: "capture_receipt" },
      permits_emitted: { count: 2, derivation: "published_rows" },
      permits_no_tcad_geoid: { count: 1, derivation: "aggregate_match" },
      // CR-A-11-porygon finding 2: the other 4 permit-link `UnmatchedReason`s now required too.
      permits_no_tcad_id: { count: 0, derivation: "aggregate_match" },
      permits_ambiguous_geoid: { count: 0, derivation: "aggregate_match" },
      permits_address_unmatched: { count: 0, derivation: "aggregate_match" },
      permits_ambiguous_address: { count: 0, derivation: "aggregate_match" },
      // AD-05/AD-24 (A-11 fix): the three manifest-coverage buckets for contractor identity
      // (no lexicon carrier, ADR-0002 #6). This fixture's registry is unwired, so every
      // emitted permit is genuinely `unresolved` (resolver.ts step 2).
      contractor_resolved: { count: 0, derivation: "aggregate_match" },
      contractor_candidate: { count: 0, derivation: "aggregate_match" },
      contractor_unresolved: { count: 2, derivation: "aggregate_match" },
    },
    ...(ownersRedacted === null ? {} : { owners_redacted: ownersRedacted }),
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
        watermark: "2026-10-20T12:36:38.000Z",
        captured_at: "2026-10-21T14:00:03.000Z",
        records: 3,
        receipts: join(runDir, "capture/austin/receipts.jsonl"),
        limitations: ["one month of issue dates (2026-09); one GET per permit"],
      },
      {
        name: "tcad-2026-certified-json",
        url: "https://traviscad.org/publicinformation",
        watermark: `entry@sha256:${"d".repeat(64)}`,
        captured_at: "2026-10-21T14:30:00.000Z",
        records: 2,
        receipts: join(runDir, "capture/tcad/receipt.json"),
        limitations: ["subset: only the parcels the emitted permits point to (geoID = tcad_id)"],
      },
    ],
    profiles: opts.profiles ?? [
      {
        name: "travis-austin",
        version: "1.0.0",
        sha256: "c".repeat(64),
        path: "profiles/travis-austin@1.0.0",
        gitCommit: "17c6cd8",
      },
    ],
    groups: { county: "groups/county", property_improvement: "groups/property_improvement" },
    artifacts: {},
    limitations: ["finishedAt is the end of the capture phase (the data's as-of instant)"],
  };
  write(join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return { repoRoot, runDir, runsDir: join(repoRoot, "runs") };
}

/** The `build` command's library half: phase 1, then reports/public-files.json; its SHA-256. */
async function build(s: Setup, cli: { run: CliRunner }): Promise<string> {
  const report = await runBuild({
    county: "travis",
    runDir: s.runDir,
    groups: GROUPS,
    run: cli.run,
  });
  expect(report.ok).toBe(true);
  const written = await writePublicFiles({ runDir: s.runDir, runId: RUN_ID, report });
  expect(written.sha256).toBe(sha(readFileSync(join(s.runDir, "reports/public-files.json"))));
  return written.sha256;
}

/**
 * A fake local bind (the fake CLI's parts are not Parquet): it records BIND in the network's
 * event list and answers with the manifest's own run id, CID and permits_emitted.
 */
function fakeBind(net?: Net, seen?: Uint8Array[]): LocalBinder {
  return async ({ manifestBytes }) => {
    net?.events.push("BIND");
    seen?.push(manifestBytes);
    const m = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      runId: string;
      coverage: { permits_emitted: { count: number } };
    };
    const rows = m.coverage.permits_emitted.count;
    return {
      runId: m.runId,
      manifestCid: await cidOfBytes(manifestBytes),
      permitRows: rows,
      roofingPermitRows: rows,
      tables: 0,
    };
  };
}

/** The real travis-austin profile and no travis-places: what run-month wrote before F-1. */
const WITHOUT_PLACES = [
  {
    name: "travis-austin",
    version: PROFILE.version,
    sha256: PROFILE.sha256,
    path: "profiles/travis-austin@1.0.0",
    gitCommit: HEAD,
  },
];

/** publishRun of an approved build: the `upload` command's library half. */
function publishOnly(
  s: Setup,
  net: Net,
  cli: { run: CliRunner },
  approved: string,
  extra: Partial<Parameters<typeof publishRun>[0]> = {},
): ReturnType<typeof publishRun> {
  return publishRun({
    runDir: s.runDir,
    runsDir: s.runsDir,
    repoRoot: s.repoRoot,
    env: { PATH: "/usr/bin", ...ENV },
    approved,
    run: cli.run,
    fetch: net.fetch,
    sleep: async () => {},
    workTreeStatus: () => "",
    headCommit: () => HEAD,
    bind: fakeBind(net),
    ...extra,
  });
}

/** build, then publishRun with the SHA-256 of the public-files.json the build wrote. */
async function publish(
  s: Setup,
  net: Net,
  cli: { run: CliRunner },
  extra: Partial<Parameters<typeof publishRun>[0]> = {},
): ReturnType<typeof publishRun> {
  return publishOnly(s, net, cli, await build(s, cli), extra);
}

function expectNoSecret(path: string): void {
  const body = readFileSync(path, "utf8");
  for (const secret of SECRETS)
    expect(body, `${basename(path)} carries a secret`).not.toContain(secret);
}

describe("publishRun: sequence → readback → carCid adds → manifest → manifest add → runs/", () => {
  it("publishes both groups and writes the manifest and the index only after every check", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const result = await publish(s, net, cli);
    expect(result.failed).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.runId).toBe(RUN_ID);

    // 1. The 12-step order: the build's 8 steps, then (after the approval check) the 4 uploads.
    expect(cli.calls).toEqual(planPublish("travis", s.runDir, GROUPS).map((p) => p.argv));
    expect(result.sequence.ok).toBe(true);
    expect(result.sequence.phase).toBe("upload");

    // 2. Readback of every part from the Filebase gateway, before any add.
    expect(result.readback.map((r) => [r.group, r.ok, r.partCount])).toEqual([
      ["county", true, 2],
      ["property_improvement", true, 2],
    ]);
    const groups = result.sequence.groups;
    const partPaths = groups.flatMap((g) => publicFiles(g).filter((f) => f.endsWith(".parquet")));
    expect(partPaths).toHaveLength(4);
    const partCids = await Promise.all(partPaths.map((p) => cidOfFile(p)));
    // Two parts are in flight at a time, so the GET order within a group is not fixed.
    expect(net.gets.slice(0, 4).sort()).toEqual(
      partCids.map((c) => `https://ipfs.filebase.io/ipfs/${c}`).sort(),
    );
    const firstAdd = net.events.findIndex((e) => e.startsWith("ADD"));
    expect(firstAdd).toBe(4);
    expect(net.events.slice(0, 4).every((e) => e.startsWith("GET"))).toBe(true);

    // 3. Each .car (archive and tables.car) is added as a plain file; the Hash is the local CID.
    expect(net.adds.map((a) => a.name)).toEqual([
      "travis-county.car",
      "tables.car",
      "travis-property_improvement.car",
      "tables.car",
      "manifest.json",
    ]);
    for (const add of net.adds) {
      expect(add.authorization).toBe(`Bearer ${TOKEN}`);
      expect(add.url.pathname).toBe("/api/v0/add");
      expect(add.url.searchParams.get("cid-version")).toBe("1");
      expect(add.url.searchParams.get("raw-leaves")).toBe("true");
      expect(add.url.searchParams.get("pin")).toBe("true");
    }
    expect(result.carAdds.map((a) => [a.group, a.name])).toEqual([
      ["county", "car/travis-county.car"],
      ["county", "tables/county/tables.car"],
      ["property_improvement", "car/travis-property_improvement.car"],
      ["property_improvement", "tables/property_improvement/tables.car"],
    ]);
    for (const a of result.carAdds) expect(a.cid).toBe(await cidOfFile(join(s.runDir, a.name)));

    // 4. The manifest: exact JCS bytes, CID = cidOfBytes = the add's Hash, carCids all added.
    const manifestPath = join(s.runsDir, RUN_ID, "manifest.json");
    expect(result.manifestPath).toBe(manifestPath);
    const bytes = readFileSync(manifestPath);
    expect(bytes.at(-1)).not.toBe(0x0a);
    expect(await cidOfBytes(bytes)).toBe(result.manifestCid);
    expect(Buffer.from(at(net.adds, 4).bytes).equals(bytes)).toBe(true);
    expect(at(net.adds, 4).returned).toBe(result.manifestCid);
    const manifest = RunManifestV1.parse(JSON.parse(bytes.toString("utf8")));
    expect(manifest.runId).toBe(RUN_ID);
    expect(manifest.previousManifestCid).toBeNull();
    const added = new Set(result.carAdds.map((a) => a.cid));
    for (const a of manifest.artifacts.filter((x) => x.kind === "car" || x.kind === "directory"))
      expect(added.has(a.carCid as string), `${a.name} carCid was not added`).toBe(true);
    expect(manifest.sources[0]?.limitations).toContain(COMPTROLLER_LIMITATION);
    expect(manifest.sources[1]?.limitations).toContain(
      "Confidential owner records redacted (Texas Tax Code §25.025): 1",
    );
    expect(manifest.coverage.permits_emitted).toEqual({ count: 2, derivation: "published_rows" });

    // 5. The index: exact JCS bytes, the one run, ordered by finishedAt.
    const indexPath = join(s.runsDir, "index.json");
    expect(result.indexPath).toBe(indexPath);
    const indexBytes = readFileSync(indexPath);
    const index = parseRunsIndex(indexBytes);
    expect(indexBytes.equals(Buffer.from(runsIndexBytes(index)))).toBe(true);
    expect(RunsIndexV1.parse(index).runs).toEqual([
      { runId: RUN_ID, manifestCid: result.manifestCid, finishedAt: "2026-10-21T15:00:00.000Z" },
    ]);

    // 6. Reports without secrets.
    for (const name of [
      "sequence-build.json",
      "sequence-upload.json",
      "public-files.json",
      "readback.json",
      "publish.json",
    ])
      expectNoSecret(join(s.runDir, "reports", name));
    expectNoSecret(manifestPath);
    expectNoSecret(indexPath);
  });

  it("lists the files that go public for a group: the CAR, tables.car and every part", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const result = await publish(s, net, cli);
    const county = at(result.sequence.groups, 0);
    expect(publicFiles(county)).toEqual([
      join(s.runDir, "car/travis-county.car"),
      join(s.runDir, "tables/county/tables.car"),
      join(s.runDir, "tables/county/property/part-00000.parquet"),
      join(s.runDir, "tables/county/structure/part-00000.parquet"),
    ]);
  });

  it("writes no manifest and makes no add when a part reads back with other bytes", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net, { tamperPart: true });
    const result = await publish(s, net, cli);
    expect(result.ok).toBe(false);
    expect(result.failed?.stage).toBe("readback");
    expect(result.failed?.reason).toMatch(/county.*property\/part-00000\.parquet/);
    expect(result.readback[0]?.ok).toBe(false);
    expect(net.adds).toHaveLength(0);
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(false);
    expect(existsSync(join(s.runsDir, "index.json"))).toBe(false);
    expect(existsSync(join(s.runDir, "reports/readback.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(s.runDir, "reports/publish.json"), "utf8"))).toMatchObject({
      ok: false,
      failed: { stage: "readback" },
    });
  });

  it("stops at the first .car whose add returns another CID; no manifest", async () => {
    const s = setup();
    const other = await cidOfBytes(text("other"));
    const net = fakeNetwork({ addHash: (name, cid) => (name === "tables.car" ? other : cid) });
    const cli = fakeCli(net);
    const result = await publish(s, net, cli);
    expect(result.ok).toBe(false);
    expect(result.failed?.stage).toBe("car-add");
    expect(result.failed?.reason).toContain("tables/county/tables.car");
    expect(net.adds.map((a) => a.name)).toEqual(["travis-county.car", "tables.car"]);
    expect(result.carAdds).toHaveLength(1);
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(false);
    expect(existsSync(join(s.runsDir, "index.json"))).toBe(false);
  });

  it("writes neither file when the manifest add does not return cidOfBytes", async () => {
    const s = setup();
    const other = await cidOfBytes(text("other"));
    const net = fakeNetwork({ addHash: (name, cid) => (name === "manifest.json" ? other : cid) });
    const cli = fakeCli(net);
    const result = await publish(s, net, cli);
    expect(result.ok).toBe(false);
    expect(result.failed?.stage).toBe("manifest-add");
    expect(net.adds).toHaveLength(5);
    expect(result.manifestCid).toBeUndefined();
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(false);
    expect(existsSync(join(s.runsDir, "index.json"))).toBe(false);
  });

  it("reads nothing back and adds nothing when a sequence step fails", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net, { failAt: 9 });
    const result = await publish(s, net, cli);
    expect(result.ok).toBe(false);
    expect(result.failed).toMatchObject({ stage: "sequence" });
    expect(result.failed?.reason).toMatch(/county upload-tables/);
    expect(cli.calls).toHaveLength(10);
    expect(net.gets).toHaveLength(0);
    expect(net.adds).toHaveLength(0);
    expect(result.readback).toEqual([]);
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(false);
    expect(
      JSON.parse(readFileSync(join(s.runDir, "reports/sequence-upload.json"), "utf8")),
    ).toMatchObject({ ok: false, phase: "upload" });
  });

  it("appends to an existing index, keeps the earlier entry byte-identical and links the previous manifest", async () => {
    const s = setup();
    const earlier = {
      runId: "travis-202608-permits-20260920t100000z",
      manifestCid: await cidOfBytes(text("an earlier manifest")),
      finishedAt: "2026-09-20T10:00:00.000Z",
    };
    const before = runsIndexBytes(appendRun(emptyRunsIndex(), earlier));
    write(join(s.runsDir, "index.json"), before);
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const result = await publish(s, net, cli);
    expect(result.ok).toBe(true);
    const index = parseRunsIndex(readFileSync(join(s.runsDir, "index.json")));
    expect(index.runs).toHaveLength(2);
    expect(JSON.stringify(index.runs[0])).toBe(JSON.stringify(earlier));
    expect(index.runs[1]).toEqual({
      runId: RUN_ID,
      manifestCid: result.manifestCid,
      finishedAt: "2026-10-21T15:00:00.000Z",
    });
    const manifest = RunManifestV1.parse(
      JSON.parse(readFileSync(result.manifestPath as string, "utf8")),
    );
    expect(manifest.previousManifestCid).toBe(earlier.manifestCid);
  });

  it("refuses a run already in the index before any step, leaving the committed files alone", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const approved = await build(s, cli);
    const first = await publishOnly(s, net, cli, approved);
    expect(first.ok).toBe(true);
    const manifestBefore = readFileSync(first.manifestPath as string);
    const indexBefore = readFileSync(first.indexPath as string);
    const again = fakeCli(net);
    await expect(publishOnly(s, net, again, approved)).rejects.toThrow(RUN_ID);
    expect(again.calls).toHaveLength(0);
    expect(readFileSync(first.manifestPath as string).equals(manifestBefore)).toBe(true);
    expect(readFileSync(first.indexPath as string).equals(indexBefore)).toBe(true);
  });

  it("keeps the credentials in the child env: not in process.env, argv or any report", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    expect(process.env.FILEBASE_SECRET_KEY).toBeUndefined();
    const result = await publish(s, net, cli);
    expect(result.ok).toBe(true);
    expect(process.env.FILEBASE_SECRET_KEY).toBeUndefined();
    expect(process.env.FILEBASE_ACCESS_KEY).toBeUndefined();
    const flat = cli.calls.flat();
    for (const secret of SECRETS) expect(flat.some((a) => a.includes(secret))).toBe(false);
    for (const name of [
      "sequence-build.json",
      "sequence-upload.json",
      "readback.json",
      "publish.json",
    ])
      expectNoSecret(join(s.runDir, "reports", name));
    expect(JSON.stringify(result)).not.toContain(ENV.FILEBASE_SECRET_KEY);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("fails before the first CLI call when summary.json lacks owners_redacted (P0-15)", async () => {
    const s = setup({ ownersRedacted: null });
    const net = fakeNetwork();
    const approved = await build(s, fakeCli(net));
    const cli = fakeCli(net);
    await expect(publishOnly(s, net, cli, approved)).rejects.toThrow(/owners_redacted/);
    expect(cli.calls).toHaveLength(0);
    expect(net.adds).toHaveLength(0);
  });
});

describe("the run summary", () => {
  it("is read from summary.json with the fields the manifest needs", () => {
    const s = setup({ ownersRedacted: 3 });
    const summary = loadRunSummary(s.runDir);
    expect(summary.runId).toBe(RUN_ID);
    expect(summary.county).toEqual({ slug: "travis", state: "TX", fips: "48453" });
    expect(summary.owners_redacted).toBe(3);
    expect(summary.sources.map((x) => x.name)).toEqual([
      "austin-3syk-w9eu",
      "tcad-2026-certified-json",
    ]);
    expect(RunSummaryFile.safeParse({ ...summary, owners_redacted: -1 }).success).toBe(false);
    expect(RunSummaryFile.safeParse({ ...summary, runId: "travis-pilot" }).success).toBe(false);
  });

  it("digests are what the gateway must serve", async () => {
    const bytes = text("PAR1 county property 0");
    expect(sha(bytes)).toMatch(/^[a-f0-9]{64}$/);
  });
});

/** The CLI calls after the build's eight. */
const uploadCalls = (calls: string[][]): string[][] => calls.slice(8);

describe("the D-8 approval: build once, upload exactly the approved files (OR-1)", () => {
  it("writes sequence-build.json with every phase-1 step, exit code, roots and output size + SHA-256", async () => {
    const s = setup();
    const net = fakeNetwork();
    await build(s, fakeCli(net));
    const report = JSON.parse(readFileSync(join(s.runDir, "reports/sequence-build.json"), "utf8"));
    expect(report).toMatchObject({ ok: true, phase: "build" });
    expect(report.steps).toHaveLength(8);
    for (const step of report.steps) {
      expect(step.exitCode).toBe(0);
      expect(step.outputs.length).toBeGreaterThan(0);
      for (const o of step.outputs) {
        expect(typeof o.size).toBe("number");
        expect(o.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    }
    expect(report.steps.filter((x: { carRoot?: string }) => x.carRoot)).toHaveLength(2);
    expect(report.steps.filter((x: { tablesRoot?: string }) => x.tablesRoot)).toHaveLength(2);
    expect(existsSync(join(s.runDir, "reports/sequence.json"))).toBe(false);
  });

  it("writes public-files.json listing exactly the CARs, tables.car and every part, with size, SHA-256 and CID", async () => {
    const s = setup();
    const net = fakeNetwork();
    await build(s, fakeCli(net));
    const bytes = readFileSync(join(s.runDir, "reports/public-files.json"));
    const listing = PublicFilesListing.parse(JSON.parse(bytes.toString("utf8")));
    const files = listing.groups.flatMap((g) => g.files);
    expect(files.map((f) => f.path)).toEqual([
      "car/travis-county.car",
      "tables/county/tables.car",
      "tables/county/property/part-00000.parquet",
      "tables/county/structure/part-00000.parquet",
      "car/travis-property_improvement.car",
      "tables/property_improvement/tables.car",
      "tables/property_improvement/property/part-00000.parquet",
      "tables/property_improvement/property_improvement/part-00000.parquet",
    ]);
    for (const f of files) {
      const body = readFileSync(join(s.runDir, f.path));
      expect(f.size).toBe(body.length);
      expect(f.sha256).toBe(sha(body));
      expect(f.cid).toBe(await cidOfBytes(body));
    }
    expect(listing.totalFiles).toBe(8);
    expect(listing.totalBytes).toBe(files.reduce((n, f) => n + f.size, 0));
    const buildReport = readFileSync(join(s.runDir, "reports/sequence-build.json"));
    expect(listing.buildReport).toEqual({
      path: "reports/sequence-build.json",
      sha256: sha(buildReport),
    });
    const parsed = JSON.parse(buildReport.toString("utf8"));
    expect(listing.groups.map((g) => [g.group, g.carRoot, g.tablesRoot])).toEqual(
      parsed.groups.map((g: { group: string; carRoot: string; tablesRoot: string }) => [
        g.group,
        g.carRoot,
        g.tablesRoot,
      ]),
    );
  });

  it("uploads the approved build without re-running phase 1 and never rewrites sequence-build.json", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const approved = await build(s, cli);
    const buildBefore = readFileSync(join(s.runDir, "reports/sequence-build.json"));
    const result = await publishOnly(s, net, cli, approved);
    expect(result.ok).toBe(true);
    expect(uploadCalls(cli.calls)).toEqual(
      planUpload("travis", s.runDir, GROUPS).map((p) => p.argv),
    );
    expect(uploadCalls(cli.calls).every((c) => c[0] === "upload")).toBe(true);
    expect(readFileSync(join(s.runDir, "reports/sequence-build.json")).equals(buildBefore)).toBe(
      true,
    );
    const upload = JSON.parse(readFileSync(join(s.runDir, "reports/sequence-upload.json"), "utf8"));
    expect(upload).toMatchObject({ ok: true, phase: "upload" });
    expect(upload.steps.map((x: { step: string }) => x.step)).toEqual([
      "upload-car",
      "upload-tables",
      "upload-car",
      "upload-tables",
    ]);
    const listing = PublicFilesListing.parse(
      JSON.parse(readFileSync(join(s.runDir, "reports/public-files.json"), "utf8")),
    );
    expect(result.approval).toEqual({
      publicFilesSha256: approved,
      files: 8,
      bytes: listing.totalBytes,
    });
  });

  it("refuses an approval that is not the SHA-256 of public-files.json, before the first upload step", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const approved = await build(s, cli);
    const wrong = "0".repeat(64);
    const attempt = publishOnly(s, net, cli, wrong);
    await expect(attempt).rejects.toMatchObject({ name: "ApprovalError" });
    await expect(publishOnly(s, net, cli, wrong)).rejects.toThrow(
      `reports/public-files.json has sha256 ${approved}, not the approved ${wrong}`,
    );
    await expect(publishOnly(s, net, cli, "")).rejects.toMatchObject({ name: "ApprovalError" });
    expect(uploadCalls(cli.calls)).toHaveLength(0);
    expect(net.adds).toHaveLength(0);
    expect(net.gets).toHaveLength(0);
  });

  it("refuses when no build exists for the run: run build first", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    await expect(publishOnly(s, net, cli, "a".repeat(64))).rejects.toThrow(/run build first/);
    expect(cli.calls).toHaveLength(0);
  });

  it("refuses with BuildDriftError naming a part whose bytes changed after the approval", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const approved = await build(s, cli);
    write(join(s.runDir, "tables/county/property/part-00000.parquet"), "PAR1 changed after D-8");
    const attempt = publishOnly(s, net, cli, approved);
    await expect(attempt).rejects.toMatchObject({ name: "BuildDriftError" });
    await expect(publishOnly(s, net, cli, approved)).rejects.toThrow(
      "tables/county/property/part-00000.parquet",
    );
    expect(uploadCalls(cli.calls)).toHaveLength(0);
    expect(net.adds).toHaveLength(0);
  });

  it("refuses with BuildDriftError a public file the approval does not list", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const approved = await build(s, cli);
    write(join(s.runDir, "tables/county/extra/part-00000.parquet"), "PAR1 extra");
    await expect(publishOnly(s, net, cli, approved)).rejects.toThrow(
      /tables\/county\/extra\/part-00000\.parquet (appeared|is not in the approved)/,
    );
    await expect(publishOnly(s, net, cli, approved)).rejects.toMatchObject({
      name: "BuildDriftError",
    });
    expect(uploadCalls(cli.calls)).toHaveLength(0);
  });

  it("refuses with BuildDriftError when sequence-build.json (its roots) changed after the approval", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const approved = await build(s, cli);
    const path = join(s.runDir, "reports/sequence-build.json");
    const report = JSON.parse(readFileSync(path, "utf8"));
    report.groups[0].carRoot = report.groups[1].carRoot;
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    await expect(publishOnly(s, net, cli, approved)).rejects.toMatchObject({
      name: "BuildDriftError",
    });
    await expect(publishOnly(s, net, cli, approved)).rejects.toThrow("reports/sequence-build.json");
    expect(uploadCalls(cli.calls)).toHaveLength(0);
  });

  it("refuses with BuildDriftError a CAR swapped after the approval, even with the listing re-stamped to it", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    await build(s, cli);
    // Another CAR in place of the county archive, with the listing re-stamped to its bytes:
    // size and SHA-256 agree with the listing, but its root is not the build's printed root.
    const car = join(s.runDir, "car/travis-county.car");
    await writeCar(car, { label: "CountyIndex", group: "something else" });
    const listingPath = join(s.runDir, "reports/public-files.json");
    const listing = PublicFilesListing.parse(JSON.parse(readFileSync(listingPath, "utf8")));
    const body = readFileSync(car);
    const entry = listing.groups[0]?.files[0];
    if (entry === undefined) throw new Error("no county car entry");
    entry.size = body.length;
    entry.sha256 = sha(body);
    entry.cid = await cidOfBytes(body);
    listing.totalBytes = listing.groups.flatMap((g) => g.files).reduce((n, f) => n + f.size, 0);
    writeFileSync(listingPath, `${JSON.stringify(listing, null, 2)}\n`);
    const approved = sha(readFileSync(listingPath));
    await expect(publishOnly(s, net, cli, approved)).rejects.toMatchObject({
      name: "BuildDriftError",
    });
    expect(uploadCalls(cli.calls)).toHaveLength(0);
  });
});

describe("carCid readback (OR-4)", () => {
  it("reads every .car add back from the Filebase gateway by size and SHA-256, after its add", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const result = await publish(s, net, cli);
    expect(result.ok).toBe(true);
    for (const a of result.carAdds) {
      const add = net.events.indexOf(`ADD ${basename(a.name)}`);
      expect(add).toBeGreaterThanOrEqual(0);
      expect(net.gets).toContain(`https://ipfs.filebase.io/ipfs/${a.cid}`);
      expect(a.readback).toEqual({
        size: readFileSync(join(s.runDir, a.name)).length,
        sha256: sha(readFileSync(join(s.runDir, a.name))),
        ok: true,
      });
    }
    const manifestAdd = net.events.indexOf("ADD manifest.json");
    const lastCarGet = Math.max(
      ...result.carAdds.map((a) => net.events.lastIndexOf(`GET ${a.cid}`)),
    );
    expect(lastCarGet).toBeLessThan(manifestAdd);
  });

  it("writes no manifest when the gateway serves other bytes for a carCid", async () => {
    const s = setup();
    const net = fakeNetwork({ serveOther: (name) => name === "tables.car" });
    const cli = fakeCli(net);
    const result = await publish(s, net, cli);
    expect(result.ok).toBe(false);
    expect(result.failed?.stage).toBe("car-readback");
    expect(result.failed?.reason).toContain("tables/county/tables.car");
    expect(net.adds.map((a) => a.name)).not.toContain("manifest.json");
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(false);
    expect(existsSync(join(s.runsDir, "index.json"))).toBe(false);
  });
});

describe("Filebase credentials fail closed (OR-8)", () => {
  it("refuses a stray IPFS_API_TOKEN before any upload, even with the three FILEBASE_* names", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const approved = await build(s, cli);
    await expect(
      publishOnly(s, net, cli, approved, {
        env: { ...ENV, IPFS_API_TOKEN: "fake-stray-bearer" },
      }),
    ).rejects.toThrow(/IPFS_API_TOKEN/);
    expect(uploadCalls(cli.calls)).toHaveLength(0);
    expect(net.adds).toHaveLength(0);
  });

  it("does not let IPFS_API_TOKEN mask a missing FILEBASE_* name", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const approved = await build(s, cli);
    await expect(
      publishOnly(s, net, cli, approved, {
        env: { FILEBASE_ACCESS_KEY: ENV.FILEBASE_ACCESS_KEY, IPFS_API_TOKEN: "fake-stray-bearer" },
      }),
    ).rejects.toThrow(/FILEBASE_SECRET_KEY, FILEBASE_BUCKET/);
    expect(uploadCalls(cli.calls)).toHaveLength(0);
  });
});

describe("preflight before the first network write (OR-14)", () => {
  it("refuses a dirty working tree before any upload: zero upload calls, no add, no manifest", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const approved = await build(s, cli);
    const error = await publishOnly(s, net, cli, approved, {
      workTreeStatus: () => " M pipeline/publish/src/upload.ts\n",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PreflightError);
    expect(error).toMatchObject({ check: "work-tree" });
    expect((error as Error).message).toMatch(/working tree is dirty/);
    expect((error as Error).message).toContain("pipeline/publish/src/upload.ts");
    expect(uploadCalls(cli.calls)).toHaveLength(0);
    expect(net.adds).toHaveLength(0);
    expect(net.gets).toHaveLength(0);
    expect(existsSync(join(s.runDir, "reports/sequence-upload.json"))).toBe(false);
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(false);
    expect(existsSync(join(s.runsDir, "index.json"))).toBe(false);
  });

  it("refuses a build whose recorded gitCommit is not HEAD, naming both commits, before any upload", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const approved = await build(s, cli);
    const head = "9f0e1d2c3b4a59687766554433221100ffeeddcc";
    const error = await publishOnly(s, net, cli, approved, { headCommit: () => head }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PreflightError);
    expect(error).toMatchObject({ check: "commit" });
    expect((error as Error).message).toContain(HEAD);
    expect((error as Error).message).toContain(head);
    expect(uploadCalls(cli.calls)).toHaveLength(0);
    expect(net.adds).toHaveLength(0);
    expect(net.gets).toHaveLength(0);
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(false);
  });

  it("refuses incomplete Filebase credentials before any upload, naming the variables only", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const approved = await build(s, cli);
    const error = await publishOnly(s, net, cli, approved, {
      env: { FILEBASE_ACCESS_KEY: ENV.FILEBASE_ACCESS_KEY },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PreflightError);
    expect(error).toMatchObject({ check: "filebase-env" });
    expect((error as Error).message).toMatch(/FILEBASE_SECRET_KEY, FILEBASE_BUCKET/);
    expect((error as Error).message).not.toContain(ENV.FILEBASE_ACCESS_KEY);
    expect(uploadCalls(cli.calls)).toHaveLength(0);
    expect(net.adds).toHaveLength(0);
  });

  it("proceeds as before on a clean tree whose HEAD is the recorded commit", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const result = await publish(s, net, cli, { workTreeStatus: () => "", headCommit: () => HEAD });
    expect(result.ok).toBe(true);
    expect(uploadCalls(cli.calls).length).toBeGreaterThan(0);
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(true);
  });
});

describe("the bind guard before the manifest add (CR-A-03 F-1)", () => {
  it("binds the built manifest after the carCid adds and before the manifest add, with its exact bytes", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const seen: Uint8Array[] = [];
    const result = await publish(s, net, cli, { bind: fakeBind(net, seen) });
    expect(result.ok).toBe(true);
    const bind = net.events.indexOf("BIND");
    expect(bind).toBeGreaterThan(net.events.lastIndexOf("ADD tables.car"));
    expect(bind).toBeLessThan(net.events.indexOf("ADD manifest.json"));
    expect(seen).toHaveLength(1);
    expect(await cidOfBytes(at(seen, 0))).toBe(result.manifestCid);
    expect(result.bind).toMatchObject({ permitRows: 2, manifestCid: result.manifestCid });
  });

  // bind-manifest.ts (packages/query-core) now degrades gracefully on a missing travis-places
  // profile (places/business out of scope, e.g. A-07 Track C / Run 1): that is missing data, not
  // a binding failure, so bind-guard must not refuse it either. The real binder's row-level
  // behavior for this case (meta.zcta_area stays empty, permit rows unaffected) is proven against
  // genuine parquet in bind-guard.test.ts; here (fakeCli's table parts are stub text, never real
  // parquet) the orchestration is proven with the fake bind: a missing-but-otherwise-valid
  // manifest builds and publishes like any other.
  it("publishes a manifest without travis-places (places/business out of scope): no BindGuardError", async () => {
    const s = setup({ profiles: WITHOUT_PLACES });
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const result = await publish(s, net, cli, { bind: fakeBind(net) });
    expect(result.ok).toBe(true);
    expect(net.adds.filter((a) => a.name === "manifest.json")).toHaveLength(1);
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(true);
    expect(existsSync(join(s.runsDir, "index.json"))).toBe(true);
  });

  it("refuses a bound row count that is not permits_emitted: no manifest add", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const short: LocalBinder = async (input) => ({
      ...(await fakeBind()(input)),
      permitRows: 1,
      roofingPermitRows: 1,
    });
    const result = await publish(s, net, cli, { bind: short });
    expect(result.failed?.stage).toBe("bind");
    expect(result.failed?.reason).toMatch(/1 roofing permit rows.*permits_emitted 2/);
    expect(net.adds.filter((a) => a.name === "manifest.json")).toHaveLength(0);
    expect(existsSync(join(s.runsDir, "index.json"))).toBe(false);
  });
});

describe("bindBuild: the bind step at the end of `build` (CR-A-03 F-1)", () => {
  it("binds the draft manifest of a finished build and reports the rows", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    await build(s, cli);
    const bound = await bindBuild({
      runDir: s.runDir,
      runsDir: s.runsDir,
      repoRoot: s.repoRoot,
      bind: fakeBind(),
    });
    expect(bound).toMatchObject({ runId: RUN_ID, permitRows: 2, roofingPermitRows: 2 });
  });

  it("binds a build whose manifest lacks travis-places (places/business out of scope): no BindGuardError", async () => {
    const s = setup({ profiles: WITHOUT_PLACES });
    const net = fakeNetwork();
    const cli = fakeCli(net);
    await build(s, cli);
    const bound = await bindBuild({
      runDir: s.runDir,
      runsDir: s.runsDir,
      repoRoot: s.repoRoot,
      bind: fakeBind(),
    });
    expect(bound).toMatchObject({ runId: RUN_ID, permitRows: 2, roofingPermitRows: 2 });
    expect(net.adds).toHaveLength(0);
  });
});

describe("readback against the approved digests (CR-A-03 F-5)", () => {
  it("fails a part changed on disk after the approval even when the gateway serves the changed bytes", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net, { swapPartAfterApproval: true });
    const result = await publish(s, net, cli);
    expect(result.ok).toBe(false);
    expect(result.failed?.stage).toBe("readback");
    expect(result.failed?.reason).toMatch(/property\/part-00000\.parquet.*approved/);
    expect(net.adds).toHaveLength(0);
    expect(existsSync(join(s.runsDir, "index.json"))).toBe(false);
  });

  it("reads each part back by its approved CID and records the approved SHA-256", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const approved = await build(s, cli);
    const listing = PublicFilesListing.parse(
      JSON.parse(readFileSync(join(s.runDir, "reports/public-files.json"), "utf8")),
    );
    const result = await publishOnly(s, net, cli, approved);
    expect(result.ok).toBe(true);
    const approvedParts = listing.groups
      .flatMap((g) => g.files)
      .filter((f) => f.path.endsWith(".parquet"));
    const readParts = result.readback.flatMap((r) => r.parts);
    expect(readParts.map((p) => [p.cid, p.sha256]).sort()).toEqual(
      approvedParts.map((f) => [f.cid, f.sha256]).sort(),
    );
  });
});

// T008: the second-pin client (Pinata, sibling to the Filebase client above). No network: a fake
// Kubo RPC `add` plus the gateway it would serve from. Readback is required before success, and
// an artifact already recorded under a name with different bytes is never silently overwritten.
describe("the second pin (Pinata, Kubo-RPC-compatible; T008, AD-22)", () => {
  interface PinataNet {
    fetch: FetchLike;
    store: Map<string, Uint8Array>;
    posts: { authorization: string | null; name: string; cid: string }[];
    gets: string[];
  }

  function fakePinataNetwork(opts: { serveOther?: boolean } = {}): PinataNet {
    const store = new Map<string, Uint8Array>();
    const posts: PinataNet["posts"] = [];
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
        store.set(cid, bytes);
        posts.push({
          authorization: new Headers(init?.headers ?? {}).get("authorization"),
          name: file.name,
          cid,
        });
        const line = JSON.stringify({ Name: file.name, Hash: cid, Size: String(bytes.length) });
        return new Response(`${line}\n`, { status: 200 });
      }
      gets.push(url.href);
      const cid = url.pathname.replace(/^\/ipfs\//, "");
      const bytes = store.get(cid);
      if (opts.serveOther && bytes)
        return new Response(text("tampered bytes from the gateway"), { status: 200 });
      return bytes ? new Response(bytes, { status: 200 }) : new Response("", { status: 404 });
    };
    return { fetch, store, posts, gets };
  }

  const PINATA_ENV = { PINATA_JWT: "fake-pinata-jwt-value" };

  it("refuses up front when PINATA_JWT is missing, naming the variable only", async () => {
    const net = fakePinataNetwork();
    const file = join(mkdtempSync(join(tmpdir(), "pin-")), "a.car");
    write(file, "car bytes");
    await expect(
      addToPin(PINATA_CLIENT, { path: file }, await cidOfFile(file), { env: {}, fetch: net.fetch }),
    ).rejects.toThrow(/pinata add refused: missing PINATA_JWT/);
    expect(net.posts).toHaveLength(0);
  });

  it("adds through Kubo RPC with a Bearer PINATA_JWT, then requires a gateway readback match before success", async () => {
    const net = fakePinataNetwork();
    const file = join(mkdtempSync(join(tmpdir(), "pin-")), "travis-county.car");
    write(file, "county car bytes");
    const cid = await cidOfFile(file);
    const result = await addToPin(PINATA_CLIENT, { path: file }, cid, {
      env: PINATA_ENV,
      fetch: net.fetch,
    });
    expect(result).toMatchObject({ client: "pinata", name: "travis-county.car", cid });
    expect(result.readback.ok).toBe(true);
    expect(net.posts[0]?.authorization).toBe(`Bearer ${PINATA_ENV.PINATA_JWT}`);
    expect(net.gets).toContain(`${PINATA_GATEWAY}/ipfs/${cid}`);
  });

  it("never reports success when the gateway readback does not match the added bytes", async () => {
    const net = fakePinataNetwork({ serveOther: true });
    const file = join(mkdtempSync(join(tmpdir(), "pin-")), "tables.car");
    write(file, "tables car bytes");
    const cid = await cidOfFile(file);
    await expect(
      addToPin(PINATA_CLIENT, { path: file }, cid, { env: PINATA_ENV, fetch: net.fetch }),
    ).rejects.toThrow(/readback failed after add/);
  });

  it("refuses to overwrite an already-pinned name with different bytes; compares instead of replacing", async () => {
    const net = fakePinataNetwork();
    const registry = inMemoryPinRegistry();
    await registry.set("pinata", "travis-county.car", {
      cid: "bafkreiexampleOTHERcidxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      size: 999,
      sha256: "f".repeat(64),
    });
    const file = join(mkdtempSync(join(tmpdir(), "pin-")), "travis-county.car");
    write(file, "new county car bytes");
    const cid = await cidOfFile(file);
    await expect(
      addToPin(PINATA_CLIENT, { path: file }, cid, { env: PINATA_ENV, fetch: net.fetch, registry }),
    ).rejects.toThrow(/refusing to overwrite it.*pins are immutable by name/s);
    expect(net.posts).toHaveLength(0);
  });

  it("is idempotent: the same name/cid already recorded skips the add, but still readback-gates success", async () => {
    const net = fakePinataNetwork();
    const registry = inMemoryPinRegistry();
    const file = join(mkdtempSync(join(tmpdir(), "pin-")), "travis-county.car");
    write(file, "stable county car bytes");
    const cid = await cidOfFile(file);
    const sha256 = sha(readFileSync(file));
    net.store.set(cid, readFileSync(file));
    await registry.set("pinata", "travis-county.car", { cid, size: statSync(file).size, sha256 });
    const result = await addToPin(PINATA_CLIENT, { path: file }, cid, {
      env: PINATA_ENV,
      fetch: net.fetch,
      registry,
    });
    expect(net.posts).toHaveLength(0);
    expect(result.readback.ok).toBe(true);
  });

  it("adds the manifest's own bytes the same way, by name and expected CID", async () => {
    const net = fakePinataNetwork();
    const bytes = text("manifest bytes for the second pin");
    const cid = await cidOfBytes(bytes);
    const result = await addToPin(PINATA_CLIENT, { bytes, name: "manifest.json" }, cid, {
      env: PINATA_ENV,
      fetch: net.fetch,
    });
    expect(result.cid).toBe(cid);
    expect(result.readback.ok).toBe(true);
  });

  it("addSecondPin adds every carAdd then the manifest, in order, to the default (Pinata) client", async () => {
    const net = fakePinataNetwork();
    const s = setup();
    const carPath = "car/travis-county.car";
    write(join(s.runDir, carPath), "county car for second pin");
    const carCid = await cidOfFile(join(s.runDir, carPath));
    write(join(s.runsDir, RUN_ID, "manifest.json"), "manifest bytes for second pin");
    const manifestPath = join(s.runsDir, RUN_ID, "manifest.json");
    const added = await addSecondPin(
      { carAdds: [{ group: "county", name: carPath, cid: carCid, size: 0 }], manifestPath },
      s.runDir,
      { env: PINATA_ENV, fetch: net.fetch },
    );
    expect(added.map((a) => a.name)).toEqual([basename(carPath), "manifest.json"]);
    expect(added.every((a) => a.readback.ok)).toBe(true);
    expect(net.posts.map((p) => p.name)).toEqual(["travis-county.car", "manifest.json"]);
  });
});
