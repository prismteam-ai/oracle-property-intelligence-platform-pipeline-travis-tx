# Phase 0 research: A-11 Publish and runs

## Correction (2026-10-23, during Stage 5 build)

Everything below describing a 5-group design (`county`, `property_improvement`, `owner`,
`contractor`, `parcels`) was wrong, discovered while checking what the Run 1 dry run would
actually process. The real lexicon manifest this pipeline fetches (confirmed from a captured
`capture/lexicon/receipt.json`) only defines **`seed`, `county`, `propertyImprovement`** — no
separate owner/contractor/parcels groups exist. Checking the existing transform code confirmed
owner fields and parcel geometry are already embedded inside `county`'s per-record export (a
`geometry.json` file per record; `ownerOutcomes` computed straight from county records in
`run-month.ts`'s summary). The one real gap is that A-07's contractor-identity resolution
(22,084 rows, AD-05's five states) was never wired into `property_improvement`'s permit records
— that is new, scoped work (adding `contractor_company_cid`/`contractor_resolution` fields to
each emitted permit, plus 3 coverage-count keys), not a new publish group.

`DataGroup` is back to `"county" | "property_improvement"` in `sequence.ts`/`manifest.ts`. The
sections below are kept for their still-valid reasoning (second pin, Filebase sizing, AC-10's
"same CIDs" meaning, the approval-gate disagreement) — ignore every mention of 5 groups or of
`owner`/`contractor`/`parcels` as separate publish groups in what follows.

**Second correction, same day, found during T031's build:** contractor identity also cannot be
*scalar fields on the published record* — ADR-0002 (`docs/decisions/0002-lexicon-carriers.md`,
binding) already ruled this out: the live lexicon schema cache is `additionalProperties:false`
with no contractor property, and ADR-0002's own verdict names the sanctioned path as a manifest
`coverage` rollup (AD-24), never a record field. T031 implements that: the five AD-05 states
reach an internal classification-ledger field and the coverage rollup only.

---


All items below were resolved by the Stage 3 design consult (`agent-design.md`) and decision round R2 (D-2, D-3); none reach Phase 1 as open `NEEDS CLARIFICATION`.

## Second independent pin (AD-22)

- **Decision**: Pinata, using its Kubo-RPC-compatible pinning endpoint.
- **Rationale**: the kit's existing `upload --api` CLI already speaks Kubo RPC against Filebase; Pinata exposes an equivalent endpoint, so no new upload client code is needed — only a second credential and a second `--api` target. Credentials: `PINATA_JWT` in `~/.config/assessment/pinata.env` (chmod 600), loaded the same way as `filebase.env`.
- **Alternatives considered**: Storacha/web3.storage (oracle's first pick) — rejected for Run 1 because its current API (w3up) is not Kubo-RPC compatible, so it would need new client integration code this late in the story; a self-run kubo node — rejected as ongoing-uptime scope creep for what is meant to be a one-time durability requirement.

## Filebase plan sizing (RISK-02)

- **Decision**: do not pre-emptively upgrade. Measure the actual Run 1 (and cumulative Run 1+2+3) size against the free 5 GB plan; upgrade to Filebase Starter for one month only if the measured total actually exceeds it.
- **Rationale**: projected size (2.95–3.73 GB) fits one full publication on the free plan; Run 2/3 only add changed-group CARs, which should be small. Upgrading without measuring is unjustified cost.
- **Alternatives considered**: upgrading immediately — rejected, premature; unpinning old runs from Filebase to make room — rejected, needlessly weakens durability (still legal under FR-008 via the second pin + Release, but not the first choice) when a $10/month Starter upgrade is cheaper than the durability risk.

## AC-10 idempotency — what "same CIDs" means

- **Decision**: AC-10's "same inputs → same CIDs" refers to the **data-group CAR and table CIDs** (genuinely content-addressed, pure functions of the bytes), not the per-run **manifest** CID, which legitimately differs between identical re-runs because the manifest records `startedAt`/`finishedAt`.
- **Rationale**: without this distinction AC-10 is unsatisfiable as literally written — the manifest CID can never repeat while timestamps are present, and the spec's success criterion (SC-003) is about reproducing published data, not reproducing a manifest with identical metadata.
- **Documented in**: `testplans/A-11-test-cases.md`'s AC-10 case, and the plan's Project Structure notes below, so a reviewer scoring AC-10 checks the group CIDs, not the manifest CID.

## Scheduled Fargate run vs. the human D-8 approval gate

- **Decision**: the Fargate entrypoint calls a non-interactive `publishRun`-equivalent that still applies the full six-step validate/hash/validate-CAR/export-tables sequence as a built-in automated gate (upload only proceeds if every step through `export-tables` succeeds); it is never a bypass of readback-before-manifest, and never skips validation.
- **Rationale**: resolved per the walkthrough's own disagreement rule (AD wins; otherwise the area owner decides) — this is a publish-flow design question, and oracle owns publication/runs. machamp's infra target (the Fargate task) just needs an entrypoint oracle exposes; it does not need to invent its own approval policy.
- **Open follow-up for tasks**: G-RUN (oracle) must expose this non-interactive entrypoint explicitly as a task; it does not exist in the current CLI (which is approval-gated and interactive by design per CR-A-03 F-4). This is a new task, not a reuse of existing exported code.

## Manifest builder scaling to 5 data groups

- **Decision**: widen `DataGroup` from the 2-group literal union to the 5 real groups (county, property_improvement, owner, contractor, parcels); make `SOURCE_ORDER` and required coverage keys a per-run profile instead of a hardcoded 2-item tuple, while keeping `checkInput`'s exact-match, fail-closed behavior (extend the fixed list, never loosen it to "anything goes").
- **Rationale**: `pipeline/publish/src/manifest.ts`'s `checkInput` (lines 320-353) throws today on anything other than exactly the walking-skeleton's 2 sources; Run 1 at full-county scale needs 5 groups and more sources (Austin, TCAD, plus whatever contractor-track sources are in scope) without weakening the "nothing missing, nothing extra" guarantee.

## Incremental delta computation

- **Decision**: Run 2/3 reuse A-04's existing watermark + content-digest + bulk-re-stamp-detection logic rather than re-deriving new logic; `ManifestSourceInput`/`source()` in `manifest.ts` (currently hardcoded to `added: records, changed: 0, removed: 0`, i.e. "first run: everything is new") gets explicit `added`/`changed`/`removed` fields supplied by the reconciliation layer's digest comparison.
- **Rationale**: this is the one real code change manifest.ts needs for A-12; everything else (re-stamp detection, zero-delta-with-reason, tombstones) already exists in A-04/A-07's patterns and just needs wiring through, not reinventing.

## Unchanged-group manifest representation

- **Decision**: a run with no change for a group **omits** that group's artifact entries from the new manifest, rather than repeating the previous entries unchanged. A consumer finds the group's last real CID by following `previousManifestCid` back through the run chain.
- **Rationale**: consistent with AD-03's "no re-pointing" philosophy (no IPNS, no field that gets silently updated); repeating unchanged entries would blur "what did this run actually publish" and risk a stale entry drifting from the group's authoritative manifest over time.
