// Child process runner: one process per step, stdout and stderr appended to a per-step log file
// (never printed to the bridge console, so no step output can leak a credential into a terminal
// scrollback or the live object). Resolves with the exit code; a spawn error resolves 127.
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import type { ExecSpec } from "./runner.js";

export function makeExec(
  logDir: string,
  runTag: () => string,
): (spec: ExecSpec) => Promise<number> {
  return (spec) =>
    new Promise<number>((resolve) => {
      mkdirSync(logDir, { recursive: true });
      const fd = openSync(`${logDir}/${runTag()}-${spec.label}.log`, "a");
      const child = spawn(spec.cmd, spec.args, {
        cwd: spec.cwd,
        stdio: ["ignore", fd, fd],
        env: process.env,
      });
      child.on("error", () => {
        closeSync(fd);
        resolve(127);
      });
      child.on("close", (code) => {
        closeSync(fd);
        resolve(code ?? 1);
      });
    });
}
