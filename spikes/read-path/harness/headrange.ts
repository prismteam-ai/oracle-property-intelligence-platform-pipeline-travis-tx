import { readFileSync } from "node:fs";
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
const dom = process.env.CF_DOMAIN!; const key = process.argv[2];
const policy = JSON.stringify({ Statement: [{ Resource: `https://${dom}/cid/*`, Condition: { DateLessThan: { "AWS:EpochTime": Math.floor(Date.now() / 1000) + 3600 } } }] });
const url = key.startsWith("https://") ? key : getSignedUrl({ url: `https://${dom}/${key}`, keyPairId: process.env.CF_KEY_PAIR_ID!, privateKey: readFileSync(process.env.CF_KEY_FILE!, "utf8"), policy });
for (const [m, r] of [["HEAD", "bytes=0-"], ["HEAD", "bytes=0-0"], ["GET", "bytes=0-"], ["GET", "bytes=0-0"]]) {
  const res = await fetch(url, { method: m, headers: { Range: r } }); if (m === "GET") await res.arrayBuffer().catch(() => 0);
  console.log(m, r, res.status, res.headers.get("content-range"), res.headers.get("content-length"), res.headers.get("x-cache"));
}
