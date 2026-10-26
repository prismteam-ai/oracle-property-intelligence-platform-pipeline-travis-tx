/* global process, console */
// A-11 Run 3 one-off: fetch the CAR files that the CID copy already holds and that are not on disk.
// CloudFront serves S3 key ipfs/<cid> at https://<host>/<cid>; a 403/404 means "not copied yet".
// Prints "<present>/<total>". Kubo add later refuses a file whose CID differs from the manifest.
import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const m = JSON.parse(readFileSync(process.env.MANIFEST, "utf8"));
const host = process.env.CID_COPY_HOST;
if (!host) throw new Error("CID_COPY_HOST repository variable is not set");
const items = m.artifacts
  .filter((a) => a.carCid)
  .map((a) => ({
    path: a.kind === "directory" ? join(a.name, "tables.car") : a.name,
    url: `https://${host}/${a.carCid}`,
    size: a.kind === "car" ? a.size : undefined,
  }));
let present = 0;
for (const it of items) {
  if (existsSync(it.path)) {
    present++;
    continue;
  }
  mkdirSync(dirname(it.path), { recursive: true });
  const part = `${it.path}.part`;
  const r = spawnSync("curl", ["-fsS", "--retry", "3", "-o", part, it.url], { stdio: "pipe" });
  if (r.status !== 0) continue; // not copied yet
  const got = statSync(part).size;
  if (it.size !== undefined && got !== it.size) {
    console.log(`size mismatch ${it.path}: ${got} vs ${it.size}; retry next round`);
    continue;
  }
  renameSync(part, it.path);
  present++;
  console.log(`fetched ${it.path} (${got} bytes)`);
}
console.log(`${present}/${items.length}`);
