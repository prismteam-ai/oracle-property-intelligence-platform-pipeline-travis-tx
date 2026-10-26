---
id: ADR-0001
type: decision
parent: ARD-A
story: A-03
title: "Read path: CloudFront CID copy for files, Lambda DuckDB for radius and roof-age queries, --part-size 48m"
status: Accepted, amended 2026-10-26 (A-16 AC-13, see "Amendment 1"; PO decision D-4, 2026-10-21; was "Proposed (spike result; needs PO review before A-03 Stage 3, see 'Needs a PO decision')")
date: 2026-10-21
---

# Read-path spike (A-03 Stage 2S): results and decision

Time box 4 h, started 2026-10-21 02:56 EEST (2026-10-20 23:56Z), ended 2026-10-21 05:18 EEST (02:18Z), 3 h 22 min. Times are UTC unless marked EEST. Operator machine: macOS laptop, home network; every CloudFront response came from edge `MRS53-P4` (Marseille). Every number below was measured during the spike, and the table or line says when. Projections are labelled **projection** and give their formula.

## Context

- **AD-02:** the app and API read a byte-for-byte copy of the published CLI files on S3 + CloudFront, keyed by CID. A public IPFS gateway is the fallback, Verify uses ipfs.io and dweb.link, and "an A-02 spike must prove p95".
- **AD-01:** only `elephant-cli export-tables` output is public, in insertion order (no geo sort). It is tuned only through `--part-size` and a bounding-box prefilter.
- **AD-18:** DuckDB-WASM runs in the browser and `@duckdb/node-api` in Lambda.
- **AD-22:** the Filebase plan is picked after this size measurement.
- **A-03 AC-4 (NFR-01):** over the full-size Austin permit table, 20 timed runs of COUNT, bbox + haversine radius and roof-age must each have p95 < 3 s, and the first DuckDB load must be ≤ 8 s. If a p95 is ≥ 3 s, this record switches to the Lambda DuckDB fallback before Stage 3.

## PO decisions (D-3, 2026-10-21)

1. Scale test: **"Full Austin table, keep AC-4"**. The test uses the full `3syk-w9eu` table (2,380,725 rows on 2026-10-19), and AC-4 is unchanged.
2. Spike stack: **"Yes, deploy and remove"**. Only the temporary `CountyLensSpike` stack is created: private S3 with Block Public Access, CloudFront with OAC, `/cid/*` behind signed URLs through a trusted key group, and `/harness/*` public with no data.
3. Gateway legs: **"Public CIDs now, ours later"** (option c). Behaviour tests run on Elephant `elephant-cli` CIDs that are already public (Jackson FL). The re-measure on A-03's own CIDs comes after D-8 and is marked **pending D-8** below.

## PO decision (D-4, 2026-10-21)

Recorded after the spike, on the three items in "Needs a PO decision" (round R3). This record's status moves from Proposed to Accepted.

1. Read path (Decision 1–4, Needs a PO decision 2 and 3): **"Accept (Recommended)"**. Files are read from the CloudFront CID copy first, with the Filebase gateway as the labelled fallback; `export-tables --part-size 48m`; Filebase Free for A-03, the Pro decision at A-11; radius and roof-age queries switch to the Lambda DuckDB fallback over the same Parquet; the browser keeps first load, COUNT, small reads and free-form SQL; DuckDB-WASM is opened with `{ allowFullHTTPReads: true, forceFullHTTPReads: false, reliableHeadRequests: false }` and the WASM is served pre-compressed (Brotli).
2. Verify gateways (Needs a PO decision 1): **"Pinata + Filebase (Recommended)"**. ipfs.io and dweb.link retired on 2026-09-21 (every request 429, `Sunset: Mon, 21 Sep 2026 00:00:00 GMT`, `Link: <https://gatewaychanges.ipfs.io/>; rel="sunset"`; Finding 3, re-confirmed 2026-10-21 07:29Z). `verify-manifest` uses Pinata's public gateway (`gateway.pinata.cloud`, the independent one) and the Filebase gateway (`ipfs.filebase.io`), with plain GETs (no Range, no preflight), checking size and SHA-256. It still rejects the CloudFront copy and `w3s.link`.
3. Lambda proof: **"Private prefix + direct invoke (Recommended)"**. The full-size Austin Parquet goes under a private prefix of the `CountyLensData` bucket that CloudFront does not serve. 20 timed direct `aws lambda invoke` runs (never through the public API) measure the in-region p95. The file is deleted afterwards and the deletion is recorded in the evidence.

