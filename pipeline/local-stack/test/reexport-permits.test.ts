// A-11: the resumable permits re-export (scripts/reexport-permits.ts). No DB, no network: the
// writer and the DB digests are injected.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CODE_FILES,
  PROFILE_DIR,
  codeHashOf,
  compareRun,
  fingerprintOf,
  layoutFor,
  parsePids,
  runReexport,
  type ReexportDeps,
} from "../scripts/reexport-permits.js";

const CIDS = { seed: "bafkseed", propertyImprovement: "bafkpi" };
const PIDS = Array.from({ length: 12 }, (_, i) => String(100 + i)); // 100..111
const isEmptyPid = (p: string) => p.endsWith("5"); // 105 emits nothing

const roots: string[] = [];
const tmpRun = () => {
  const d = mkdtempSync(join(tmpdir(), "reexport-"));
  roots.push(d);
  return d;
};
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** Every file under dir -> content, relative paths, for byte comparison. */
function snapshot(
  dir: string,
  base = dir,
  out: Record<string, string> = {},
): Record<string, string> {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) snapshot(p, base, out);
    else out[p.slice(base.length)] = readFileSync(p, "utf8");
  }
  return out;
}

function makeDeps(
  opts: { version?: string; failOnCall?: number; digest?: (p: string) => string } = {},
) {
  const calls: string[][] = [];
  const deps: ReexportDeps = {
    codeHash: opts.version ?? "code-v1",
    cidsKey: "cids",
    dbDigests: async (pids) => new Map(pids.map((p) => [p, opts.digest?.(p) ?? `db-${p}`])),
    writeChunk: async (pids, out) => {
      calls.push([...pids]);
      let wrote = 0;
      for (const p of pids) {
        if (isEmptyPid(p)) continue;
        const d = join(out, p, "data");
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, "property_improvement_1.json"), `permit ${p}`);
        writeFileSync(join(d, "address.json"), `addr ${p} ${opts.version ?? "code-v1"}`);
        wrote += 1;
        if (opts.failOnCall === calls.length && wrote === 2) throw new Error("killed mid-chunk");
      }
    },
  };
  return { deps, calls };
}

const opts = (run: string, pids = PIDS, concurrency = 2) => ({
  ...layoutFor(run),
  pids,
  chunk: 4,
  concurrency,
});

describe("parsePids", () => {
  it("dedupes, sorts numerically and rejects non-pIDs", () => {
    expect(parsePids("12\n3\n\n12\n")).toEqual(["3", "12"]);
    expect(() => parsePids("../x")).toThrow(/invalid pID/);
  });
});

describe("runReexport run lock", () => {
  const lockOf = (run: string) => `${layoutFor(run).stateDir}.lock`;

  it("refuses to start while a live process holds the lock, and touches nothing", async () => {
    const run = tmpRun();
    mkdirSync(run, { recursive: true });
    writeFileSync(lockOf(run), `${process.pid}\n`); // this test process is alive
    const { deps, calls } = makeDeps();
    await expect(runReexport(opts(run), deps)).rejects.toThrow(/held by running pid/);
    expect(calls).toEqual([]);
    expect(readdirSync(run)).toEqual(["reexport-state.lock"]);
    expect(readFileSync(lockOf(run), "utf8").trim()).toBe(String(process.pid));
  });

  it("takes over a stale lock whose pid is gone, and releases its own lock after the run", async () => {
    const run = tmpRun();
    mkdirSync(run, { recursive: true });
    const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
      encoding: "utf8",
    }).stdout;
    writeFileSync(lockOf(run), `${dead}\n`);
    const { deps } = makeDeps();
    const s = await runReexport(opts(run), deps);
    expect(s.failed).toBeNull();
    expect(existsSync(lockOf(run))).toBe(false);
  });

  it("releases the lock when the run throws", async () => {
    const run = tmpRun();
    const { deps } = makeDeps();
    deps.dbDigests = async () => {
      throw new Error("db down");
    };
    const s = await runReexport(opts(run), deps);
    expect(s.failed).toMatch(/db down/);
    expect(existsSync(lockOf(run))).toBe(false);
  });
});

