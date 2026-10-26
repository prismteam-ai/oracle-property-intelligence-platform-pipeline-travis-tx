// Playwright runner: N cold runs (fresh context, CDP cache disabled) of the harness over
// CloudFront signed URLs. Usage: tsx run.ts <variant> <harnessPath> <runs> <queries:0|1> <key1,key2,...>
// Env: CF_DOMAIN, CF_KEY_PAIR_ID, CF_KEY_FILE. Signed URLs are never printed or saved.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import { chromium } from "playwright";

const [variant, harnessPath, runsArg, withQueries, keysArg] = process.argv.slice(2);
const dom = process.env.CF_DOMAIN!;
const runs = Number(runsArg);
const keys = keysArg ? keysArg.split(",") : [];
const policy = JSON.stringify({
  Statement: [{ Resource: `https://${dom}/cid/*`,
    Condition: { DateLessThan: { "AWS:EpochTime": Math.floor(Date.now() / 1000) + 6 * 3600 } } }],
});
const signed = getSignedUrl({ url: `https://${dom}/cid/*`, keyPairId: process.env.CF_KEY_PAIR_ID!,
  privateKey: readFileSync(process.env.CF_KEY_FILE!, "utf8"), policy });
const qs = signed.slice(signed.indexOf("?"));
const urls = keys.map((k) => (k.startsWith("https://") ? k : `https://${dom}/${k}${qs}`));
const QK = process.env.QORDER ? process.env.QORDER.split(",") : withQueries === "2" ? ["count"] : ["count", "radius", "roofage"];
const target = `https://${dom}/${harnessPath}#${encodeURIComponent(JSON.stringify(urls))}`;

const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.ceil(p * s.length) - 1]; };
const browser = await chromium.launch({ headless: true });
const out: Record<string, unknown>[] = [];
const startedAt = new Date().toISOString();
for (let i = 0; i < runs; i++) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const net = { cidReq: 0, cidBytes: 0, harnessBytes: 0, statuses: {} as Record<string, number>, pops: new Set<string>(), xcache: {} as Record<string, number> };
  cdp.on("Network.loadingFinished", () => {});
  page.on("response", async (r) => {
    const u = r.url();
    const isData = u.includes("/cid/") || u.includes("/ipfs/");
    if (!u.includes(dom) && !isData) return;
    const st = String(r.status());
    net.statuses[st] = (net.statuses[st] ?? 0) + 1;
    const h = await r.allHeaders();
    if (h["x-amz-cf-pop"]) net.pops.add(h["x-amz-cf-pop"]);
    if (isData) {
      net.cidReq++; if (r.request().method() === "GET") net.cidBytes += Number(h["content-length"] ?? 0);
      const xc = (h["x-cache"] ?? "none").split(" ")[0]; net.xcache[xc] = (net.xcache[xc] ?? 0) + 1;
    } else net.harnessBytes += Number(h["content-length"] ?? 0);
  });
  const t0 = Date.now();
  await page.goto(target, { waitUntil: "commit" });
  await page.waitForFunction(() => (window as any).__result || (window as any).__error, null, { timeout: 180_000 });
  const err = await page.evaluate(() => (window as any).__error);
  if (err) { console.error(`run ${i} ERROR ${err}`); out.push({ i, error: err }); await ctx.close(); continue; }
  const r: Record<string, any> = await page.evaluate(() => (window as any).__result);
  const loadReq = net.cidReq, loadBytes = net.cidBytes;
  const q: Record<string, any> = {};
  if (withQueries !== "0") for (const k of QK) {
    const b0 = net.cidBytes, r0 = net.cidReq;
    q[k] = await page.evaluate((kk) => (window as any).__run(kk), k);
    await page.waitForTimeout(50);
    q[k].cidReq = net.cidReq - r0; q[k].cidBytes = net.cidBytes - b0;
  }
  out.push({ i, wallMs: Date.now() - t0, ...r, loadCidReq: loadReq, loadCidBytes: loadBytes, q,
    statuses: net.statuses, pops: [...net.pops], xcache: net.xcache, harnessBytes: net.harnessBytes });
  console.log(`${variant} run ${i} firstLoad ${Math.round(r.firstLoadMs)} ${withQueries !== "0" ? QK.map((k) => `${k} ${Math.round(q[k].ms)}`).join(" ") : ""}`);
  await ctx.close();
}
await browser.close();
const ok = out.filter((o) => !o.error) as any[];
const summary: Record<string, unknown> = { variant, harnessPath, files: keys.length, runs, ok: ok.length, startedAt, finishedAt: new Date().toISOString(),
  firstLoad: { p50: pct(ok.map((o) => o.firstLoadMs), 0.5), p95: pct(ok.map((o) => o.firstLoadMs), 0.95) },
  statuses: ok.reduce((a, o) => { for (const [k, v] of Object.entries(o.statuses)) a[k] = (a[k] ?? 0) + (v as number); return a; }, {} as Record<string, number>),
  pops: [...new Set(ok.flatMap((o) => o.pops))] };
if (withQueries !== "0") for (const k of QK) {
  const ms = ok.map((o) => o.q[k].ms);
  summary[k] = { p50: pct(ms, 0.5), p95: pct(ms, 0.95), rows: ok[0]?.q[k].rows, first: ok[0]?.q[k].first,
    reqP50: pct(ok.map((o) => o.q[k].cidReq), 0.5), bytesP50: pct(ok.map((o) => o.q[k].cidBytes), 0.5) };
}
mkdirSync("results", { recursive: true });
writeFileSync(`results/${variant}.json`, JSON.stringify({ summary, runs: out }, null, 2));
console.log(JSON.stringify(summary));
