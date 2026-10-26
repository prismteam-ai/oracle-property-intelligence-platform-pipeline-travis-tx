// A-16 A11-17 R6: the worker script reports the step's real exit code (not the exit code of `date`).
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../scripts/publish-worker.sh", import.meta.url));

/** A fake `npx` first on PATH: records its argv and exits with FAKE_EXIT. */
function setup(): { env: NodeJS.ProcessEnv; log: string } {
  const root = mkdtempSync(join(tmpdir(), "publish-worker-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "argv.log");
  const npx = join(bin, "npx");
  writeFileSync(npx, `#!/usr/bin/env bash\necho "$@" >>"$FAKE_LOG"\nexit "\${FAKE_EXIT:-0}"\n`);
  chmodSync(npx, 0o755);
  return { env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, FAKE_LOG: log }, log };
}

const run = (env: NodeJS.ProcessEnv, args: string[]) =>
  spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", env });

describe("publish-worker.sh", () => {
  it("passes the step's flags through and exits 0 when the step succeeds", () => {
    const { env, log } = setup();
    const r = run(env, ["runs/r/manifest.json", "r", "filebase", "--copy-host", "h.example"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/exit=0 step=filebase at /);
    const argv = readFileSync(log, "utf8");
    expect(argv).toContain("--manifest runs/r/manifest.json --run-id r --step filebase");
    expect(argv).toContain("--copy-host h.example");
  });

  it("reports and returns the REAL exit code of a failing step", () => {
    const { env } = setup();
    const r = run({ ...env, FAKE_EXIT: "7" }, ["runs/r/manifest.json", "r", "car-files"]);
    expect(r.status).toBe(7);
    expect(r.stdout).toMatch(/exit=7 step=car-files at /);
    expect(r.stdout).not.toMatch(/exit=0/);
  });

  it("refuses to run without a manifest, run id and step", () => {
    const { env } = setup();
    const r = run(env, ["only-one"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/usage/);
  });
});
