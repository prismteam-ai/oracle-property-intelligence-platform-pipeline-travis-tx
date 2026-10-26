# Feature Specification: Publish the full county by CID and keep it current with incremental runs

**Feature Branch**: `011-publish-and-runs`

**Created**: 2026-10-23

**Status**: Draft

**Input**: User description: "A-11 Publish the full county by CID and keep it current with incremental runs — see stories/A-11-publish-and-runs.md for the full spec (merged story, parts A-11 and A-12). Branch: 011-publish-and-runs."

**Story**: `stories/A-11-publish-and-runs.md` | **Evaluation point**: A4 (primary) · A3 · A1 | **Demo line(s)**: D-5, D-6, D-7, D-2

**Owner agents** (from the story front matter; used by the plan, not by this spec): design `oracle`, `machamp` · builder `oracle` (runs, publication), `machamp` (scheduler) · reviewers `oracle`, `donphan`, `machamp`, `porygon` · verify `verify-manifest` on 2 gateways (Run 1) and the immutability check after Run 3

> Every story acceptance criterion becomes at least one FR below. No technology choices in this file; they belong in plan.md.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Publish Run 1, verifiable by a stranger (Priority: P1)

An independent retriever, who has only a manifest's CIDs and no access to this environment, must be able to fetch every published artifact for Travis County from two public gateways this environment does not operate, and get exactly the bytes the manifest describes.

**Why this priority**: This is the story's core durability promise (README AC-26 to AC-34) and the primary evaluation point (A4). Nothing else in this story matters if Run 1 cannot be independently verified.

**Independent Test**: Run `npx tsx scripts/verify-manifest.ts runs/{run1}/manifest.json` after Run 1 publishes; it must print `ALL ARTIFACTS VERIFIED` and exit 0.

**Acceptance Scenarios**:

1. **Given** the reconciled Travis County data groups from A-04 and A-07, **When** publication runs, **Then** each group passes six steps in a fixed order (validate → hash → validate CAR → export tables → upload CAR → upload tables, each with readback), a test asserts the order and that no step is skipped, and the run fails before writing the manifest if any upload readback fails.
2. **Given** the Run 1 manifest, **When** it is validated against the manifest schema, **Then** every artifact has a CIDv1, name, codec, size and SHA-256, every directory has its own CAR CID, no gateway URL is stored anywhere in the manifest, and `previousManifestCid` is `null`.
3. **Given** the full-county manifest, **When** `verify-manifest` fetches every file artifact from two independent public gateways, **Then** every size and SHA-256 matches on both, the script exits 0 and prints `ALL ARTIFACTS VERIFIED`.
4. **Given** the manifest's coverage section, **When** it is read, **Then** it carries the published row count per table, each source's capture-time total, and merge/contractor-state aggregate counts — never a count computed directly from the internal reconciliation store.
5. **Given** a gateway that returns a rate-limit or timeout error, **When** `verify-manifest` runs, **Then** it retries with backoff, marks that artifact `unverified` with the gateway's response recorded, exits non-zero, and never claims full verification without a digest match on both gateways.
6. **Given** the CARs, **When** the release step runs, **Then** each CAR is attached to a GitHub Release (split if it would exceed the release asset size limit), pinned on two independent pinning services, and the release URL is recorded in the evidence.

---

### User Story 2 - Keep Travis County current with incremental runs (Priority: P2)

The Oracle operator needs later runs, on later days, to publish only what actually changed since the previous run — as new immutable snapshots that link back to the one before — while every earlier snapshot keeps resolving exactly as it did on day one.

**Why this priority**: This is the second half of the merged story (parts A-12): visible run history and non-destructive republishing (demo lines D-2, D-7). It depends on Run 1 existing, so it is P2.

**Independent Test**: After a third run, the chain-and-immutability check (reference: `checks.md` § 6.2) passes: `runs/index.json` lists at least three runs on at least three distinct UTC dates, each manifest's `previousManifestCid` links to the one before, and re-running `verify-manifest` against Run 1's manifest still prints `ALL ARTIFACTS VERIFIED`.