describe("runReexport", () => {
  it("writes folders, treats no-emit pIDs as empty, and keeps markers outside the group dir", async () => {
    const run = tmpRun();
    const { deps } = makeDeps();
    const s = await runReexport(opts(run), deps);
    expect(s).toMatchObject({
      total: 12,
      done: 12,
      reused: 0,
      redone: 0,
      empty: 1,
      foldersWritten: 11,
      permitFiles: 11,
      failed: null,
    });
    const l = layoutFor(run);
    expect(readdirSync(l.groupDir)).not.toContain("105");
    for (const f of Object.keys(snapshot(l.groupDir)))
      expect(f).toMatch(/^\/\d+\/data\/[a-z_0-9]+\.json$/);
    expect(readdirSync(l.stateDir)).toHaveLength(12);
    expect(readdirSync(run).sort()).toEqual(["groups", "reexport-state"]); // tmp cleaned up
  });

  it("kill mid-run then resume gives a directory byte-identical to a clean run", async () => {
    const clean = tmpRun();
    await runReexport(opts(clean), makeDeps().deps);

    const run = tmpRun();
    const first = await runReexport(opts(run, PIDS, 1), makeDeps({ failOnCall: 2 }).deps);
    expect(first.failed).toMatch(/killed mid-chunk/);
    // chunk 1 is committed, the half-written chunk 2 never shows up in the group dir
    expect(readdirSync(layoutFor(run).groupDir).sort()).toEqual(["100", "101", "102", "103"]);

    const { deps, calls } = makeDeps();
    const second = await runReexport(opts(run), deps);
    expect(second.failed).toBeNull();
    expect(second.reused).toBe(4);
    expect(calls.flat()).not.toContain("100");
    expect(snapshot(layoutFor(run).groupDir)).toEqual(snapshot(layoutFor(clean).groupDir));
  });

  it("reuses everything on a second run with the same fingerprints (pilot then full)", async () => {
    const run = tmpRun();
    const pilot = PIDS.slice(0, 4);
    await runReexport(opts(run, pilot), makeDeps().deps);
    const { deps, calls } = makeDeps();
    const full = await runReexport(opts(run, PIDS), deps);
    expect(calls.flat().sort()).toEqual(PIDS.slice(4).sort()); // pilot pIDs not rewritten
    expect(full.reused).toBe(4);
    expect(full.done).toBe(8);

    const again = makeDeps();
    const third = await runReexport(opts(run, PIDS), again.deps);
    expect(again.calls).toHaveLength(0);
    expect(third).toMatchObject({ reused: 12, done: 0, redone: 0, empty: 1, foldersWritten: 0 });
  });

  it("redoes only the pIDs whose fingerprint changed; a code change redoes all", async () => {
    const run = tmpRun();
    await runReexport(opts(run), makeDeps().deps);
    const one = makeDeps({ digest: (p) => (p === "107" ? "db-changed" : `db-${p}`) });
    const s = await runReexport(opts(run), one.deps);
    expect(one.calls.flat()).toEqual(["107"]);
    expect(s).toMatchObject({ redone: 1, reused: 11 });

    const code = makeDeps({ version: "code-v2" });
    const s2 = await runReexport(opts(run), code.deps);
    expect(s2).toMatchObject({ redone: 12, reused: 0 });
    expect(
      readFileSync(join(layoutFor(run).groupDir, "100", "data", "address.json"), "utf8"),
    ).toContain("code-v2");
  });

  it("redoes a pID whose folder was deleted even if its fingerprint matches", async () => {
    const run = tmpRun();
    await runReexport(opts(run), makeDeps().deps);
    rmSync(join(layoutFor(run).groupDir, "103"), { recursive: true });
    const { deps, calls } = makeDeps();
    await runReexport(opts(run), deps);
    expect(calls.flat()).toEqual(["103"]);
  });
});

describe("codeHashOf", () => {
  it("covers the Austin transform, so a change to it invalidates every stored fingerprint", () => {
    expect(CODE_FILES).toContain(
      "pipeline/oracle-runtime/travis/transforms/austin-property-improvement.ts",
    );
    const repo = tmpRun();
    for (const rel of CODE_FILES) {
      mkdirSync(join(repo, rel, ".."), { recursive: true });
      writeFileSync(join(repo, rel), `// ${rel}`);
    }
    mkdirSync(join(repo, PROFILE_DIR), { recursive: true });
    writeFileSync(join(repo, PROFILE_DIR, "rules.json"), "{}");
    const before = codeHashOf(repo);
    writeFileSync(
      join(repo, "pipeline/oracle-runtime/travis/transforms/austin-property-improvement.ts"),
      "// trade_sub_permit",
    );
    const after = codeHashOf(repo);
    expect(after).not.toBe(before);
    expect(fingerprintOf(after, "cids", "db")).not.toBe(fingerprintOf(before, "cids", "db"));
  });
});

