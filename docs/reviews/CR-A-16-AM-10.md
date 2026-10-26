---
id: CR-A-16-AM-10
type: code-review-log
story: A-16
branch: 016b-second-copy-and-gateways
reviewed_commit: 9f830ef
tools: [metagross, audino, oracle, "/code-review medium"]
created: 2026-10-26
---

# Code Review Log: A-16 AM-10 (second copy on Pinata, Pinata + orbitor gateways)

One review round on the AM-10 work (tasks T075–T079), read-only, in parallel on 2026-10-26. Pass mark 75. `oracle` reviewed the publish tools because they are A-11 publication code; `machamp` (A-16's batch reviewer) has nothing to review here (no queue, scheduler or batch job changed).

## Scores

| Reviewer              | Scope                                                       | Score | Result                                 |
| --------------------- | ----------------------------------------------------------- | ----- | -------------------------------------- |
| metagross             | shared, web, infra, CI, e2e                                 | 86    | PASS                                   |
| audino                | Verify, Manifest, Compare UI                                | 78    | PASS                                   |
| oracle                | `verify-manifest`, `pipeline/publish` verify + Pinata copy  | 76    | PASS                                   |
| `/code-review medium` | whole branch diff (run on `0009c69`, after the first fixes) | —     | 10 candidates, 9 fixed, 1 kept (below) |

## PO decision taken during the review

Both audino (1) and oracle (5) found that calling Pinata "independent" while it also holds our second copy contradicts demoting Filebase for the same reason. PO decision 2026-10-26, "plain facts": independent means a public gateway CountyLens does not operate, with bytes hash-checked against the manifest (the README wording). Pinata and orbitor are the two counted gateways; each lane states its facts (orbitor holds no copy of ours; Pinata also holds our second copy; Filebase is our main storage host, a fallback that is not counted). AM-10 was reworded to match.

## What was fixed

| Finding                                                                                              | Fix                                                                                                                                                                                      | Commit     |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| oracle 1 (High): multipart filename was the full repo path; Pinata could treat it as a folder upload | file part sent as `basename(name)`; full path only in `pinataMetadata.name`; test asserts no `/`                                                                                         | `0009c69`  |
| oracle 2: no timeouts on Pinata calls                                                                | size-scaled upload timeout, 30 s reads; a write timeout is an error, not resent                                                                                                          | `0009c69`  |
| oracle 3: manifest CID cross-check failed open                                                       | every manifest needs an expected CID (`runs/index.json`, `--manifest-cid` or `path=cid`), must parse as `RunManifestV1`, `runId` must match                                              | `0009c69`  |
| oracle 4: `--json` evidence overstated resumed checks                                                | resume key includes the CID; resumed checks recorded `resumed: true` with null bytes; verdict says how many were resumed                                                                 | `0009c69`  |
| oracle 6: re-run overwrote `pinned` receipts                                                         | existing `pinned` receipt kept; `summary-<ts>.json` per run                                                                                                                              | `0009c69`  |
| oracle 7, 8, 9, 10                                                                                   | budget flags capped by quota; no unpin of a pre-existing duplicate; every manifest in `runs/index.json` copied by default; stale exit-code comment                                       | `0009c69`  |
| audino 2: green ✓ and "verified" label on the Filebase lane                                          | neutral info glyph, "Bytes match the manifest · our storage host, not counted"; test                                                                                                     | `0009c69`  |
| audino 3 / metagross 2: "no match" when a lane only gave up                                          | warning pill and reason line ("no readable answer after retries"); "bytes differ" only for a mismatch                                                                                    | `0009c69`  |
| audino 4 / metagross 7: heading order                                                                | "Counted gateways" h3, lanes h4, fallback group h3; test                                                                                                                                 | `0009c69`  |
| audino 5: half-width Filebase card at ≥ 840 px                                                       | fallback card spans both columns                                                                                                                                                         | `0009c69`  |
| audino 6 / metagross 4, 5: Stored on wording, duplicate label, position on Manifest                  | quota wording, duplicate `aria-label` removed, card after the manifest provenance                                                                                                        | `0009c69`  |
| metagross 1: hosted e2e depended on Filebase and did not assert the AM-10 result                     | `expectVerified` checks only the counted lanes; TC-020 and TC-021 assert `data-verify-result`                                                                                            | `0009c69`  |
| metagross 3: host literal vs "no host literal" comments                                              | comments state the orbitor default and the Pinata asymmetry                                                                                                                              | `0009c69`  |
| code-review 1: `--sample` read the CAR from neither counted gateway                                  | CAR read from orbitor (counted) and Filebase; only Pinata skipped (CAR 429s); "ONE counted gateway" note; line `SAMPLE VERIFIED N of M artifacts (the CAR on orbitor and Filebase only)` | this round |
| code-review 2: wrong manifest bytes from Filebase failed the run                                     | loud `WARNING`, recorded in `warnings`; never fails the run when both counted gateways match                                                                                             | this round |
| code-review 3: a manifest upload error did not stop the copy                                         | stops before any table upload (`stopped: "error"`)                                                                                                                                       | this round |
| code-review 4: budget not refunded after an error or unpin                                           | reservation refunded (kept only when an unpin itself failed)                                                                                                                             | this round |
| code-review 5: resumed lines seeded later resumes                                                    | `parseResumeLog` ignores resumed lines                                                                                                                                                   | this round |
| code-review 6: page pill was an error when a lane only gave up                                       | warning pill unless a counted lane's bytes differ                                                                                                                                        | this round |
| code-review 7: index runIds not path-checked                                                         | same `SAFE_RUN_ID` check as `--run-id`                                                                                                                                                   | this round |
| code-review 8: two tools disagreed on "exact JCS bytes"                                              | both compare against `jcsBytes(parsed RunManifestV1)`                                                                                                                                    | this round |
| code-review 9, 10: duplicated retry policy and gateway labels                                        | `pipeline/publish/src/backoff.ts` and `gateways.ts`, imported by both tools                                                                                                              | this round |

Kept: none of the code-review candidates was rejected. The Runs · Compare page needed no change for code-review 6 (it shows no error pill for a gateway miss); a test pins that.

## Not covered by this round

- The hosted Playwright specs (`tests/e2e/A-13-verify.spec.ts`, `verify-manifest.spec.ts`) were updated and type-check, but run only against the deployed preview (Stage 6).
- The Pinata copy has run only against fakes. The real run (T080) starts with `--first-only` on the Run 3.1 manifest and stops on any CID mismatch.
