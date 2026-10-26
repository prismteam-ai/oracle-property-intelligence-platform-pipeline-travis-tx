// A-04 T010: `npm --prefix pipeline/oracle-runtime run backbone -- <verb> [flags]`
// (contracts/cli.md). Loads travis/backbone/commands/<verb>.ts (a BackboneCommand), parses
// flags with its Zod schema, refuses a start while another job is running (FR-025: asks
// BackboneReport/running through the Restate ingress), stops below 5 GiB free, and prints
// `job_id=<id>` as the last stdout line. Talks only to the Restate ingress, never to the Query DB.
// Exit codes: 0 ok · 1 error · 2 blocked · 3 waiting_human · 4 disk guard · 64 usage.
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ZodType } from "zod";
import { DiskGuardError, freeBytesAt } from "./disk-guard.js";
import { createRestateIngressClient, type RestateIngressClient } from "./restate-client.js";
import { createRunContext, type RunContext } from "./run-context.js";

export const EXIT = { ok: 0, error: 1, blocked: 2, waitingHuman: 3, disk: 4, usage: 64 } as const;
export type ExitCode = 0 | 1 | 2 | 3 | 4;

export interface BackboneCommand<A> {
  verb: string;
  args: ZodType<A>;
  /** Whether this invocation starts a run (default true); read-only verbs return false. */
  startsRun?: (args: A) => boolean;
  /** `jobIdPrinted`: the command already printed `job_id=` and owns the last line (join proof). */
  run(
    ctx: RunContext,
    args: A,
  ): Promise<{
    jobId: string;
    exitCode: ExitCode;
    jobIdPrinted?: boolean;
    /** Machine-readable stdout (`report --json`): `job_id=` goes to stderr so pipes stay valid. */
    jobIdToStderr?: boolean;
  }>;
}

export const COMMANDS_DIR = fileURLToPath(new URL("./commands/", import.meta.url));

export interface CliDeps {
  commandsDir: string;
  ingress: RestateIngressClient;
  now: () => Date;
  /** Environment whose secret-looking values are scrubbed from every output line. */
  env: Readonly<Record<string, string | undefined>>;
  freeBytes: () => number;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

interface RunningJob {
  job_id: string;
  track?: string;
  mode?: string;
  started_at?: string;
}

const SECRET_ENV = /URL|TOKEN|SECRET|PASSWORD|PASSWD|PASS|KEY|DSN|CREDENTIAL|AUTH/i;

/** Removes connection strings, the Query DB variable name and secret-looking env values. */
export function scrub(text: string, env: CliDeps["env"]): string {
  let out = text;
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && value.length >= 6 && SECRET_ENV.test(name)) {
      out = out.split(value).join("[redacted]");
    }
  }
  return out
    .replace(/postgres(?:ql)?:\/\/\S*/gi, "[redacted]") // grep-gates:allow the scrubber names what it removes
    .replace(/DATABASE_URL/g, "[redacted]"); // grep-gates:allow the scrubber names what it removes
}

function listVerbs(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".ts") && !n.endsWith(".d.ts") && !n.endsWith(".test.ts"))
      .map((n) => n.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

/** `--a-flag v --b` → { aFlag: "v", b: true }; a positional argument is a usage error. */
export function parseFlags(argv: readonly string[]): Record<string, string | boolean> | null {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--") || arg.length < 3) return null;
    const key = arg.slice(2).replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function isCommand(value: unknown): value is BackboneCommand<unknown> {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<BackboneCommand<unknown>>;
  return typeof c.verb === "string" && typeof c.run === "function" && c.args !== undefined;
}

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const out = (line: string): void => deps.stdout(`${scrub(line, deps.env)}\n`);
  const err = (line: string): void => deps.stderr(`${scrub(line, deps.env)}\n`);
  const verbs = listVerbs(deps.commandsDir);
  const usage = (why: string): number => {
    err(`backbone: ${why}`);
    err(`usage: backbone <verb> [flags]; verbs: ${verbs.join(", ")}`);
    return EXIT.usage;
  };

  const [verb, ...rest] = argv;
  if (verb === undefined || !verbs.includes(verb)) {
    return usage(verb === undefined ? "no verb given" : `unknown verb "${verb}"`);
  }
  const mod = (await import(pathToFileURL(join(deps.commandsDir, `${verb}.ts`)).href)) as {
    command?: unknown;
  };
  if (!isCommand(mod.command) || mod.command.verb !== verb) {
    return usage(`commands/${verb}.ts does not export a BackboneCommand for "${verb}"`);
  }
  const command = mod.command;
  const flags = parseFlags(rest);
  if (flags === null) return usage(`bad arguments for ${verb}`);
  const parsed = command.args.safeParse(flags);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "flags"}: ${i.message}`);
    return usage(`bad flags for ${verb}: ${issues.join("; ")}`);
  }

  const ctx = createRunContext({
    ingress: deps.ingress,
    now: deps.now,
    freeBytes: deps.freeBytes,
    print: out,
  });
  try {
    const starts = command.startsRun?.(parsed.data) ?? true;
    if (starts) {
      ctx.diskGuard();
      const running = await deps.ingress.call<RunningJob | null>("BackboneReport", "running", null);
      if (running !== null && running !== undefined) {
        err(
          `backbone: refused: job ${running.job_id} is running` +
            `${running.track === undefined ? "" : ` (${running.track}${running.mode === undefined ? "" : `/${running.mode}`})`}` +
            "; one ingest run at a time (FR-025)",
        );
        return EXIT.error;
      }
    }
    const result = await command.run(ctx, parsed.data);
    if (result.jobIdPrinted !== true) {
      if (result.jobIdToStderr === true) err(`job_id=${result.jobId}`);
      else out(`job_id=${result.jobId}`);
    }
    return result.exitCode;
  } catch (error) {
    if (error instanceof DiskGuardError) {
      err(`backbone: ${error.message}`);
      return EXIT.disk;
    }
    err(`backbone: ${verb} failed: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.error;
  }
}

export function defaultDeps(): CliDeps {
  return {
    commandsDir: COMMANDS_DIR,
    ingress: createRestateIngressClient(),
    now: () => new Date(),
    env: process.env,
    freeBytes: () => freeBytesAt(fileURLToPath(new URL("../../", import.meta.url))),
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2), defaultDeps());
}
