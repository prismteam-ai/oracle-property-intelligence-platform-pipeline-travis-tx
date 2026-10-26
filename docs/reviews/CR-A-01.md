---
id: CR-A-01
type: code-review-log
story: A-01
branch: 001-discover-sources
reviewed_commit: 7824e3b (run 3; run 2 at d0c540e; run 1 at 672f14f)
tools: [/code-review, soofi-xyz-team-kit:oracle]
created: 2026-10-20
---

# Code Review Log: A-01 Discover Travis County sources and pass readiness preflight

Scope: `git diff feature/oracle-pipeline...HEAD`. Reviewers: `/code-review` (default effort) and the kit reviewer agent `soofi-xyz-team-kit:oracle` (read-only; constitution XIII–XVII, pass mark 75/100).

## Runs

| Run | Tool | Effort | Date | Commit | Findings | Score |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `/code-review` | default | 2026-10-20 | `672f14f` | 10 | n/a |
| 1 | `soofi-xyz-team-kit:oracle` (read-only) | n/a | 2026-10-20 | `672f14f` | 16 (1 blocker, 5 major, 8 minor, 2 nits) | **72 / 100** (below 75) |
| 2 | `/code-review` (fix commits `672f14f..d0c540e`) | default | 2026-10-20 | `d0c540e` | 10 new | n/a |
| 2 | `soofi-xyz-team-kit:oracle` (read-only) | n/a | 2026-10-20 | `d0c540e` | 8 new (1 major, 4 minor, 3 nits) | **83 / 100** (pass) |
| 3 | `/code-review` (fix commit `cb6a808..7824e3b` only) | default | 2026-10-20 | `7824e3b` | 9 new, none Critical | n/a |

## Findings

Severity: Critical = blocks G7 (oracle "blocker", or data loss / evidence that misleads); Major; Minor; Nit. CR-n = `/code-review`, OR-x = oracle reviewer.

