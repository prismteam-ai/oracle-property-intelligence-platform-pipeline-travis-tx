// A-11: thin CLI over src/manifest-upload.ts: adds a run manifest's own JCS bytes to Filebase's
// Kubo RPC and reads them back from both AM-01 gateways. The resumable driver
// (scripts/publish-run.ts) calls the same module and skips it when the manifest is already
// published.
//
// Usage (from the repo root):
//   npx tsx pipeline/publish/scripts/upload-manifest.ts runs/<runId>/manifest.json
//
// Credentials: ~/.config/assessment/filebase.env, loaded into a child env only (never
// process.env, never printed; every printed line is redact()ed). Exit 0 only when the Kubo Hash
// equals the local CID and both gateways serve back identical bytes; otherwise 1.
import { readFileSync, existsSync } from "node:fs";
import { uploadManifestBytes } from "../src/manifest-upload.js";
import { filebaseEnvProblem, redact, secretValues } from "../src/sequence.js";
import { FILEBASE_ENV_FILE, parseEnvFile } from "../src/cli.js";

async function main(): Promise<number> {
  const manifestPath = process.argv[2];
  if (manifestPath === undefined || manifestPath.startsWith("-")) {
    console.error(
      "usage: npx tsx pipeline/publish/scripts/upload-manifest.ts runs/<runId>/manifest.json",
    );
    return 2;
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

  const bytes = readFileSync(manifestPath);
  console.log(`manifest: ${manifestPath}`);
  try {
    const result = await uploadManifestBytes(bytes, { env, log: (line) => console.log(line) });
    if (!result.ok) {
      console.error(
        "VERIFICATION FAILED: not all gateways served back the identical manifest bytes",
      );
      return 1;
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    console.error(redact(`kubo add failed: ${text}`, secretValues(env)));
    return 1;
  }
  console.log("ALL GATEWAYS VERIFIED");
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
