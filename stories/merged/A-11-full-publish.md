---
id: A-11
type: user-story
title: Publish the full county as verifiable CIDs (Run 1)
parent: FEAT-A11
vision: VIS-A
ard: ARD-A
eval_point: A4
priority: P1
moscow: Must
branch: 011-full-publish
spec: specs/011-full-publish/
depends_on: [A-10]
size_days: 1
agents:
  design: [oracle]
  builder: oracle
  reviewers: [oracle, donphan]
  verify: "`verify-manifest` on 2 gateways"
skills: [use-oracle, apply-engineering-guidelines]
ui: false
status: Merged
merged_into: A-11
merged_on: 2026-10-21
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---

# A-11 Publish the full county as verifiable CIDs (Run 1)

> **Merged on 2026-10-21 into [A-11 Publish the full county by CID and keep it current with incremental runs](../A-11-publish-and-runs.md).** Kept for history only: do not plan, build or gate this file. Its ACs are now AC-1 to AC-6 there, each tagged with its old ID.

| Field | Value |
| --- | --- |
| Evaluation point | A4 (primary) · A1 |
| Demo line(s) | D-5 (artifact manifest), D-6 (two independent gateways) |
| Agents | design `oracle` · builder `oracle` · reviewers `oracle`, `donphan` · verify `verify-manifest` on 2 gateways (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-10 |
| Size | 1 day |
| Branch | `011-full-publish`, merged into `feature/oracle-pipeline` |

## Context

The README's durability rule is that CIDs, not URLs, are the data's identity, and that a **third party with only the CIDs** can fetch everything after the candidate's environment is gone (AC-26 to AC-34). The **evaluator** opens the manifest and fetches an artifact from two public gateways this environment does not operate.

## Description

As an **independent retriever**, I want **every Run 1 artifact for Travis County published as CIDv1 with a manifest listing CID, name, size, codec and SHA-256, and CARs for every directory**, so that **I can fetch and check the exact bytes without depending on Oracle, Filebase or the candidate's laptop**.

When done: every data group goes through the fixed sequence validate → hash → validate CAR → `export-tables --atlas-page` → upload CAR → upload tables with readback (P0-2). `runs/{runId}/manifest.json` (`oracle-travis-run-manifest.v1`) and `runs/index.json` are committed and uploaded. CARs are attached to a GitHub Release (≤ 2 GB per asset) and pinned on Filebase plus a second independent pin (AD-22). The CID-copy uploader writes the S3 + CloudFront copy only after a size + SHA-256 match (AD-02).

**Overrides applied (ARD § 15, AD-30):** no `coverage.json`, `merge_stats.json` or sample extracts. Counts go in the manifest `coverage` section with `derivation` labels (AD-04, AD-28). The manifest lists only elephant-cli artifacts (CARs, table parts, the tables directory with its CAR) (AD-01). No IPNS field (AD-03). Atlas: if access exists, open the Atlas PR; otherwise `docs/atlas-pr.md` records it as a known gap ("public by CID; Atlas registration pending", P0-4).

**Independent test:** `npx tsx scripts/verify-manifest.ts runs/{runId}/manifest.json` prints `ALL ARTIFACTS VERIFIED`.

## Acceptance Criteria

1. **AC-1** · **Given** the reconciled Travis County data groups from A-04 to A-10, **When** publication runs, **Then** each group passes the six steps in order (a test asserts the order and that no step is skipped), and the run fails before writing the manifest if any upload readback fails. ☐ testable
2. **AC-2** · **Given** the Run 1 manifest, **When** it is validated with `RunManifestV1`, **Then** every artifact has a CIDv1 (`bafy…`), name, codec (`file` or `directory`), size and SHA-256, every directory has a `carCid`, no gateway URL is stored, and `previousManifestCid` is null for Run 1. ☐ testable
3. **AC-3** (scale) · **Given** the full-county manifest, **When** `verify-manifest` fetches every file artifact from ipfs.io **and** dweb.link, **Then** every size and SHA-256 matches, the script exits 0 and prints `ALL ARTIFACTS VERIFIED`; artifacts over 50 MB are verified by the CLI (NFR-06). ☐ testable
4. **AC-4** · **Given** the manifest `coverage` section, **When** it is read, **Then** it contains the published row count per table (`published_rows`), each source's capture-time total (`capture_receipt`: for example Austin permits and Comptroller Travis records at their watermarks, and the TCAD certified roll count), and merge and contractor-state aggregates (`aggregate_match`), and no count is computed from Query DB rows directly. ☐ testable
5. **AC-5** (missing data / error) · **Given** a gateway that returns 429, 504 or times out, **When** `verify-manifest` runs, **Then** it retries with backoff, reports that artifact as `unverified` with the gateway's response, exits non-zero, and never reports `ALL ARTIFACTS VERIFIED` without a digest match on both gateways. ☐ testable
6. **AC-6** · **Given** the CARs, **When** the release step runs, **Then** each CAR is attached to a GitHub Release (or split if over 2 GB), pinned on Filebase and on the second pin, and the release URL is recorded in `docs/evidence/A-11-manifest.md`. ☐ testable

## Edge cases (at least two)

- A table part over the gateway's single-response limit → the CLI does a ranged fetch and hashes the stream.
- dweb.link redirects to a subdomain gateway URL → follow the redirect; the bytes still match.
- Filebase plan too small for the measured size (RISK-02) → Starter plan for a month or a kubo node; recorded in the manifest limitations, run not published half-pinned.
- An artifact's CID copy already exists in S3 → uploader refuses to overwrite; checks it matches instead.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | System MUST publish only elephant-cli output in the fixed order with readback | AC-1 |
| FR-002 | System MUST write a schema-valid manifest with CIDv1, size, codec, SHA-256 and CAR per directory | AC-2 |
| FR-003 | System MUST verify every artifact on two independent public gateways | AC-3, AC-5 |
| FR-004 | System MUST carry counts in the manifest coverage section with derivation labels | AC-4 |
| FR-005 | System MUST keep three copies: Filebase, second pin, GitHub Release CARs | AC-6 |
| NFR-001 | 100% CIDv1; 6/6 CAR checks; 100% artifacts verified on both gateways (NFR-06) | AC-2, AC-3 |

## Prototype reference

Not a UI story. The manifest and verify screens are `design/prototype/DataManifest1440.dc.html` and `design/prototype/DataVerify1440.dc.html` (built in A-13).

## Demo Script

1. Presenter: "Show the published artifact manifest for this run." → Expected: every artifact with CID, size, name, codec and SHA-256; gateway URLs derived from CIDs; no IPNS (AD-03).
2. Presenter: "Retrieve one published artifact by CID from a public gateway that this environment does not operate, then again from a second independent public gateway." → Expected: both fetches succeed and match the manifest size and digest; the CLI output is shown for larger artifacts.

## Out of scope

- Incremental runs (A-12). The hosted Manifest and Verify screens (A-13).
- Atlas merge (pending access).

## Evidence to capture

- `docs/evidence/A-11-manifest.md`: manifest CID, artifact count and total size, release URL.
- `docs/evidence/A-11-gateways.md`: full `verify-manifest` output.
- `testplans/A-11-test-cases.md` results, `docs/reviews/CR-A-11.md`.

---

## Gate G4: Story ready for planning

| # | Criterion | Status |
| --- | --- | --- |
| G4-1 | Front matter complete (parent FEAT, eval point, branch, priority, **agents and skills from AGENT-MAP.md**) | ☐ |
| G4-2 | "As a / I want / So that" stated, with an independent test | ☐ |
| G4-3 | Every AC is Given / When / Then, and its testable box is ticked | ☐ |
| G4-4 | One scale AC and one missing-data or error AC | ☐ |
| G4-5 | At least two edge cases | ☐ |
| G4-6 | Every requirement traces to an AC; NFRs have thresholds | ☐ |
| G4-7 | Prototype screen linked (UI stories) | ☐ |
| G4-8 | Dependencies done, or stubbed with **real** sample data | ☐ |
| G4-9 | No `[NEEDS CLARIFICATION]` left | ☐ |
| G4-10 | AI pre-check (`developmentsupport-g4-precheck`): PASS | ☐ |

**Decision:** ☐ Ready ☐ Returned, reason: {…} · {date}