| # | Severity | File:line | Finding | Resolution | Commit |
| --- | --- | --- | --- | --- | --- |
| OR-B1 | Critical | `docs/evidence/blocked/bbb-20261020T072323Z.md:21`, `docs/evidence/A-01.md:57`, `docs/evidence/blocked/tcad_gis-20261020T072223Z.md:19` | BBB (Cloudflare challenge) was requested again from a different egress (VPN on during the 2026-10-19 run, off on 2026-10-20), against FR-006a/AC-6, while the evidence says "no retry with a changed identity". Intake item 5 says egress EG, but some 2026-10-19 receipts show Cloudflare `-LHR`. | Fixed: honest record (DEC-A-01-source-access D-1, D-3), corrected evidence, egress guard `travis/lib/egress.ts`; completed by N1 in run 2 | `d0c540e` |
| CR-3 / OR-M1 | Critical | `travis/discovery/workflow.ts:698`, `:857-862`; `workflow.ts:259`; `resolve.ts:51` | A resolution round re-assembles the whole catalog from the run journal and overwrites `travis-sources.yaml`, erasing every offline command's fields. The superseded run `travis` is still WAITING_HUMAN and is `resolve`'s default run id, so one `resolve` would replace the committed catalog with the 2026-10-19 journal. | Fixed: `catalogWriteRefusal` (`write-catalog.ts`), no default run id, `resolve` checks `discovery_run_id`; run `travis` killed (D-5) | `d0c540e` |
| OR-M2 | Major | `pipeline/docs/travis-sources.yaml:596-597`; `travis/discovery/reprobe-jurisdictions.ts:89-96` | San Leanna's HTTP 406 body says "blocked by Mod Security" (a WAF block), but it was re-probed and the catalog calls it "not a block". | Fixed: `wafSignal` (`source-client.ts`), re-probe refuses firewall rows; San Leanna reclassified; deviation D-3 | `d0c540e` |
| OR-M3 | Major | `pipeline/docs/travis-sources.yaml:751-753` | The parcel exception was written by hand, is not tied to the approved values (it would also pass a much larger gap), is not visible in the readiness report or `docs/sources.md`, and has no approval record stating the coverage effect. | Fixed: `approve-exception` command, check-catalog rule 10, `DEC-A-01-parcel-gap-exception.md`, section in `docs/sources.md` | `d0c540e` |
| OR-M4 | Major | `specs/001-discover-sources/spec.md:155`; `docs/evidence/blocked/tcad_gis-20261020T072223Z.md` | The US-runner probe rests on a TCP connect failure, which FR-006b says is not geo evidence; the PO approval is not reflected in the spec or AC-6. | Accepted: FR-006b and AC-6 amended with a dated PO clause (D-2), approved after the fact and stated as such | `d0c540e` |
| OR-M5 | Major | `pipeline/docs/travis-sources.yaml:5`; `docs/evidence/A-01-coverage.md:18`; `docs/sources.md:155` | Offline amendments are not stamped (`snapshot_time` predates captured values); `A-01-coverage.md` still says GIS not reached; `sources.md` lists `tcad_gis` as blocked while the row is available. | Fixed: `amendments[]` on every offline command, `render-coverage`, check-catalog rule 11, CI diff step | `d0c540e` |
| CR-1 | Major | `travis/lib/source-client.ts:765` | On a non-206 resume answer, `refusal()` reads the whole body into memory (`arrayBuffer()`); a full 200 of the 3.5 GB export exhausts the heap. | Fixed: `readBounded` (64 KiB) on refusals | `d0c540e` |
| CR-2 | Major | `travis/lib/source-client.ts:715` | `pump()` never listens for the `.part` WriteStream's `error` and awaits `drain` with no error path: a disk-full crashes the process or hangs the download. | Fixed (one path left: run-2 CR2-2) | `d0c540e` |
| CR-4 | Major | `travis/discovery/workflow.ts:851` | Permanent failures (validator hash mismatch, validator crash, schema-invalid catalog) throw plain Errors inside `ctx.run`, so Restate retries them forever. | Fixed: `PermanentFailure` / `TerminalError` | `d0c540e` |
| CR-5 | Major | `travis/discovery/record-gis-runner.ts:384` | Re-running `record-gis-runner` keeps the old `gap_reconciliation`, `account_breakdown` and `separately_assessed_without_geometry`, so the catalog can contradict itself. | Fixed: stale reconciliation dropped when the GIS count changes | `d0c540e` |
| CR-6 | Major | `travis/lib/source-client.ts:807` | The Content-Length check runs only when `resumes > 0`; a first download that ends short without an error is accepted as complete. | Fixed: size always checked; short file kept as `.part` | `d0c540e` |
| OR-m1 | Minor | `travis/discovery/parcel-gap.ts:35-48` | State-code meanings (A4, F4, O1) have no source; `condoUnit` is filled on 89% of O1 rows, so the O1 label is doubtful; "no export point" stands in for "no own GIS polygon"; the exception reason states the condo count as fact. | Fixed in wording: no official code table found; every reading marked unverified; O1 reworded | `d0c540e` |
| OR-m2 | Minor | `travis/discovery/reprobe-jurisdictions.ts:99-112` | The once-only re-probe rule relies on counting evidence files; superseded evidence (Austin) is not marked; a changed URL is a new probe, not a re-probe. | Fixed: `reprobe_count`, `superseded_evidence` on the row | `d0c540e` |
| OR-m3 | Minor | `.github/workflows/a01-us-gis-probe.yml:11-14` | The US probe fires again on any push that touches the file; its artifact expires after 30 days. | Fixed: `if: false` | `d0c540e` |
| OR-m4 | Minor | `travis/discovery/destination-proof.ts:72-152` | Both destination identities come from inside the same container; neither ties in the connection the A-04 loader will use. | Fixed: third identity through the configured connection (`prove-destination`) | `d0c540e` |
| OR-m5 | Minor | `pipeline/docs/travis-sources.yaml:693-707` | Webberville is classified with no Webberville evidence; the Census file is called "the official page"; the request channel did not answer. | Accepted (disclosed): Webberville marked unverified | `d0c540e` |
| OR-m6 | Minor | `austin_issued_located_here` rows | Austin-issued counts include ETJ (outside city limits); AC-4 uses full purpose only. | Fixed: full-purpose / ETJ split | `d0c540e` |
| OR-m7 | Minor | `docs/evidence/A-01-readiness.json` | The report says `auto_advance_required: true`; no artifact beside it says the kit's auto-advance is overridden. | Fixed: notes in `A-01.md` and `docs/sources.md` | `d0c540e` |
| OR-m8 | Minor | evidence, `travis/discovery/discover.ts` | The TCAD export was fetched more than once (`requests: 3`) though AC-3 says "downloaded once". | Fixed and disclosed: export reuse by receipt; `A-01.md` lists the requests | `d0c540e` |
| CR-7 | Minor | `travis/discovery/probes/tcad.ts:264` | ZIP scans destroy the inflate stream but not the underlying file stream: one leaked file descriptor per scan. | Fixed | `d0c540e` |
| CR-8 | Minor | `travis/discovery/probes/tcad.ts:630` | Local file names come from the URL basename only; two links with the same basename overwrite each other. | Fixed | `d0c540e` |
| CR-9 | Minor | `travis/discovery/record-gis-runner.ts:262`, `:417` | Duplicates the atomic write and the gap formula; rounds `gap_pct` to 2 decimals where `computeGap` rounds to 3. | Fixed (rounding: 3 decimals everywhere) | `d0c540e` |
| CR-10 | Minor | `travis/lib/zip-entry.ts:129` | A zero-size entry streams one stray byte. | Fixed | `d0c540e` |
| OR-n1 | Nit | `docs/evidence/A-01.md` front matter, "Live run" | Status still "in-progress"; the "Live run" section points to a report file that now holds the PASS result. | Fixed | `d0c540e` |
| OR-n2 | Nit | `pipeline/docs/travis-sources.yaml` | `waiting_human_hours` is not labelled with its run id. | Fixed | `d0c540e` |

