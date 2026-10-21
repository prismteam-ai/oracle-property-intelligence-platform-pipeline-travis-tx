# Alakazam review: R5 hybrid permit text search (2026-10-21, read-only)

The CRM asked for an optional hybrid mode on `GET /v1/permits/text-search` (Titan Text Embeddings V2 vectors in DuckDB,
cosine fused with BM25, nullable scores, no OpenSearch, no standing cost), deployed by 20:30 EEST or skipped, with "your
alakazam review decides the details". Arceus routed the question to alakazam (`build-rag-systems` is authoritative) and
recommended skipping it today.

## Verdict

**No-go for 20:30.** A careful build takes about 6.5 h against 4.8 h left: the contract change (0.5 h), the serving
build with vectors, coverage and fixture (1.5 h), the hybrid query with a Bedrock adapter, a test adapter and a fallback
(1.5 h), IAM and CDK assertions (0.5 h), a labelled evaluation (1–1.5 h), and the gate, deploy and live check (1 h). It
would put a contract, IAM and image change on the live API being scored, hours before the deadline. The design is sound
once corrected and can ship in a later deploy.

## Facts used

541,942 text-indexed permits, 265,678 distinct `lower(trim(description))`, about 70 characters each. Titan V2 on demand:
6,000 requests a minute, one text per call; embedding every distinct description at about 93 a second takes about 47
minutes and costs about $0.10. `cohere.embed-v4:0` is also available (96 texts per call, int8 output).

## Corrections to the proposed design

- **Model:** Titan V2, 256 dimensions, normalized; query and corpus share model id, dimensions, normalize flag and int8
  rule, recorded in `/v1/meta.deploy`. Cohere v4 only if an evaluation shows Titan's vector side is weak; no local model.
- **Storage:** a separate read-only `vectors.duckdb` in its own image layer (int8, 256 dimensions, about 68 MB), attached
  at open, so `serving.duckdb` stays about 80 MB and the lexical cold path is unchanged. Not S3 Parquet (about 14 s cold).
  Measure int8 against float top-100 overlap (0.95 or more).
- **Duplicates:** score distinct descriptions, take the top 100 above a cosine floor, then expand to permits; vector rank
  `dense_rank` per description, BM25 `rank()`. A per-permit top 100 would be one common description ("REROOF") 100 times.
- **Fusion:** RRF, k = 60, equal weights; sort by `hybrid_score` desc, then `permit_id`.
- **Floor:** a calibrated cosine floor, so a nonsense query returns nothing.
- **`total`:** BM25 matches plus vector-only permits after filters, capped by the 100-description limit (not a recall
  estimate).
- **Fields:** `vector_score` and `hybrid_score`, null where they do not apply; `mode_applied`, so a Titan timeout (1.5 s,
  one try) degrades to lexical visibly.
- **Cold start:** load the Bedrock client only on the hybrid path; add a hybrid call to `just warm` and hybrid cases to
  the serving gate.
- **IAM:** `bedrock:InvokeModel` on the exact Titan V2 model ARN, API function only; revise section 20 and its CDK
  assertion on purpose.
- **Agent:** stays lexical (remove `mode` from its tool view) until a golden-set rerun shows a gain.
- **Refresh:** later deploys embed only new description keys from a cached key-to-vector file; check that every
  text-indexed permit with a description has a vector.

## Minimum evaluation before claiming it works

Twenty labelled queries (aliases, synonyms with no word overlap, misspellings, non-roof controls, nonsense and
stopword-only queries, the `roofing_only` and radius filters), the pooled top 20 labelled by hand; precision at 10,
nDCG at 10 and pooled recall, lexical against hybrid. Gates: hybrid at least as good on mean nDCG at 10 with no loss on
alias or exact queries; nonsense and no-match totals 0; lexical responses byte-equal to today's; three pages without
duplicates or gaps; the int8 overlap and coverage checks; live cold and warm p95 inside the CRM's 15 s.

## No OpenSearch

Acceptable as a recorded deviation: at this size an exact scan is more accurate than approximate search and avoids
OpenSearch's standing cost, which the README rules out. Conditions: exact brute-force scoring with DuckDB's built-in
array functions only (no `vss`, no HNSW); section 20's "embeddings go to OpenSearch … never to DuckDB" is rewritten by a
dated ruling; a recorded trigger to move to OpenSearch (more than about 2 million vectors, a warm vector step over 1 s,
or freshness needed without a redeploy); and a note that the README's DuckDB and no-standing-cost rules override the
kit's "use OpenSearch" rule.