**Note (2026-10-21, full-scale COUNT, ARD § 16 AM-06):** AM-06, accepted under the same D-4 decision, records: "Full-county browser COUNT at part size 48m measured p95 11.7 s, so at full scale COUNT also runs on the Lambda (noted for A-11 / A-13; A-03's slice is ≈ 37 rows)." At full scale COUNT, radius and roof-age switch to the Lambda DuckDB fallback. The browser keeps first load and small reads (COUNT and the listing over A-03's slice) and free-form SQL. Filebase at full scale is a known gap until A-11: only `elephant-cli` output may be public, so no full-size table is published on Filebase to measure it.

## Method

| Step | What was done | Source (`spikes/read-path/`) |
| --- | --- | --- |
| Capture | Full Austin `3syk-w9eu` in one pass. Key-set paging (`$order=:id`, `$where=:id > last`), 50,000 rows per page, ≥ 1.1 s between request starts, one request at a time, no app token, project User-Agent. A receipt for every request; stop on 403 or a challenge. Output in `pipeline/data/raw/austin-full/` (gitignored, never published). | `capture/capture.ts` |
| Convert | DuckDB 1.5.6 CLI. This is a **proxy** for the `elephant-cli` writer (`tables-export.service.js` at `44bb182`): ZSTD level 3, all strings UTF8, insertion order, `latitude`/`longitude` DOUBLE, `issue_date` VARCHAR, `location` dropped. Row groups are 80,825 rows: the CLI flushes at a 64 MiB budget of its own row-size estimate, and the mean estimate on this table is 830.3 B/row (64 MiB / 830.3 = 80,825). It is not CLI output and is never published. | `convert.sql` |
| Split | The CLI seals a part when (compressed bytes written + estimated pending bytes) would pass `--part-size`. `split-plan.ts` replays that rule over the real per-row estimates, using the measured compressed/estimate ratio 194,678,154 / 1,976,898,950 = 0.0985. Each part is written on those row boundaries. DuckDB `FILE_SIZE_BYTES` was tried first and rejected, because it splits on in-memory bytes across parallel writers rather than the way the CLI does. | `split-plan.ts` |
| Stack | `CountyLensSpike`, CDK TypeScript; region comes from the `assess` profile (eu-north-1). S3 bucket with all four Block Public Access settings, SSE-S3, `enforceSSL`, `autoDeleteObjects`, CORS GET/HEAD with `Range`. CloudFront with OAC: `/cid/*` needs a signed URL (trusted key group, custom policy `https://{dist}/cid/*`, 6 h expiry, `@aws-sdk/cloudfront-signer`); `/harness/*` is public and holds no data. Deployed 2026-10-21 ~00:05Z in 225.7 s. | `cdk/` |
| Harness | Vite page with `@duckdb/duckdb-wasm` 1.33.1-dev57.0 (npm `latest` on 2026-10-21; DuckDB v1.5.4) and a self-hosted bundle. Signed URLs travel in the URL fragment, so they are never sent to a server or logged. Playwright 1.64.1, headless Chromium, a fresh context per run, browser cache disabled through CDP. **First load** = navigation start → DuckDB-WASM instantiated + `DESCRIBE` of the view over all parts. COUNT(*), radius and roof-age then run in the same page, each timed. 20 runs per row; p50 = 10th and p95 = 19th of the 20 sorted values (nearest rank). | `harness/` |
| Queries | **Radius:** Pflugerville city point from `travis-places@1.0.0` (Census 2024 gazetteer, 30.447765, −97.602116), 5 statute miles (8,046.72 m). Bbox prefilter on lat/lon, then haversine < 8,046.72 m, `ORDER BY` distance, `LIMIT 500` (500 rows returned). **Roof-age, a performance stand-in only:** `date_diff('year', TRY_CAST(substr(issue_date,1,10) AS DATE), DATE '2026-10-21') >= 15` inside the same radius (27,109 rows counted). It has the same cost profile as `roof_age_years` over `structure.roof_date`; there is no roof classification in SQL (P0-9). | `harness/src/main.ts` |
| Gateways | For each gateway × CID, 5 rounds of: plain GET (no Range), Range GET `bytes=0-1023`, CORS GET with a foreign `Origin`, and CORS preflight (OPTIONS, `range`). Recorded: status, TTFB, size, and SHA-256 compared with the digest inside the CID. Also 20 runs of the harness page (CloudFront origin) reading a Filebase CID cross-origin with DuckDB-WASM. | `gateways/probe.ts`, `harness/run.ts` |
| Lambda sizing | `@duckdb/node-api` 1.5.6-r.2 on the laptop, with the same three queries and a fresh in-memory DuckDB per run: (a) over the same signed CloudFront URLs, (b) over the same Parquet as local files (compute floor). | `lambda-sizing/size.ts` |

## Austin capture

| Item | Value (measured) |
| --- | --- |
| `count(*)` at capture start (23:57:23Z) | **2,380,939** rows (2,380,725 on 2026-10-19; the table grew by 214) |
| Rows captured | **2,380,939** in **48 pages** (47 × 50,000 + 30,939), one pass, 2026-10-20 23:57:23Z → 2026-10-21 00:13:33Z (16 min 10 s) |
| Requests (attempt 2) | 49 (1 count + 48 pages), **all HTTP 200**; no 403, no challenge, no 429; slowest response 79.8 s; 3,752,228,582 bytes of JSON |
| Attempt 1 (2026-10-20 23:56:59Z) | 2 requests: count → 200, then page 1 → **HTTP 400** `query.compiler.malformed` ("Star selections must come at the start of the select-list"). Caused by our `$select=:id,*`, not by the source. The run stopped as designed and was restarted with `$select=*,:id`. Its receipts are kept as `receipts-attempt1-http400.jsonl`. |
| Rows with coordinates | 2,018,861 of 2,380,939 have `latitude` (84.8 %) |
| Raw JSON → Parquet | 3,752,228,582 B → 194,678,154 B (single part) = **0.0519** (19.3 : 1) |

## Results: browser (DuckDB-WASM over CloudFront signed URLs)

### Finding 1: the DuckDB-WASM defaults download the whole file

With the default `DuckDBConfig`, DuckDB-WASM 1.33.1-dev57.0 sent `HEAD` and then a **full GET with no Range** for every file, on CloudFront and on Filebase alike (traced 2026-10-21 ~01:30Z). Two separate causes:

- CloudFront answers `HEAD` + `Range: bytes=0-` with **200** (S3 directly and Filebase answer 206).
- With the default flags this build skips the range probes altogether.

Range reads work only with an explicit `db.open({ filesystem: { allowFullHTTPReads: true, forceFullHTTPReads: false, reliableHeadRequests: false } })`. The size probe is then `GET Range: bytes=0-0` (206), followed by footer and column-chunk range reads. **A-03 must set this.** With the defaults, v1g took first load p50 37,580 ms / p95 39,450 ms (the whole 194.7 MB file, 00:29–00:42Z). After that full download, the queries ran from memory: COUNT 73.6 / 82.2 ms, radius 382 / 393 ms, roof-age 351 / 404 ms (p50 / p95).

### Finding 2: the WASM file must be served pre-compressed

`duckdb-eh.wasm` is 35.9 MB. CloudFront compresses only files of 1 KB to 10 MB, so it is served uncompressed unless we upload a pre-compressed copy. Brotli level 11 makes it 5.3 MB (`Content-Encoding: br`).

| First load, v1g, range reads, 20 runs | p50 | p95 | Measured |
| --- | --- | --- | --- |
| Uncompressed WASM (35.9 MB) | 8,221 ms | **8,618 ms** (> 8 s target) | 01:48–01:51Z |
| Brotli WASM (5.3 MB) | 3,019 ms | **3,292 ms** | 00:54–01:08Z |

DuckDB-WASM instantiation alone (Brotli) takes p50 ≈ 1.7–1.9 s within that time.

### p50 / p95 per query and part-size variant (Brotli WASM, range reads, 20 runs each, ms)

Variants are the same 2,380,939 rows split by the CLI rule (see Method): **1g** = 1 part, 194,678,154 B, 30 row groups. **256m** gives the identical single part for this table (simulated: 1 part, 30 groups), so it was not uploaded twice. **128m** = 3 parts (92.3 / 74.7 / 27.8 MB), 194,783,205 B. **48m** = 40 parts of one row group each (≈ 5.9–8.4 MB), 196,577,179 B.

| Variant | First load p50 / p95 | COUNT(*) p50 / p95 | Radius p50 / p95 | Roof-age **cold** p50 / p95 | Roof-age warm (after radius) p50 / p95 | Measured (UTC) |
| --- | --- | --- | --- | --- | --- | --- |
| 1g (= 256m) | 3,019 / 3,292 | 24 / 25 | **38,814 / 40,540** (241 requests) | **15,077 / 15,968** (150 requests, 41.1 MB) | 147 / 193 | 00:54–01:09; cold 01:52–01:58 |
| 128m | 3,041 / 3,381 | 790 / 840 (14 requests) | **38,539 / 40,072** (206 requests) | not run (time box) | 194 / 206 | 01:09–01:23 |
| 48m | 2,831 / 3,454 | **10,980 / 11,668** (187 requests) | **41,660 / 42,535** (492 requests, 85.6 MB) | **26,416 / 31,069** (380 requests, 38.0 MB) | 829 / 854 | 01:23–01:42; cold 01:58–02:08 |

**AC-4 verdict.** First load meets ≤ 8 s on every variant, but only with the Brotli WASM. COUNT(*) meets < 3 s for 1g and 128m and fails for 48m (40 footers read one after another). **Radius and roof-age fail p95 < 3 s on every variant, by 5–14×.** The rule in AC-4 therefore applies: **the switch to the Lambda DuckDB fallback is recorded below.**

Why the browser is slow: DuckDB-WASM issues **synchronous** XHR range requests, one at a time (241–492 per radius query, ≈ 80–160 ms each from this laptop). Because the file is in insertion order (AD-01), no row group can be skipped on lat/lon statistics, so every row group's lat, lon and projected columns are fetched. The compute itself is small: the same queries over the same files read locally take p95 ≤ 175 ms (see Lambda sizing).

CORS and signing on `/cid/*` (00:39:52Z, cross-origin `Origin`, signed URL):

- Preflight → 200 with `access-control-allow-headers: range`.
- Range GET → 206, `content-range: bytes 0-1023/92303561`, `access-control-expose-headers: Content-Range, Accept-Ranges, Content-Length, ETag`.
- HEAD → 200 with `accept-ranges: bytes`.
- A tampered signature → **403**. An unsigned `/cid/` request → **403**.

## Results: gateway legs

Public CIDs used (D-3 option c), from the kit Atlas index (`indexCid bafkreifw24tns43is25hexizxkeqo6u2e4ayvjuo4yrwxtwly4q7ixlgqu`): Jackson FL `archiveCid baguqeerafpmumlr6x2iood2tismucos6w6eu6clge3z3pbwpogs5u5wkk6cq` (131 B) and `tablesCid baguqeerau5cozk6j4p5p32zlsqwlc2va4eigqqptkl6xhlns5wxpl4vsilmq` (976 B). The `property` table part `bafkreihpofotqrr7wqz2qkt7jhrzadcyalt5bax6xn3w2y45y7bx4muxci` (3,729 B) was read from inside `tables.car`, which records `part_size_bytes` 1,073,741,824. These files are tiny, so the legs prove **behaviour**, not throughput.

Probe: 5 rounds × 2 CIDs × 4 requests per gateway, 2026-10-21 00:13:11Z → 00:16:57Z.

| Gateway | Plain GET | TTFB p50 / max (ms) | Range `bytes=0-1023` | SHA-256 = CID digest | 429s | CORS GET (foreign Origin) | Preflight (`range`) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ipfs.filebase.io` | 200 (10/10) | 205–214 / 335 | **206** `bytes 0-975/976` | **10/10** | 0 | `ACAO *`, exposes `Content-Range` | 204, allows `Range` |
| `ipfs.io` | **429 (10/10)** | 160–165 / 246 | 429 | 0/10 | **30/30** | `ACAO *`, exposes `Retry-After, Sunset` | **521** |
| `dweb.link` | **429 (10/10)** | 173–222 / 241 | 429 | 0/10 | **30/30** | same as ipfs.io | **521** |
| `gateway.pinata.cloud` (extra, unplanned) | 200 (10/10) | 4,612–5,188 / 6,943 | 206 | 10/10 | 0 | `ACAO *` | 204, no `Access-Control-Allow-Headers` |

**Finding 3: ipfs.io and dweb.link no longer serve HTTP content.** Every request returned 429, with `Retry-After: 900`, `Sunset: Mon, 21 Sep 2026 00:00:00 GMT`, `Link: <https://gatewaychanges.ipfs.io/>; rel="sunset"` and the body "This IPFS gateway is switching to a service worker gateway only." `?format=raw` with `Accept: application/vnd.ipld.raw` gets a 301 to `trustless-gateway.link`, which returned **522** after 19.9 s (00:12Z). The notice at `https://gatewaychanges.ipfs.io/` (read 2026-10-21 ~00:12Z) says the public gateway retired for good on September 21 and points to self-hosting, a local node or IPFS Desktop / Companion. Also checked once (00:12Z): `w3s.link` 301, `4everland.io` 301, `nftstorage.link` 302, `inbrowser.link` 403, `storry.tv` 502, `ipfs.runfission.com` no connection.

**DuckDB-WASM through Filebase, cross-origin from the CloudFront page** (Jackson `property` part, 20 runs):

| Config | First load p50 / p95 | COUNT p50 / p95 | Statuses | Measured |
| --- | --- | --- | --- | --- |
| Default flags (full GET) | 3,200 / 4,044 ms | 8.0 / 8.6 ms | 200 × 160 | 00:28:13–00:29:20Z |
| Range flags (Finding 1) | 2,829 / 3,088 ms | 7.9 / 8.6 ms | 200 × 140, 206 × 60 | 01:51:35–01:52:35Z |

**Measured after D-8 (T067, 2026-10-21):** the same legs on A-03's own published CIDs, run `travis-202609-permits-20261021t103516z` (manifest CID `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i`). Same laptop and home network as the spike. Only `ipfs.filebase.io` and `gateway.pinata.cloud` were used (ipfs.io and dweb.link are retired, Finding 3).

Before the probe, `scripts/verify-manifest.ts` passed on both gateways, 2026-10-21 13:05:27Z: manifest bytes and SHA-256 match, plus 27 artifacts per gateway (the 4 CARs fetched by `carCid`), 28/28 lines `ok` on each, 0 × 429, `ALL ARTIFACTS VERIFIED`, exit 0.

CIDs probed, in rotation (sample *i* uses CID *i* mod 3): the manifest (`bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i`, 11,641 B), `car/travis-county.car` (`carCid bafkreie3bw7zbk6u5gxhvxu5k2y3i56s6zsyytc5gdyvyjpw4z5ky2cglu`, 78,543 B) and the largest table part `tables/county/structure/part-00000.parquet` (`bafkreiecvp3swldglp2sz2zkkz4xlcu6whllr4njm2d75mda6rsqnkmwla`, 10,298 B). Per gateway, 10 samples of each leg: plain GET, GET `Range: bytes=0-1023`, CORS GET with `Origin: https://probe.countylens-foreign.example` + `Range`, and `OPTIONS` preflight asking for `range`. TTFB is the time to response headers of the plain GET. These CIDs had just been fetched by verify-manifest, so the gateway caches were warm. 2026-10-21 13:08:35Z → 13:11:17Z.

| Gateway | Plain GET | TTFB p50 / max (ms) | Range `bytes=0-1023` | SHA-256 = CID digest | 429s | CORS GET (foreign Origin) | Preflight (`range`) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ipfs.filebase.io` | 200 (10/10) | 70 / 316 (min 64) | **206** (10/10), `bytes 0-1023/<size>`, 1,024 B | **10/10** | 0 | 206, `ACAO *`, exposes `Content-Length, Content-Range` | 204, `ACAO *`, allows `Content-Type, Range, User-Agent, X-Requested-With` |
| `gateway.pinata.cloud` | 200 (10/10) | **4,450 / 6,729** (min 3,680) | **206** (10/10), `bytes 0-1023/<size>`, 1,024 B | **10/10** | 0 | 206, `ACAO *`, exposes `Content-Length, Content-Range` | 204, `ACAO *`, **no `Access-Control-Allow-Headers`** |

Pinata again answers 3.7–6.7 s per request even for 10 KB, as in the spike, and its preflight does not allow `Range`, so a browser cannot range-read through it cross-origin. Filebase stays the only gateway fit for the browser fallback; Pinata is a verification gateway only.

**DuckDB range reads through Filebase on a real table part**, measured with **node DuckDB as the stand-in for DuckDB-WASM** (`@duckdb/node-api` 1.5.6-r.2 with the locally installed `httpfs`, autoinstall off; same DuckDB reader, not the browser build). `SELECT count(*) FROM read_parquet('https://ipfs.filebase.io/ipfs/bafkreiecvp3swldglp2sz2zkkz4xlcu6whllr4njm2d75mda6rsqnkmwla')`, a fresh instance per run (cold, HTTP metadata cache off), 10 runs, 2026-10-21 13:11:34Z → 13:11:37Z:

| Part | Runs | Rows | First query p50 / max (ms) | Requests per run (DuckDB HTTP log) |
| --- | --- | --- | --- | --- |
| `tables/county/structure/part-00000.parquet` (10,298 B) | 10 | 14 | **290 / 618** (min 286) | `HEAD` 200, then one `GET Range: bytes=0-10297` → **206** |

The part is smaller than DuckDB's read-ahead, so the whole file comes back in one ranged GET; the multi-range footer and column-chunk pattern of Finding 1 needs a part larger than this run has. **Size-dependent throughput through Filebase is still unmeasured:** this pilot run's largest public file is 78.5 KB, so these rows prove behaviour and per-request latency on our own CIDs, not MB/s.

## Filebase plan limits (AD-22)

Read 2026-10-21 ~00:13Z from `https://filebase.com/pricing/`:

| Plan | Price | Storage (Object + IPFS) | IPFS egress | Pinned IPFS files | Class A / B ops | Dedicated gateways | IPNS names |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Free | $0 / month | 5 GB | 10 GB | **500** | 100K / 1M | 1 | 1 |
| Pro | $7.50 / month | 500 GB (+ $0.015 / GB) | 250 GB (+ $0.015 / GB) | unlimited | 1M / 10M | 5 | 100 |

`https://filebase.com/docs/account/faq` (the docs FAQ redirect, read ~00:14Z) gives no free-tier figures. It says closing an account requires "less than 5 GB", the S3 API limit is 500 requests/s per account, and the maximum object is 5 GB per PUT (5 TB multipart). The pricing page lists no maximum file size. The plan's earlier note of "1 GB free on the pricing page" no longer holds: both pages now say 5 GB.

**Verdict:** the free plan holds **one** full-county publication (projection 2.95 GB < 5 GB). It does **not** hold a second full run kept pinned beside the first (2 × 2.95 = 5.90 GB > 5 GB), because published CIDs never change and old runs stay pinned. It also will not hold more than three full-CAR downloads a month (3 × 2.74 GB = 8.2 GB; four exceed the 10 GB egress). Under AD-22 (paid only if the measured size needs it): **stay on Free for A-03** (one month of reroof permits is a few hundred KB). **Pro ($7.50 / month) becomes necessary at the first full-county run that sits beside another full run (A-11 / refresh).** That is a PO decision at A-11, not now.

## Projected full-county size

These are **projections**, linear in the per-entity slope of the A-02 pilot (22 TCAD properties, 43 permits), using the entity counts 493,246 assessed parcels (`docs/sources.md`, 2026-10-19T21:33:41Z) and 19,031 permit candidates (`docs/evidence/A-02.md`). The Parquet slope is corrected with a scale factor measured on the Austin table: Parquet data bytes per row are 430.7 B at 22 rows, 325.1 B at 43 rows and 80.6 B at 2,380,939 rows (factor 0.187 for the 22-row slope, 0.248 for the 43-row slope; measured 2026-10-21 ~01:30Z). CARs are dag-json blocks that are not compressed, so they get no correction.

| Artifact | Formula | Projection |
| --- | --- | --- |
| County CAR | 122,161 B / 22 × 493,246 | 2.739 GB |
| Property Improvement CAR | 71,148 B / 43 × 19,031 | 0.031 GB |
| County tables (corrected) | 42,357 B / 22 × 493,246 × 0.187 | 0.178 GB (upper bound without correction 0.950 GB) |
| Property Improvement tables (corrected) | 23,073 B / 43 × 19,031 × 0.248 | 0.003 GB (upper bound 0.010 GB) |
| **Total** | | **≈ 2.95 GB** (upper bound 3.73 GB) |

Per table, the largest is `structure`: 17.5 MB corrected, 93.4 MB uncorrected. The seven largest county tables are 14.6–17.5 MB corrected and 78–93 MB uncorrected. Relationship tables are mostly random 59-character CIDs, which compress far worse than permit text, so for them the **upper bound is the safer planning number**.

## Decision

1. **Files: CloudFront CID copy first, Filebase as the labelled fallback (AD-02 stands).** CloudFront served every byte with 206 range reads and correct CORS; unsigned and tampered requests got 403. Filebase is the only measured public gateway that serves our CIDs with Range + CORS at ~0.2 s TTFB, so it stays the labelled fallback. Pinata works but has a ~5 s TTFB and an incomplete preflight; it is not chosen.
2. **Queries: switch radius and roof-age to the Lambda DuckDB fallback (AC-4 rule), over the same Parquet.** Browser p95 for those two queries is 15–42 s on every variant, against a target of 3 s. The browser keeps the first load, COUNT and other small reads (p95 25–840 ms on 1g/128m), and stays the only place free-form SQL runs (P0-11). The fallback must be proved in A-03 on the hosted Lambda (see Lambda sizing and Known gaps).
3. **`export-tables --part-size 48m`.** Under the CLI rule, any cap ≤ 64 MiB seals every part as one row group no larger than the cap, so every part stays ≤ 50.3 MB **whatever the compression**. That is the bound NFR-06 Verify needs to hash a part in the browser. Larger caps were measured to break it: 96m gave parts of 53.3 and 53.8 MB on this table, 128m gave 92.3 MB, and 1g / 256m gave one 194.7 MB part. The cost is more footers per table. 48m made COUNT 11 s here, but that was 40 parts for a 2.38 M-row table. The real tables are projected at ≤ 93 MB each compressed (upper bound). Parts are cut on the uncompressed estimate, so a large table gets a few parts, not 40 (**projection:** about 2–4 for the largest county tables). Query cost moves to the Lambda anyway (decision 2). Pinned-file count stays small (projection: ≤ 2 parts × ~30 tables per run, well under Filebase Free's 500).
4. **Two client requirements for A-03** (from Findings 1 and 2): open DuckDB-WASM with `{ allowFullHTTPReads: true, forceFullHTTPReads: false, reliableHeadRequests: false }`, and upload the WASM pre-compressed (Brotli, `Content-Encoding: br`). Without them first load is 8.6 s (p95) and every file is downloaded whole.
5. **Verify cannot use ipfs.io or dweb.link (Finding 3).** AD-02 and NFR-06 name them, and they now fail on every request. This needs a PO decision (below). **Resolved (D-4, 2026-10-21):** Verify uses Pinata + Filebase with plain GETs; see "PO decision (D-4, 2026-10-21)".

### Lambda fallback sizing (DuckDB node, same Parquet)

| Run | Threads | COUNT p50 / p95 | Radius p50 / p95 | Roof-age p50 / p95 | Peak RSS | Measured |
| --- | --- | --- | --- | --- | --- | --- |
| Local files, 48m, 20 runs | 1 | 8.3 / 9.4 ms | 165 / 175 ms | 75 / 77 ms | 76 MB | 02:10:45Z |
| Local files, 1g, 20 runs | 1 | 2.5 / 2.7 ms | 160 / 174 ms | 72 / 76 ms | 68 MB | 02:10:51Z |
| Local files, 48m, 20 runs | 2 | 5.0 / 5.3 ms | 90 / 96 ms | 41 / 42 ms | 84 MB | 02:10:55Z |
| Local files, 1g, 20 runs | 2 | 2.5 / 2.7 ms | 87 / 94 ms | 39 / 42 ms | 73 MB | 02:10:58Z |
| Laptop → CloudFront signed URLs, 48m, **5 runs** (link-bound upper bound, not Lambda) | 2 | 4,641 / 4,656 ms | 17,688 / 18,126 ms | 12,899 / 13,008 ms | 81 MB | 02:11–02:14Z |

Verdict: DuckDB compute for these queries is ≤ 175 ms at p95 on one thread and needs < 100 MB of memory. The time is all in moving bytes: radius needs ~85.6 MB of column chunks and roof-age ~38 MB (browser-measured on 48m). **Projection (not measured):** a Lambda in eu-north-1 reading from CloudFront/S3 meets p95 < 3 s only if it sustains ≥ 85.6 MB / 2.8 s ≈ **31 MB/s** of parallel range reads. **Size:** 1,769 MB memory (1 vCPU; the memory is for the vCPU, not the < 100 MB working set), DuckDB `threads = 2`, timeout 15 s, no reserved concurrency (account limit 10, AD-11). Keep the query result ≤ 1,000 rows (AD-21). If the hosted p95 in A-03 is still ≥ 3 s, the next lever inside AD-01 is a two-step query: filter on `latitude`/`longitude` alone, then fetch only the matching rows' other columns. That cuts the bytes read without a second dataset.

## Amendment 1 (A-16, 2026-10-26): per-run Explore index for the Lambda path

**Status:** Accepted by the PO with A-16 G5 (2026-10-26); PO chose option (a) on 2026-10-25/26 (`DEC-A-13-explore-full-county.md`, "To close it").

**Why:** decision 2 above holds at the 14-property slice, but on the full county (441,961 properties, 15,025 permits) the Lambda binds every table part and joins inside the request: `explore.search` ran out of memory at 1 GB and then hit the 29 s HTTP API limit on every call; the agent and MCP data tools fail the same way (`DEC-A-14-agent-mcp-full-county.md`).

**What changes:** for a full-county run the Lambda (API, agent, MCP) reads a **per-run Explore index** instead of binding the published parts per request:
- The index is the four contract views (`v_property`, `v_roofing_permit`, `v_contractor`, `v_run`) materialised to Parquet with exactly the published columns, plus `index.json` recording the run's manifest CID, every source part's name, CID and SHA-256, and `viewsSha256` (the hash of the view SQL it was built with).
- It is built on the operator laptop only from the run's **published** parts (fetched from the CloudFront CID copy, each SHA-256 checked against the CID-verified manifest), never from the Query DB, and stored privately at `s3://<CID-copy bucket>/private/explore-index/<manifestCid>/`. It is derived data, not a new publication: every row still carries its published `cid`, `table_cid` and `manifest_cid`, so anyone can re-check an answer against IPFS.
- The reader refuses an index whose `manifestCid` or `viewsSha256` doesn't match (`index_stale`), and a full-county run without an index answers `index_not_built` with a reason instead of attempting the whole-county join. Small runs keep the direct bind.
- The browser path (decision 1, SQL panel, Data · Verify) is unchanged.

**Measured (machamp, laptop, 2026-10-26):** Run 2 build 75 s (160 parts, 356.5 MB fetched, SHA-checked), index ~42 MB; Explore cases 68–188 ms against the index versus 29 s timeouts today. Run 3 built from local parts in 17 s. Hosted cold/warm p95 to be measured in A-16 (target < 3 s).

**Constitution:** P0-1 (Query DB private) and "consumers read only published CIDs" hold: the index is a cache of published data, rebuildable and verifiable from the manifest. Zero idle cost holds: S3 storage cents only.

## Known gaps

- **The Lambda fallback's p95, measured in-region in A-03 (2026-10-21, closes the earlier gap "not measured in-region").** Method set by D-4 ("Private prefix + direct invoke"): 1 warm-up + 20 timed direct `aws lambda invoke` runs per query × preset on the hosted API Lambda (eu-north-1) over a private-prefix copy of the full Austin table in `CountyLensData` (40 parts, 2,380,939 rows), 2026-10-21 16:15:31Z–16:17:04Z, TC-NF-05 in hosted run 2 (build `fbdb68b`; `specs/003-walking-skeleton/run-log.md` 19:33). Sizing now deployed (ERR-18 fix, `a1fd50a`): Lambda arm64 **3,008 MB**, DuckDB `threads = 4`, warm read cache, timeout 15 s, no reserved concurrency; this replaces the 1,769 MB / `threads = 2` projection above. `queryDurationMs`, p50 / p95 (first query in a fresh sandbox), all < 3,000 ms p95:

  | Query | Preset | p50 | p95 | First query |
  | --- | --- | --- | --- | --- |
  | count | TC_NF_05 | 3 | 5 | 6 |
  | radius | TC_NF_05 | 189 | 200 | 2,818 |
  | roofAge | TC_NF_05 | 85 | 95 | 82 |
  | radius | ADR_0001 | 191 | 200 | 186 |
  | roofAge | ADR_0001 | 85 | 93 | 80 |

  The bench copy was refused publicly (CloudFront 403, API 400 / 404) and the private prefix was emptied afterwards (all 40 keys HEAD 404 at 16:17:14Z). Hosted run 1 at 1,769 MB had missed the target (radius p95 6,194 ms, roof-age 4,988 ms; ERR-18). Evidence: `docs/evidence/A-03.md` § AC-4.
- **Filebase at scale is still unmeasured** (A-11). The gateway rows on A-03's own CIDs were measured after D-8 (T067, 2026-10-21 13:05–13:11Z), but this run's largest public file is 78.5 KB, so they show behaviour and per-request latency, not throughput.
- **The Parquet is a proxy:** DuckDB with the CLI's codec, level, row-group budget and part rule, not `hyparquet-writer` itself. Statistics and page layout may differ.
- Network: one laptop on one home network and one edge (MRS). The browser numbers are dominated by round-trip time, so they will differ by location.
- Roof-age cold on 128m was not run (time box). 1g and 48m bracket it.
- The projected size rests on a 22-property / 43-permit pilot slope. The real CAR size is known only after the first full run.

## Needs a PO decision

All three were resolved on 2026-10-21 (PO decision D-4, round R3); the outcome follows each item.

1. **Verify gateways (NFR-06, AD-02).** ipfs.io and dweb.link return 429 to every HTTP request since their 21 Sep 2026 retirement. Options: (a) Verify through Filebase + Pinata (two independent public gateways that worked today; Pinata preflight lacks `Access-Control-Allow-Headers`, so Verify must use plain GETs); (b) the service-worker gateway (`inbrowser.link`) or Helia verified fetch in the browser; (c) Verify in our API from a kubo node. Today only (a) is measured.
   **Resolved:** option (a), "Pinata + Filebase (Recommended)". Plain GETs, size + SHA-256; the CloudFront copy and `w3s.link` stay rejected.
2. **AC-4 path:** accept the switch of radius and roof-age to the Lambda DuckDB fallback (this record), with the in-region p95 proved in A-03.
   **Resolved:** "Accept (Recommended)". The in-region p95 is proved by "Private prefix + direct invoke (Recommended)": 20 timed direct invocations over a private copy of the full table, deleted afterwards.
3. **Filebase plan:** Free now; decide on Pro ($7.50 / month) at A-11, when a second full run would be pinned.
   **Resolved:** "Accept (Recommended)". Free for A-03; Pro is a PO decision at A-11.

## Teardown proof

Before the deploy (2026-10-20 23:58Z): `aws s3 ls` listed only `cdk-hnb659fds-assets-515618610572-eu-north-1`; `aws cloudfront list-distributions` returned `null`.

Teardown at 2026-10-21 02:14:22Z → 02:17:41Z:

```text
$ AWS_PROFILE=assess npx cdk destroy CountyLensSpike --force
CountyLensSpike: destroying... [1/1]
✅  CountyLensSpike: destroyed

$ rm -f ~/.config/assessment/spike-cf-key.pem      # private signing key deleted
$ ls ~/.config/assessment/
ai-gateway.env
filebase.env

$ aws s3 ls --profile assess
2026-10-16 10:07:50 cdk-hnb659fds-assets-515618610572-eu-north-1
$ aws cloudfront list-distributions --profile assess --query "DistributionList.Items[].[Id,DomainName,Comment]"
null
$ aws cloudfront list-public-keys --profile assess --query "PublicKeyList.Items[].Id"
null
$ aws cloudfront list-key-groups --profile assess --query "KeyGroupList.Items[].KeyGroup.Id"
null
$ aws cloudformation describe-stacks --stack-name CountyLensSpike --profile assess
An error occurred (ValidationError) when calling the DescribeStacks operation: Stack with id CountyLensSpike does not exist
```

The spike bucket `countylensspike-data666c94c7-lqapeoxy0sbl` (emptied by `autoDeleteObjects`), the distribution `E2A0OOBLCHZARF` (`dasmdsre65gli.cloudfront.net`), public key `K23MXSP8XO2OI1` and its key group are gone. The only remaining spike files are two CDK deploy assets in the shared bootstrap bucket (2026-10-21 02:58 EEST): `c453f3b2…17a5.json` (12,674 B, the synthesized template) and `faa95a81…a7d6.zip` (2,173 B, the auto-delete handler code). They hold no data. Deleting from the shared bootstrap bucket was blocked by the agent permission policy, so the user decides whether to remove them. The local Austin JSON and Parquet stay in `pipeline/data/raw/austin-full/` and `pipeline/data/raw/austin-parquet/` (gitignored, never uploaded anywhere public). `spikes/read-path/` keeps only source; `node_modules/`, `cdk.out/`, `dist*/`, `results/`, `*.pem` and `outputs.json` are gitignored or deleted.
