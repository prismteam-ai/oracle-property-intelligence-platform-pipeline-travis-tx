// A-11 (machamp M4, low L2): resume, inode and lock behaviour of scripts/batch-hash-validate-export.sh,
// run for real under bash with a fake `elephant-cli` (ELEPHANT_CLI) that records every call.
// Local only: no network, no real data.
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../scripts/batch-hash-validate-export.sh", import.meta.url));

// FAKE_FAIL_BATCH=bNN makes `hash` leave a partial CAR behind and exit 3.
const FAKE_CLI = `#!/usr/bin/env bash
cmd="$1"; shift
echo "$cmd $*" >>"$FAKE_LOG"
case "$cmd" in
  hash)
    [ -n "$FAKE_SLEEP" ] && sleep "$FAKE_SLEEP"
    src="$1"; shift
    b="$(basename "$src")"
    while [ $# -gt 0 ]; do
      case "$1" in
        --output-car) car="$2"; shift 2;;
        --output-csv) csv="$2"; shift 2;;
        --output-zip) zip="$2"; shift 2;;
        *) shift;;
      esac
    done
    if [ "$b" = "$FAKE_FAIL_BATCH" ]; then echo partial >"$car"; exit 3; fi
    mkdir -p "$zip"; echo "zip $b" >"$zip/x.zip"
    echo "csv $b" >"$csv"
    echo "car $b $RANDOM$RANDOM" >"$car"
    ;;
  validate) ;;
  export-tables)
    car="$1"; shift
    while [ $# -gt 0 ]; do
      case "$1" in
        --output) out="$2"; shift 2;;
        --output-json) js="$2"; shift 2;;
        *) shift;;
      esac
    done
    echo t >"$out/part.parquet"
    echo "{\\"car\\":\\"$car\\"}" >"$js"
    ;;
esac
`;

interface Env {
  root: string;
  group: string;
  out: string;
  log: string;
  cli: string;
}

function setup(): Env {
  const root = mkdtempSync(join(tmpdir(), "batch-script-"));
  const group = join(root, "group");
  mkdirSync(group);
  for (const n of ["a1", "a2", "a3", "a4"]) writeFileSync(join(group, `${n}.zip`), `data ${n}`);
  const cli = join(root, "fake-elephant-cli");
  writeFileSync(cli, FAKE_CLI);
  chmodSync(cli, 0o755);
  return { root, group, out: join(root, "out"), log: join(root, "calls.log"), cli };
}

