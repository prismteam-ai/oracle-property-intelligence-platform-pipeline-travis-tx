import { chromium } from "playwright";
const dom = process.env.CF_DOMAIN!; const [path, ...sqls] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(`https://${dom}/${path}#${encodeURIComponent("[]")}`.replace("#", "?pre=SELECT%201#"));
await p.waitForFunction(() => (window as any).__sql, null, { timeout: 60000 }).catch(() => {});
for (const s of sqls) console.log(s, "=>", await p.evaluate((q) => (window as any).__sql(q).catch((e: any) => "ERR " + e), s));
await b.close();
