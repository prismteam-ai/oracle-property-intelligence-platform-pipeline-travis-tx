# Storage contract: CID copy (A-03)

| Item | Value |
| --- | --- |
| Bucket | `CountyLensData` output `CidCopyBucketName` (mirrored to SSM String `/countylens/cid-copy/bucket`); SSE-S3; all Block Public Access on; `enforceSSL`; RETAIN; abort incomplete multipart 1 day |
| Public keys | `ipfs/<cid>` only: table parts, each `.car` under its `carCid`, the manifest under its CID. Never `runs/index.json` or any mutable key. |
| Private keys | `private/bench/<name>/part-*.parquet` (Lambda proof only; deleted after the 20 runs). Outside the CloudFront origin path. |
| Write guard | Bucket policy denies `s3:PutObject` on `ipfs/*` when `s3:if-none-match` is absent; writers have no `DeleteObject`/ACL actions. |
| Writer | IAM role `CountyLensCidCopyWriter` (account principals only), via the `assess-cid-writer` profile; `PutObject`, `GetObject` on `ipfs/*`. |
| Reader | API Lambda role: `GetObject` on `ipfs/*` and `private/bench/*`. |
| Object headers | `Cache-Control: public, max-age=31536000, immutable`; `Content-Type` by kind (`application/vnd.apache.parquet`, `application/vnd.ipld.car`, `application/json`); metadata `cid`, `sha256`; `ChecksumSHA256`. |
| CloudFront | OAC; origin path `/ipfs`; PriceClass_100; no WAF; cache policy TTL default 1 y, nothing in the cache key; error caching 404 → 10 s. |
| CORS (response-headers policy) | `Access-Control-Allow-Origin: *`; methods `GET, HEAD, OPTIONS`; allow headers `Range, If-None-Match`; expose `Content-Range, Accept-Ranges, Content-Length, ETag`; origin override on. |
| Public URL | `https://<distributionDomain>/<cid>` (`copyUrl(cid)` in `packages/shared`); fallback `https://ipfs.filebase.io/ipfs/<cid>` (`gatewayUrl(cid, "filebase")`). |
