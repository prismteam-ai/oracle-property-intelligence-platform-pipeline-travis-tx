// A-11 (AM-05, D-5 follow-up): thin CLI over src/car-files.ts, the additive step that
// `elephant-cli upload` does NOT perform: add each `car` artifact's file, and each `directory`
// (tables) artifact's `tables.car`, as a plain raw-leaves file whose CID is the manifest's
// `carCid`, then read it back from both AM-01 gateways. See src/car-files.ts for the why.
// The resumable driver (scripts/publish-run.ts) calls the same module and skips files that are
// already published; this script always re-adds what it is given.
//
// Usage (from the repo root):
//   npx tsx pipeline/publish/scripts/upload-car-files.ts runs/<runId>/manifest.json [--only <name-or-substring>]...
//
// Credentials: ~/.config/assessment/filebase.env, loaded into a child env only (never
// process.env, never printed; every printed line is redact()ed). Exit 0 only when every selected
// target's Kubo Hash matched its carCid AND both gateways served it back; otherwise 1, after
// trying every target.
import { readFileSync, existsSync } from "node:fs";
import { carFileTargets, matchesOnly, uploadCarFile } from "../src/car-files.js";
import { filebaseEnvProblem } from "../src/sequence.js";
import { FILEBASE_ENV_FILE, parseEnvFile } from "../src/cli.js";

const USAGE =
  "usage: npx tsx pipeline/publish/scripts/upload-car-files.ts runs/<runId>/manifest.json [--only <name-or-substring>]...";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const manifestPath = args[0];
  if (manifestPath === undefined || manifestPath.startsWith("-")) {
    console.error(USAGE);
    return 2;
  }
  const only: string[] = [];
  for (let i = 1; i < args.length; i += 2) {
    const value = args[i + 1];
    if (args[i] !== "--only" || value === undefined || value.startsWith("-")) {
      console.error(USAGE);
      return 2;
    }
    only.push(value);
  }
  if (!existsSync(manifestPath)) {
    console.error(`${manifestPath} does not exist`);
    return 2;
  }

  const fromFile = existsSync(FILEBASE_ENV_FILE)
    ? parseEnvFile(readFileSync(FILEBASE_ENV_FILE, "utf8"))
    : {};
  const env: NodeJS.ProcessEnv = { ...process.env, ...fromFile };
  const problem = filebaseEnvProblem(env);
  if (problem !== undefined) {
    console.error(`refused: ${problem}`);
    return 1;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    artifacts: { name: string; kind: string; carCid?: string }[];
  };
  const targets = carFileTargets(manifest).filter((t) => matchesOnly(t, only));
  console.log(`manifest: ${manifestPath}`);
  console.log(`carCid artifacts to upload: ${targets.length}`);

  let failures = 0;
  for (const target of targets) {
    console.log(`\n${target.name} (${target.kind}) -> ${target.path}`);
    const result = await uploadCarFile(target, { env, log: (line) => console.log(line) });
    if (!result.ok) failures += 1;
  }
  console.log(
    `\n${failures === 0 ? "ALL CARCID ARTIFACTS UPLOADED AND VERIFIED" : `${failures} target(s) failed`}`,
  );
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
