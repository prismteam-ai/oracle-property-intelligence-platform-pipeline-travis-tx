// CORS proof for the CloudFront /cid/* path with a signed URL (URL never printed).
import { readFileSync } from "node:fs";
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
const dom = process.env.CF_DOMAIN!; const key = process.argv[2];
const policy = JSON.stringify({ Statement: [{ Resource: `https://${dom}/cid/*`, Condition: { DateLessThan: { "AWS:EpochTime": Math.floor(Date.now() / 1000) + 3600 } } }] });
const url = getSignedUrl({ url: `https://${dom}/${key}`, keyPairId: process.env.CF_KEY_PAIR_ID!, privateKey: readFileSync(process.env.CF_KEY_FILE!, "utf8"), policy });
const O = "https://countylens.example-origin.test";
const show = (n: string, r: Response) => console.log(n, r.status, JSON.stringify(Object.fromEntries([...r.headers].filter(([k]) => /access-control|content-range|accept-ranges|x-cache|x-amz-cf-pop|content-length/.test(k)))));
show("preflight", await fetch(url, { method: "OPTIONS", headers: { Origin: O, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "range" } }));
show("range-get", await fetch(url, { headers: { Origin: O, Range: "bytes=0-1023" } }));
show("head", await fetch(url, { method: "HEAD", headers: { Origin: O } }));
const bad = new URL(url); bad.searchParams.set("Signature", "x" + bad.searchParams.get("Signature")!.slice(1));
show("tampered-sig", await fetch(bad, { headers: { Range: "bytes=0-15" } }));
console.log("at", new Date().toISOString());