**Acceptance Scenarios**:

1. **Given** Run 1's recorded watermark for a source, **When** a later run executes on a later UTC date, **Then** its manifest records the watermark used, the records read, and a delta of added/changed/removed rows computed from content digests (not timestamps alone), and only changed rows are written.
2. **Given** a later run has published, **When** the run chain is read, **Then** its manifest CID differs from the previous run's, `previousManifestCid` equals the previous run's manifest CID, both runs appear in `runs/index.json`, and every changed group has a new CID with its own CAR.
3. **Given** a third run has finished, **When** `verify-manifest` runs against Run 1's manifest, **Then** every Run 1 artifact still fetches from both public gateways with matching size and SHA-256, and `runs/index.json` lists at least three runs on at least three distinct UTC dates.
4. **Given** identical inputs, **When** a run is repeated, **Then** it writes zero rows and produces the same CIDs as before (idempotent, safe to re-run).
5. **Given** a source with no change in the current window (no newer export available, or a harvest blocked by an upstream error), **When** the run finishes, **Then** that source's delta is recorded as empty with a stated reason, and its group keeps the previous CID rather than publishing a new, empty one.

---

### User Story 3 - A scheduler that costs nothing until someone turns it on (Priority: P3)

The Oracle operator wants an automated way to run future refreshes, but it must not run, and must not cost anything, until a human explicitly enables it.

**Why this priority**: Supporting infrastructure for User Story 2's ongoing-refresh promise; it can be built and verified independently of any particular run, so it is P3.

**Independent Test**: `cdk synth` on the scheduler stack, with a CDK assertion confirming the schedule state and its $0 idle cost; the schedule is deployed to the account in a disabled state and never fires during this story.

**Acceptance Scenarios**:

1. **Given** the infrastructure app, **When** it synthesizes, **Then** a CDK assertion confirms an EventBridge schedule exists in a disabled state, its target is the batch task that runs the full incremental-run sequence, there is no direct connection string to the internal reconciliation store anywhere in the application or infrastructure code, and the schedule incurs no cost while disabled.

---

### Edge Cases

