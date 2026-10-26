import { readFileSync } from "node:fs";
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
const dom = process.env.CF_DOMAIN!; const key = process.argv[2];
const policy = JSON.stringify({ Statement: [{ Resource: `https://${dom}/cid/*`, Condition: { DateLessThan: { "AWS:EpochTime": Math.floor(Date.now() / 1000) + 3600 } } }] });
const s = getSignedUrl({ url: `https://${dom}/cid/*`, keyPairId: process.env.CF_KEY_PAIR_ID!, privateKey: readFileSync(process.env.CF_KEY_FILE!, "utf8"), policy });
const url = `https://${dom}/${key}${s.slice(s.indexOf("?"))}`;
const variants: Record<string, Record<string, string>> = {
  plain: { Range: "bytes=0-0" },
  enc: { Range: "bytes=0-0", "Accept-Encoding": "gzip, deflate, br, zstd" },
  nocache: { Range: "bytes=0-0", "Cache-Control": "no-cache", Pragma: "no-cache" },
  ims: { Range: "bytes=0-0", "If-Modified-Since": "Wed, 21 Oct 2026 00:00:00 GMT" },
};
for (const [n, h] of Object.entries(variants)) { const r = await fetch(url, { headers: h }); const b = await r.arrayBuffer(); console.log(n, r.status, r.headers.get("content-range"), b.byteLength, r.headers.get("x-cache")); }