### Run 2 findings

| # | Severity | File:line | Finding | Resolution | Commit |
| --- | --- | --- | --- | --- | --- |
| OR-N1 | Major | `docs/decisions/DEC-A-01-source-access.md:18` | D-1 said no request was repeated on 2026-10-19; the GIS host was contacted 4 times from the runs (two run ids, two `captured` rounds) and twice more by the operator | Fixed: D-1 lists all 7 GIS contacts with run, egress and result; review notes added to the three older GIS evidence files | this commit |
| OR-N6 | Nit | `docs/evidence/blocked/bbb-20261020T072323Z.md` | rewritten whole with changed line endings | Fixed: rebuilt from its first commit, only the corrected paragraph changed | this commit |
| CR2-1 / OR-N5 | Major | `travis/discovery/resolve.ts:87` | `resolve … captured` passes its checks, re-probes the county source, then the workflow refuses to write the amended catalog: a wasted county request and a dead run | Fixed: `resolutionWriteRefusal` refuses before sending (`resolve.ts:58`, test `review-a01.test.ts:202`) | `7824e3b` |
| CR2-2 | Major | `travis/lib/source-client.ts:816` | if the write stream fails during `reader.read()`, `drained()` waits on events that already fired: the disk-full hang can still happen | Fixed: write failure checked after each read; no wait on a dead stream (`source-client.ts:814`, test `source-client.resume.test.ts:429`, which timed out before the fix) | `7824e3b` |
| CR2-3 / OR-N2 | Major | `travis/lib/egress.ts:111` | the egress reference is the newest amendment, which can be the US runner's: the operator's own network would be refused and a US VPN accepted | Fixed: amendments carry `venue`; only operator amendments set the reference (`egress.ts:117`); catalog backfilled | `7824e3b` |
| CR2-4 | Major | `travis/discovery/write-catalog.ts:169` | design: the workflow refuses any amended catalog, so it can never write again; it should merge onto the amended catalog | Deferred to A-12 (PO 2026-10-20): incremental runs must write over an existing catalog, so the merge belongs there; for A-01 the committed catalog is final and the workflow refusing to overwrite it is the safe behaviour | |
| CR2-5 | Major | `pipeline/local-stack/services/app.ts:47` | the catalog is read outside a journaled step; a read or schema error is retried forever, and a replay can see a different catalog | Fixed: catalog read in the journaled step `catalog:prior-export`, terminal on failure (`workflow.ts:299-358`, tests `workflow.shell.test.ts:147`) | `7824e3b` |
| OR-N3 | Minor | `travis/lib/egress.ts`, `discover.ts` | the guard compares countries only; `discover` checks only when `ORACLE_EXPECT_EGRESS` is set | Deferred to A-04 (PO 2026-10-20): require `ORACLE_EXPECT_EGRESS` before the first ingest run; limit recorded in D-1 | |
| OR-N4 | Minor | `specs/001-discover-sources/spec.md:155` | the amendment asks for both checks to be saved; the TCP test and sibling-host control exist only as prose | Deferred (PO 2026-10-20): the checks are recorded as prose with times in the evidence file; no further GIS requests are made from the operator machine, so they cannot be re-captured lawfully | |
| CR2-6 | Minor | `travis/discovery/discover.ts:131` | any non-OK status answer is treated as "no existing run" | Deferred to A-12 (PO 2026-10-20): run handling is reworked there | |
| CR2-7 | Minor | `pipeline/local-stack/services/configured-db.ts:23` | its own "no system identifier" error is rewritten to "connection failed" | Deferred to A-04 (PO 2026-10-20): the destination proof is refreshed before A-04's first write | |
| CR2-8 | Minor | `travis/lib/source-client.ts:784` | refused-body size taken from a compressed Content-Length | Deferred to A-06 (PO 2026-10-20): next story that records blocked evidence at volume | |
| CR2-9 | Minor | `travis/discovery/record-gis-runner.ts:278` | builds placeholder measurements (`example.invalid`) to call `computeGap` | Deferred to A-05 (PO 2026-10-20): GIS gap logic is extended there | |
| CR2-10 | Minor | `travis/discovery/probes/tcad.ts:317` | the export reuse check re-hashes the whole 3.5 GB file every run | Deferred to A-04 (PO 2026-10-20): A-04 builds a one-time summary of the export so it is not re-read | |
| OR-N7 | Nit | `travis/discovery/reprobe-jurisdictions.ts` header | comment says the egress check runs last; DNS lookups run before it | Deferred (PO 2026-10-20): comment-only, fixed when the file is next changed | |
| OR-N8 | Nit | `travis/lib/source-client.ts` `WAF_BODY` | the "request blocked" pattern is broad (fails closed) | Deferred to A-06 (PO 2026-10-20): fails closed; tighten when more city portals are probed | |

