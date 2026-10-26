// Child-process helpers for the cases that spawn the Vitest suites, the CLI scripts and a
// nested `playwright test --list` (TC-060). Output is captured, never inherited, so a test
// can assert exact lines and attach them as evidence.
import { spawn } from "node:child_process";
import { z } from "zod";

export interface RunResult {
  command: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** stdout then stderr, for assertions that do not care which stream a line used. */
  output: string;
  durationMs: number;
}

export interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/**
 * A copy of the current environment without colour and without the variables the running
 * Playwright worker sets for itself, so a nested `playwright test` or Vitest run starts clean.
 * `overrides` set (string) or remove (undefined) keys.
 */
export function childEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const removed = new Set(
    Object.entries(overrides)
      .filter(([, value]) => value === undefined)
      .map(([key]) => key),
  );
  const inherited = Object.entries(process.env).filter(
    ([key]) =>
      !/^(PW_|PWTEST|PLAYWRIGHT_|TEST_WORKER_INDEX|TEST_PARALLEL_INDEX)/.test(key) &&
      !removed.has(key),
  );
  const set = Object.entries(overrides).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return Object.fromEntries([...inherited, ["FORCE_COLOR", "0"], ["NO_COLOR", "1"], ...set]);
}

export function run(command: string, args: string[], options: RunOptions): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? childEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? 10 * 60_000,
      killSignal: "SIGKILL",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolvePromise({
        command: [command, ...args].join(" "),
        code,
        signal,
        stdout,
        stderr,
        output: `${stdout}\n${stderr}`,
        durationMs: Date.now() - started,
      }),
    );
  });
}

/** Non-empty, trimmed lines of a captured output. */
export function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------------------
// Vitest, spawned with its JSON reporter so a case can assert that the suite it names ran,
// passed, and ran at least one test (an empty match is a failure, never a pass).
// ---------------------------------------------------------------------------------------

const AssertionResult = z.object({
  fullName: z.string(),
  title: z.string(),
  status: z.string(),
});
const FileResult = z.object({
  name: z.string(),
  status: z.string(),
  message: z.string().optional(),
  assertionResults: z.array(AssertionResult),
});
export const VitestJson = z
  .object({
    numTotalTests: z.number().int(),
    numPassedTests: z.number().int(),
    numFailedTests: z.number().int(),
    success: z.boolean(),
    testResults: z.array(FileResult),
  })
  .loose();
export type VitestJson = z.infer<typeof VitestJson>;

export interface VitestRunOptions extends RunOptions {
  /** `pnpm` for workspace packages (`pnpm --dir <cwd> exec vitest …`), `npx` for pipeline/oracle-runtime. */
  runner: "pnpm" | "npx";
  files: string[];
  nameFilter?: string;
  /** Absolute path the JSON report is written to (under the test's output dir). */
  outputFile: string;
}

export interface VitestRun {
  result: RunResult;
  report: VitestJson | undefined;
  passedNames: string[];
}

export async function runVitest(options: VitestRunOptions): Promise<VitestRun> {
  const args = ["run", ...options.files];
  if (options.nameFilter) args.push("-t", options.nameFilter);
  args.push("--reporter=default", "--reporter=json", `--outputFile=${options.outputFile}`);
  const result =
    options.runner === "pnpm"
      ? await run("pnpm", ["--dir", options.cwd, "exec", "vitest", ...args], options)
      : await run("npx", ["vitest", ...args], options);
  const { readFileSync, existsSync } = await import("node:fs");
  const report = existsSync(options.outputFile)
    ? VitestJson.parse(JSON.parse(readFileSync(options.outputFile, "utf8")))
    : undefined;
  const passedNames =
    report?.testResults.flatMap((file) =>
      file.assertionResults.filter((a) => a.status === "passed").map((a) => a.fullName),
    ) ?? [];
  return { result, report, passedNames };
}