describe("compareRun (by permit content)", () => {
  const permit = (n: string, type = "Roofing", extra = "") =>
    JSON.stringify({ permit_number: n, improvement_type: type, extra });
  /** Writes permits as property_improvement_1..N plus a root file, in the given order. */
  const put = (
    dir: string,
    pid: string,
    permits: string[],
    shared: Record<string, string> = {},
  ) => {
    const d = join(dir, pid, "data");
    mkdirSync(d, { recursive: true });
    permits.forEach((p, i) => {
      writeFileSync(join(d, `property_improvement_${i + 1}.json`), p);
      writeFileSync(join(d, `relationship_property_has_property_improvement_${i + 1}.json`), "r");
    });
    writeFileSync(join(d, "bafkpi.json"), `root ${permits.length}`);
    for (const [n, t] of Object.entries(shared)) writeFileSync(join(d, n), t);
  };
  const BP = permit("2003-012717 BP");
  const EP = permit("2003-012717 EP", "Electrical");
  const PP = permit("2003-012717 PP", "Plumbing");
  const MP = permit("2003-012717 MP", "MechanicalHVAC");

  it("passes when trade sub-permits drop out, numbering shifts and shared files differ", () => {
    const [a, b] = [tmpRun(), tmpRun()];
    // Run 1 published EP first (sorted order), so the BP renumbers from 2 to 1
    put(b, "1", [EP, BP, MP, PP], { "address.json": "old", "property.json": "same" });
    put(a, "1", [BP], { "address.json": "new", "property.json": "same" });
    // a second pID that only had a trade permit in Run 1: now no folder
    put(b, "2", [permit("2010-000001 EP", "Electrical")]);
    // a third pID unchanged
    put(b, "3", [permit("2020-000003 BP")]);
    put(a, "3", [permit("2020-000003 BP")]);
    const r = compareRun(a, b, ["1", "2", "3"], CIDS);
    expect(r).toMatchObject({
      ok: true,
      pidsCompared: 2,
      permitsHere: 2,
      permitsRun1: 6,
      permitsIdentical: 2,
      pidsDropped: 1,
      droppedByType: { Electrical: 2, MechanicalHVAC: 1, Plumbing: 1 },
      roofingLost: [],
      sharedSame: 1,
    });
    expect(r.sharedDiffs).toEqual(["1/address.json"]);
  });

  it("fails when a kept permit's bytes differ", () => {
    const [a, b] = [tmpRun(), tmpRun()];
    put(a, "1", [permit("X BP", "Roofing", "changed")]);
    put(b, "1", [permit("X BP")]);
    expect(compareRun(a, b, ["1"], CIDS)).toMatchObject({
      ok: false,
      permitContentDiffs: ["1: X BP"],
    });
  });

  it("fails when a permit here is not in Run 1, or a pID is new", () => {
    const [a, b] = [tmpRun(), tmpRun()];
    put(a, "1", [BP, permit("NEW BP")]);
    put(b, "1", [BP]);
    put(a, "2", [permit("Z BP")]);
    const r = compareRun(a, b, ["1", "2"], CIDS);
    expect(r.ok).toBe(false);
    expect(r.permitsNotInRun1).toEqual(["1: NEW BP", "2: Z BP"]);
    expect(r.pidsNotInRun1).toEqual(["2"]);
  });

  it("fails when a Roofing permit of Run 1 is lost, in a kept folder or a dropped one", () => {
    const [a, b] = [tmpRun(), tmpRun()];
    put(b, "1", [BP, permit("2003-012717 BP2")]);
    put(a, "1", [BP]);
    put(b, "2", [permit("Y BP"), permit("Y EP", "Electrical")]);
    const r = compareRun(a, b, ["1", "2"], CIDS);
    expect(r.ok).toBe(false);
    expect(r.roofingLost).toEqual(["1: 2003-012717 BP2", "2: Y BP"]);
    expect(r.pidsDroppedWithRoofing).toEqual(["2"]);
  });

  it("fails on an unreadable permit file or a permit_number printed twice", () => {
    const [a, b] = [tmpRun(), tmpRun()];
    put(a, "1", [BP, BP]);
    put(b, "1", [BP]);
    put(a, "2", ["not json"]);
    put(b, "2", [permit("Q BP")]);
    const r = compareRun(a, b, ["1", "2"], CIDS);
    expect(r.ok).toBe(false);
    expect(r.unreadable).toHaveLength(2);
  });

  it("ignores pIDs outside the list and pIDs with no folder on either side", () => {
    const [a, b] = [tmpRun(), tmpRun()];
    put(b, "9", [BP]);
    const r = compareRun(a, b, ["1"], CIDS);
    expect(r).toMatchObject({ ok: true, pidsCompared: 0, permitsRun1: 0 });
  });
});