### Run 3 findings (`/code-review` on the run-2 fixes only)

Closed by PO decision 2026-10-20 ("fix 4 majors, defer the rest"): no further review round for A-01. None is Critical, and none changes the A-01 catalog, validator result or evidence.

| # | Severity | File:line | Finding | Resolution | Commit |
| --- | --- | --- | --- | --- | --- |
| CR3-1 | Major | `travis/discovery/resolve.ts:103` | every `resolve` is refused against the amended catalog, so a waiting run could not be resolved | Deferred to A-12 with CR2-4 (workflow merges onto the amended catalog). No run is waiting today: `travis-2` completed, `travis` killed (D-5) | |
| CR3-2 | Major | `travis/discovery/resolve.ts:59` | the CLI pre-check is a copy of the workflow guard and can disagree with it; the root fix is the workflow skipping or reporting the publish | Deferred to A-12 with CR2-4 | |
| CR3-3 | Major | `travis/lib/egress.ts:123` | the newest operator amendment now outranks the run's own `discovery_egress`; an amendment written under an `ORACLE_EXPECT_EGRESS` override could move the reference | Deferred to A-04 (before the first ingest run): put `discovery_egress` first and require `ORACLE_EXPECT_EGRESS` (with OR-N3). Today every operator amendment records `EG` | |
| CR3-4 | Minor | `travis/lib/egress.ts:126` | amendments without `venue` are ignored as references | Deferred to A-04; the committed catalog is migrated | |
| CR3-5 | Minor | `travis/lib/source-client.ts:852` | `writeFailed()` treats an ended stream as failed if ever called after `closeOut()` | Deferred to A-04 (next large download); no current call path does this | |
| CR3-6 | Minor | `travis/discovery/workflow.ts:348` | the journaled prior export can be stale by the time a later re-probe uses it | Deferred to A-12 (long-lived runs) | |
| CR3-7 | Minor | `travis/discovery/backfill-amendments.ts:239` | venue knowledge in three places | Deferred (one-off migration, already run) | |
| CR3-8 | Minor | `travis/discovery/backfill-amendments.ts:273` | duplicated refusal-handling block | Deferred (one-off migration) | |
| CR3-9 | Minor | `travis/discovery/resolve.ts:106` | every exception reported as "catalog unreadable" | Deferred to A-12 with CR3-1 | |
| T056-1 | Minor | `travis/discovery/workflow.ts:~167` (`resolveHint`) | after T056, the run's next-step hint still offers `captured` for 403/challenge blockers, which the CLI now refuses (misleading text, refusal holds) | Fixed in T066 (converge pass 2): the hint and `docs/sources.md` say `still-blocked` after a 403, challenge or WAF block and `captured` only after a timeout, network error, throttling or broken download; tested in `review-a01.test.ts` | `de1b54e` |
| T056-2 | Minor | `travis/discovery/workflow.ts` resolution loop | the internal loop does not repeat the T056 check; every resolution reaches it through the guarded handler, so it is unreachable from outside | Deferred to A-12 with CR3-1 | |