- A table part exceeds a single gateway response's size limit → the retrieval does a ranged fetch and still hashes the full stream to a match.
- A gateway redirects to a different URL for the same content → the redirect is followed; the bytes still match the manifest's digest.
- The measured publication size does not fit the current pinning plan → recorded as a limitation; the run is never published half-pinned (all three copies, or none).
- An artifact's durable copy already exists at its destination → the copy step refuses to overwrite and instead confirms the existing copy matches.
- A source's change-tracking field gets reset for every record at once (not a real change) → detected as a reset event; the delta still comes from content digests, not the reset field, and the event is recorded as a limitation.
- A record that existed in a previous run is absent from a later capture → recorded as removed (tombstoned) rather than silently dropped; counted in that run's `removed` delta.
- A run fails partway through publication → no manifest is written for that attempt; the next run resumes from the last successfully committed watermark; the failed attempt is logged but never listed as a completed run.
- A later run lands less than 24 hours after the previous one → still valid as long as its UTC calendar date differs and its window is non-empty.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST publish only verified output through the fixed six-step sequence, in order, with readback confirmation at each upload step.
- **FR-002**: System MUST write a schema-valid manifest recording CIDv1, size, codec and SHA-256 for every artifact, and a CAR CID for every directory.
- **FR-003**: System MUST make every published artifact independently verifiable on two separate public gateways that this environment does not operate.
- **FR-004**: System MUST record row and source counts in the manifest's coverage section with their derivation stated, never computed directly from the internal reconciliation store.
- **FR-005**: System MUST keep at least three durable copies of every published artifact (two independent pinning services plus a release asset).
- **FR-006**: System MUST compute each run's window from per-source watermarks and content digests, not from a single timestamp field alone.
- **FR-007**: System MUST publish each run's changed data as new, immutable CIDs and link each new manifest to the one before it.
- **FR-008**: System MUST keep every previously published CID fetchable and unchanged after any later run publishes.
- **FR-009**: System MUST be idempotent: repeating a run with the same inputs writes zero rows and reproduces the same CIDs.
- **FR-010**: System MUST record a zero-change source's result with a stated reason rather than silently omitting it or publishing an empty new CID.
- **FR-011**: System MUST define the scheduled automated run as disabled by default, requiring an explicit human action to enable it.
- **FR-012** (Run 3 correction, PO decisions 2026-10-25, FU-A-01, ERR-66): System MUST publish the contractor company the permit prints, exactly as printed (trimmed, clerk markers such as `**MAIN**` removed, placeholders such as N/A, OWNER and SELF skipped), as `company.name` linked by `property_improvement_has_contractor` with the permit's own request as provenance and no `sunbiz_document_number`; the view labels it `contractor_name_as_printed` ("as printed, unverified") and `contractor_resolution` MUST stay `unresolved` unless the company carries an official registry id. System MUST NOT publish a person, phone or address for a contractor, and a permit that prints only a person name has no contractor. Where BBB blocks the lookup (A-01 receipts), System MUST publish a plain BBB search link built in the view from the printed name (`bbb_url`, city Austin), with `bbb_rating` null, `bbb_status = blocked` and `bbb_status_reason = bbb_blocked`, and MUST NOT request bbb.org; with no name the link is null (`source_missing`) and `bbb_status = not_checked`. The change is additive (contract v1.1): every v1 column keeps its name and type, and a run published before Run 3 binds the new columns as null with a reason. The link shape is unverified until a human clicks one example.

### Key Entities

- **Run manifest**: One published snapshot's record — every artifact's CID, size, codec and digest; which run (if any) it supersedes; and the coverage counts for that snapshot.
- **Run history entry**: One line in the overall run index — which run, when, and which manifest CID — used to show the chain of snapshots over time.
- **Data group**: A named, independently publishable slice of Travis County data — the real two groups are the county roll (`county`, which already embeds owner and parcel-geometry fields per record) and permit/improvement records (`property_improvement`, which carries the contractor-identity fields per permit) — each with its own artifacts and its own per-run delta. (Corrected 2026-10-23: an earlier draft of this spec implied owner, contractor and parcels might be separate groups; they are not — see `research.md`.)
- **Source watermark**: The per-source marker (a timestamp, export date, or content digest set) that determines what a run's window covers and what counts as changed since the last run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A retriever with only the Run 1 manifest's CIDs, and no access to this environment, independently fetches and verifies 100% of Run 1's artifacts from two public gateways.
- **SC-002**: After a third run, at least three runs exist on at least three distinct UTC dates, and the first run's artifacts still verify in full.
- **SC-003**: Repeating any run with unchanged inputs writes zero rows and produces identical CIDs to the prior run.
- **SC-004**: Every source with no change in a run's window is recorded with a stated reason, with zero silent omissions.
- **SC-005**: The automated scheduler exists and costs $0 for as long as it stays disabled, which is its state throughout this story.

## Assumptions

- "Two independent public gateways" means two different gateway operators this environment does not run or control; the specific gateways may change if one becomes unavailable, as long as both are genuinely independent and public.
- The internal reconciliation store (Query DB) is never published directly; everything published is the output of the fixed six-step publication sequence.
- Run 2 and Run 3 land on later calendar (UTC) dates than the runs before them, as required by the independent test; the exact clock time within each date is not constrained.
- The second durable pinning service's specific provider is a build-time decision (left to the design/build stage), not a product requirement; the requirement is independence from the first pinning service.
- No public catalog registration (e.g., an external marketplace listing) is in scope for this story; "publish" means CID-addressable public availability plus the evidence that proves it.
