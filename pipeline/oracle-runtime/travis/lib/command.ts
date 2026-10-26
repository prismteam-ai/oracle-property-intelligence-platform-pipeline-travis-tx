// Command runner seam for the operator-side steps that read local tools (Docker, psql inside
// the container, the vendored Python validator). Production uses `execRunner`; tests inject
// a fake so they stay offline. Commands run without a shell (execFile), so no argument is
// ever interpreted by a shell.
import { execFile } from "node:child_process";

export interface CommandResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd?: string;
}

export type CommandRunner = (
  file: string,
  args: readonly string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

const MAX_BUFFER = 64 * 1024 * 1024;

/** Runs `file args` and resolves with its exit code; rejects only when it cannot start. */
export const execRunner: CommandRunner = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { cwd: options.cwd, maxBuffer: MAX_BUFFER, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({
          exit_code: error ? Number(error.code) : 0,
          stdout,
          stderr,
        });
      },
    );
  });