## Oracle reviewer, run 1 (72/100)

Strengths: the vendored validator is unmodified and hash-checked; every source guardrail (one identified User-Agent, two per host, backoff only on 429/5xx, stop on 403/challenge/timeout, resume with the same identity) sits at one HTTP boundary with tests; the parcel block is honest (raw 24.24% printed, residual called unexplained); `pID` proven on 493,246 records; Census-based jurisdiction set (23 rows); offline commands refuse before sending; `docs/sources.md` re-renders byte-identically.

Services: Restate plus local Postgres, the vendored validator and the streaming export scan are the right choices; the offline commands as a second write path into the workflow's catalog are the main reservation (OR-M1), and a US-runner venue for A-05 GIS paging needs an ARD decision (rule 10).

Confidence: high on OR-B1, OR-M1, OR-M2, OR-M3 and OR-M5 (reproduced from files and local Restate state); medium on OR-m1 (state-code meanings unverified). No third-party requests were made.

## Constitution and architecture check

| Rule | Result | Note |
| --- | --- | --- |
| Zod on every tRPC input; no `any` | n/a / ✅ | no tRPC in A-01; catalog and command inputs are Zod-validated |
| LLM calls only through the Vercel AI SDK | n/a | no LLM calls |
| Powertools logger, tracer and metrics in every Lambda | n/a | no Lambda in A-01 (local Restate stack) |
| No secrets or PII in code or logs | ✅ | gitleaks on git history: no leaks; one public Application Insights key suppressed by fingerprint |
| P0 rules in `docs/architecture-constitution.md` | ⚠️ | run 1: source etiquette breached (OR-B1, OR-M2) and the geo-evidence rule (OR-M4); now recorded as PO deviations and a dated rule amendment (DEC-A-01-source-access), with an egress guard; country-level only (OR-N3) |

## Oracle reviewer, run 2 (83/100, pass)

Every run-1 finding is Fixed or Accepted as a recorded PO decision (table above). Strengths: the stale-run overwrite is closed in two layers; the `amendments[]` trail is auditable and rendered; the exception binding is enforced in CI; the download path has targeted tests for memory, disk and short files; unit tests block real network calls; deviations are written plainly. Confidence: high on N1, N2, N3, N5 (from evidence files and code paths); medium on the download fixes (unit tests only, no real large download). Disclosed by the builder: one interim test run sent a few requests to `cloudflare.com/cdn-cgi/trace` (no county, city or BBB host); `test/setup-no-network.ts` now blocks real `fetch` in unit tests.

Checks at `d0c540e`: 490/490 unit tests, typecheck, lint, format; `check-catalog` rules 1–11 PASS; validator exit 0, overall PASS.

Checks at `7824e3b`: 496/496 unit tests, typecheck, lint, format; `check-catalog` rules 1–11 PASS; validator exit 0, overall PASS.

**Open Critical findings:** 0. Run 2's four fixed majors are closed; CR2-4 and run 3's findings are deferred with an owning story (A-04 or A-12) by PO decision 2026-10-20. Final oracle reviewer score: **83 / 100** (run 2).