function run(e: Env, failBatch = "") {
  const r = spawnSync("bash", [SCRIPT, e.group, e.out, "2", "1", "pfx"], {
    encoding: "utf8",
    env: { ...process.env, ELEPHANT_CLI: e.cli, FAKE_LOG: e.log, FAKE_FAIL_BATCH: failBatch },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const calls = (e: Env): string[] =>
  existsSync(e.log) ? readFileSync(e.log, "utf8").split("\n").filter(Boolean) : [];
const hashed = (e: Env): string[] =>
  calls(e)
    .filter((c) => c.startsWith("hash "))
    .map((c) => /batches\/(b\d+)/.exec(c)?.[1] ?? "?");
const car = (e: Env, b: string): string =>
  readFileSync(join(e.out, "cars", `pfx-${b}.car`), "utf8");

describe("batch-hash-validate-export.sh resume", () => {
  it("a failed batch exits non-zero naming it; the rerun redoes only it, replacing stale outputs; a third run skips all", () => {
    const e = setup();
    const r1 = run(e, "b02");
    expect(r1.code).not.toBe(0);
    expect(r1.err).toMatch(/FAILED batches for pfx: b02/);
    expect(r1.err).not.toMatch(/b01/);
    expect(existsSync(join(e.out, "logs", "b01.done"))).toBe(true);
    expect(existsSync(join(e.out, "logs", "b02.done"))).toBe(false);
    expect(car(e, "b02")).toBe("partial\n"); // the failed attempt left a stale CAR

    const b01Before = car(e, "b01");
    writeFileSync(e.log, "");
    const r2 = run(e);
    expect(r2.code).toBe(0);
    expect(r2.out).toMatch(/unchanged group dir, reusing/);
    expect(r2.out).toMatch(/b01 already done, skipping/);
    expect(hashed(e)).toEqual(["b02"]);
    expect(car(e, "b01")).toBe(b01Before);
    expect(car(e, "b02")).toMatch(/^car b02 /); // replaced, never the partial one
    expect(existsSync(join(e.out, "logs", "b02.done"))).toBe(true);

    writeFileSync(e.log, "");
    const r3 = run(e);
    expect(r3.code).toBe(0);
    expect(calls(e)).toEqual([]);
    expect(r3.out).toMatch(/b01 already done/);
    expect(r3.out).toMatch(/b02 already done/);
    rmSync(e.root, { recursive: true, force: true });
  });

  it("a file replaced under the same name (new inode) triggers a re-split and redoes every batch", () => {
    const e = setup();
    expect(run(e).code).toBe(0);
    const oldCar = car(e, "b01");
    rmSync(join(e.group, "a1.zip"));
    writeFileSync(join(e.group, "a1.zip"), "data a1"); // same name, same bytes, new inode
    writeFileSync(e.log, "");
    const r = run(e);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\[split\] .*-> .*batches/);
    expect(r.out).not.toMatch(/reusing/);
    expect(hashed(e).sort()).toEqual(["b01", "b02"]);
    expect(car(e, "b01")).not.toBe(oldCar);
    rmSync(e.root, { recursive: true, force: true });
  });
});

describe("batch-hash-validate-export.sh run lock", () => {
  it("refuses to start while a live process holds the lock, and leaves the lock alone", () => {
    const e = setup();
    writeFileSync(`${e.out}.lock`, `${process.pid}\n`); // this test process is alive
    const r = run(e);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/in use by pid/);
    expect(calls(e)).toEqual([]);
    expect(readFileSync(`${e.out}.lock`, "utf8").trim()).toBe(String(process.pid));
    rmSync(e.root, { recursive: true, force: true });
  });

  it("takes over a stale lock (owner gone), then removes its own lock on exit", () => {
    const e = setup();
    const dead = spawnSync("bash", ["-c", "echo $$"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(`${e.out}.lock`, `${dead}\n`);
    const r = run(e);
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/taking over stale lock/);
    expect(existsSync(`${e.out}.lock`)).toBe(false);
    rmSync(e.root, { recursive: true, force: true });
  });

  it("A11-10(b): six processes racing for one stale lock: exactly one runs, the rest fail closed", async () => {
    const e = setup();
    const dead = spawnSync("bash", ["-c", "echo $$"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(`${e.out}.lock`, `${dead}\n`);
    const results = await Promise.all(
      Array.from(
        { length: 6 },
        () =>
          new Promise<{ code: number | null; err: string }>((resolve) => {
            const child = spawn("bash", [SCRIPT, e.group, e.out, "2", "1", "pfx"], {
              env: {
                ...process.env,
                ELEPHANT_CLI: e.cli,
                FAKE_LOG: e.log,
                FAKE_FAIL_BATCH: "",
                FAKE_SLEEP: "1",
              },
            });
            let err = "";
            child.stderr.on("data", (d: Buffer) => (err += d.toString()));
            child.on("close", (code) => resolve({ code, err }));
          }),
      ),
    );
    expect(results.filter((r) => r.code === 0)).toHaveLength(1);
    for (const r of results.filter((x) => x.code !== 0))
      expect(r.err).toMatch(/in use by pid|lost the race|taking over/);
    // the one winner hashed each batch exactly once
    expect(hashed(e).sort()).toEqual(["b01", "b02"]);
    expect(existsSync(`${e.out}.lock`)).toBe(false);
    expect(existsSync(`${e.out}.lock.takeover`)).toBe(false);
    rmSync(e.root, { recursive: true, force: true });
  }, 30_000);

  it("starts when the output dir's parent does not exist yet (the lock file needs its parent)", () => {
    const e = setup();
    const deep = { ...e, out: join(e.root, "new-parent", "out") };
    const r = run(deep);
    expect(r.code).toBe(0);
    expect(r.err).not.toMatch(/lost the race/);
    expect(existsSync(`${deep.out}.lock`)).toBe(false);
    rmSync(e.root, { recursive: true, force: true });
  });
});
