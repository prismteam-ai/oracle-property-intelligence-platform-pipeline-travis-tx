// A-11 Run 3: `npm run fetch-address-layer` caches the City of Austin address-point layer under
// pipeline/data/raw/austin-address-points (gitignored) and writes receipt.json. Resumable: run it
// again after an interruption. Public GETs only, ≤ 1 request/s, project User-Agent. A 403 or a
// challenge stops with exit code 2 and is never retried.
import { fileURLToPath } from "node:url";
import { createSourceClient } from "../lib/source-client.js";
import { loadAddressLayer } from "./address-point-loader.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const dir =
  process.env.ADDRESS_LAYER_CACHE_DIR ?? `${repoRoot}pipeline/data/raw/austin-address-points`;

try {
  const receipt = await loadAddressLayer({
    client: createSourceClient({ hostSpacing: true }),
    cacheDir: dir,
    log: (m) => process.stdout.write(`${m}\n`),
  });
  process.stdout.write(
    JSON.stringify({
      cache_dir: dir,
      record_count: receipt.record_count,
      source_count: receipt.source_count,
      sha256: receipt.sha256,
      layer_last_edit_date: receipt.layer_last_edit_date,
      retrieved_at: receipt.retrieved_at,
    }) + "\n",
  );
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`${message}\n`);
  process.exit(message.includes("BLOCKED") ? 2 : 1);
}
