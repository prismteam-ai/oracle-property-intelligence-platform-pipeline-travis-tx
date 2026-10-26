// Spot check (A-16 AM-10 evidence): fetch CIDs from Pinata and orbitor, hash, compare with manifests.
/* global process, fetch, AbortSignal, setTimeout, Buffer, console */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
const [manifestsDir, receiptsDir, out] = process.argv.slice(2);
const GW = { pinata: "https://gateway.pinata.cloud", orbitor: "https://ipfs.orbitor.dev" };
const runs = JSON.parse(readFileSync(join(manifestsDir, "runs/index.json"), "utf8")).runs;
const targets = [];
for (const r of runs) {
  const b = readFileSync(join(manifestsDir, "runs", r.runId, "manifest.json"));
  targets.push({
    group: "manifest",
    name: `runs/${r.runId}/manifest.json`,
    cid: r.manifestCid,
    size: b.length,
    sha256: createHash("sha256").update(b).digest("hex"),
  });
}
const m31 = JSON.parse(
  readFileSync(join(manifestsDir, "runs/travis-full-run3-1-20261025/manifest.json"), "utf8"),
);
const receipts = readdirSync(receiptsDir)
  .filter((f) => !f.startsWith("summary"))
  .map((f) => JSON.parse(readFileSync(join(receiptsDir, f), "utf8")));
const pinned = new Set(
  receipts.filter((x) => x.status === "pinned" || x.status === "already_pinned").map((x) => x.cid),
);
const tables = m31.artifacts.filter((a) => a.kind === "table");
const shuffle = (a) =>
  a
    .map((x) => [Math.random(), x])
    .sort((p, q) => p[0] - q[0])
    .map((p) => p[1]);
for (const a of shuffle(tables.filter((t) => pinned.has(t.cid))).slice(0, 20))
  targets.push({ group: "table_on_pinata", ...a });
for (const a of shuffle(tables.filter((t) => !pinned.has(t.cid))).slice(0, 5))
  targets.push({ group: "table_not_on_pinata", ...a });
const results = [];
for (const t of targets) {
  const row = {
    group: t.group,
    name: t.name,
    cid: t.cid,
    size: t.size,
    sha256: t.sha256,
    gateways: {},
  };
  for (const [g, base] of Object.entries(GW)) {
    const started = Date.now();
    let res = { ok: false };
    for (let attempt = 1; attempt <= 4 && !res.ok; attempt++) {
      try {
        const r = await fetch(`${base}/ipfs/${t.cid}`, { signal: AbortSignal.timeout(120000) });
        if (r.status === 429 || r.status === 504) {
          res = { ok: false, status: r.status, attempt };
          await new Promise((s) => setTimeout(s, 3000 * attempt));
          continue;
        }
        const buf = Buffer.from(await r.arrayBuffer());
        const sha = createHash("sha256").update(buf).digest("hex");
        res = {
          status: r.status,
          bytes: buf.length,
          sha256: sha,
          ok: r.status === 200 && buf.length === t.size && sha === t.sha256,
          attempt,
        };
      } catch (e) {
        res = { ok: false, error: String(e.name || e), attempt };
      }
    }
    res.ms = Date.now() - started;
    row.gateways[g] = res;
    if (g === "pinata") await new Promise((s) => setTimeout(s, 1500));
  }
  row.both_ok = row.gateways.pinata.ok && row.gateways.orbitor.ok;
  console.log(
    `${row.both_ok ? "ok  " : "FAIL"} ${t.group.padEnd(20)} pinata=${row.gateways.pinata.ok ? "match" : JSON.stringify(row.gateways.pinata)} orbitor=${row.gateways.orbitor.ok ? "match" : JSON.stringify(row.gateways.orbitor)} ${t.name.split("/").slice(-3).join("/")}`,
  );
  results.push(row);
}
const by = (g) => results.filter((r) => r.group === g);
const summary = Object.fromEntries(
  ["manifest", "table_on_pinata", "table_not_on_pinata"].map((g) => [
    g,
    { checked: by(g).length, both_ok: by(g).filter((r) => r.both_ok).length },
  ]),
);
writeFileSync(
  out,
  JSON.stringify(
    {
      schema: "a16-am10-spot-check.v1",
      checked_at: new Date().toISOString(),
      gateways: GW,
      method:
        "plain GET /ipfs/<cid>, full body SHA-256 and size compared with the manifest (manifests: with their committed bytes and runs/index.json CID)",
      summary,
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify(summary));
