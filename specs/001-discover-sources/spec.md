---
id: SPEC-A-01
parent: A-01
story: stories/A-01-discover-sources.md
---

# Feature Specification: Discover Travis County sources and pass readiness preflight

**Feature Branch**: `001-discover-sources`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Specify the story in stories/A-01-discover-sources.md. Every acceptance criterion becomes at least one FR with the same numbers. Fill the spec header (story, evaluation point, demo lines, owner agents) from the story front matter. Facts: ../assessment-guide/reference/A-oracle.md. No technology choices."

**Story**: `stories/A-01-discover-sources.md` (rev 3, G4 Ready 2026-10-19) | **Evaluation point**: A1 (primary) | **Demo line(s)**: D-2 (source list, documented limitations), D-3 (denominators per source)

**Owner agents** (from the story front matter; used by the plan, not by this spec): design `oracle` · builder `oracle` · reviewers `oracle` · verify readiness validator exits 0

> Every story acceptance criterion becomes at least one FR below. No technology choices in this file; they belong in plan.md.

**Numbering**: FR-00*n* (and FR-00*n*a, b, …) implements story AC-*n*. The story's own FR-001 to FR-005 and NFR-001 are mapped in [Traceability](#traceability-story--spec).

## Clarifications

### Session 2026-10-19

- Q: Which rule decides whether a permit jurisdiction counts as "supported", "records request" or "no public history"? → A: Supported = permit records with history publicly online (API, bulk file or searchable portal), capturable within terms; records request = records exist only through a custodian, or the portal is intake-only, blocked or has no history; no public history = evidence shows no public permit records, or another body issues its permits (recorded under that body, with a note).
- Q: What evidence has to be on record before we can say a block is location-based, which is the only case where the one US-based check is allowed? → A: The source's own response must say the block is about location (for example a "not available in your country/region" page, a country-block error code, or a header naming a geo restriction), saved as evidence; a bare 403 with no such signal does not count.
- Q: How much of a source should discovery read to measure its speed (rows per minute) before projecting the full-backfill hours? → A: At least 3 consecutive full pages per paged source, read one after another; record the median rows per minute, the pages read and the time window.
- Q: For the Texas Comptroller business dataset (`9cir-efmm`), which count should A-01 record as the coverage denominator? → A: Record both; the coverage denominator is the Travis-coded rows (county code 227), and the statewide count is recorded as the lookup set for contractor identity matching (A-07).
- Q: Which TCAD certified roll year should A-01 count as the property denominator? → A: The 2026 certified roll (latest certified year); roll year and certification date are recorded with the count, and later changes come from supplemental exports (A-12).

## User Scenarios & Testing *(mandatory)*

The actor is the **Oracle operator**, who runs the county pipeline. The **evaluator** later checks every coverage number against the denominators recorded here. All four journeys are part of one Must story (FEAT-A01); they are listed in the order the work happens.

### User Story 1 - Measure every source before ingesting anything (Priority: P1)

The operator wants each public Travis County source listed with its size (denominator), measured speed, access rules (anti-bot posture) and a capture decision, so full-county ingestion starts from known numbers instead of guesses.

**Why this priority**: Coverage (A1) is the heaviest evaluation point. "All available records" only means something against a measured denominator per source.

**Independent Test**: Open the source catalog and its readable summary; every source in `A-oracle.md` § 4 has a denominator, a measured throughput, an anti-bot posture and a decision, each with a source URL and a UTC capture time.

**Acceptance Scenarios**:

1. **Given** the Austin permits dataset `3syk-w9eu`, **When** discovery measures it, **Then** the catalog records its row count (2,380,725 on 2026-10-19, re-measured at capture), its missing-parcel-ID count (63,019 on 2026-10-17), its anti-bot posture, the measured rows per minute (median of at least 3 consecutive full pages of at most 50,000 rows, read one after another, with the pages read and the time window recorded), the projected full-backfill hours, and a decision with its reason. (AC-2)
2. **Given** the TCAD 2026 Certified Special Export, downloaded once with its size, content fingerprint and capture time, **When** discovery counts its accounts and lists its fields, **Then** the catalog records the certified account count (the property denominator), the property key as printed, whether deed or sale dates are present, the GIS parcel count and its percentage gap from the roll. (AC-3)
3. **Given** any source whose full capture is projected above 48 hours, **When** the catalog is written, **Then** it carries an explicit decision and the measurement behind it. (AC-5)

---

### User Story 2 - Classify every permit jurisdiction (Priority: P1)

The operator wants every place that issues building permits in Travis County classified, so permit coverage is complete per jurisdiction and Austin-issued records are not mistaken for other cities' permits.

**Why this priority**: The readiness validator blocks on any unclassified jurisdiction, and a missing city silently lowers coverage.

**Independent Test**: Compare the catalog's jurisdiction list with the U.S. Census Bureau list of incorporated places with land in Travis County plus the unincorporated county; counts match and each row has one class with evidence.

**Acceptance Scenarios**:

1. **Given** the expected jurisdiction set (Census places with land in Travis County, plus Travis County unincorporated, including at least the 18 named in `A-oracle.md` § 4), **When** preflight classifies them, **Then** the catalog's count equals the expected count, no row is left for review, each row has exactly one class (supported / records request / no public history) with an evidence URL and date, and Austin-issued records located in Lakeway (6,825), Bee Cave (4,822) and Pflugerville (1,117 full purpose + 592 ETJ) are recorded as Austin-issued. (AC-4)

---

### User Story 3 - Get a readiness verdict the evaluator can check (Priority: P1)

The operator wants the kit's fail-closed readiness validator to pass on the catalog, and the catalog, summary and validator report committed to the PR, so nothing is ingested before readiness is proven and the proof can be reviewed without the operator's machine.

**Why this priority**: The validator is the hard gate before seed, pilot and full ingest; the committed proof is this Project feature's evidence (G4 C-04 exception).

**Independent Test**: Run the validator on the committed catalog; it returns PASS with seeding and ingest allowed (or the documented blocker of User Story 4), and the PR contains the catalog, summary and report.

**Acceptance Scenarios**:

1. **Given** the local pipeline stack is up and the kit flow onboarding → discovery → readiness preflight runs for Travis County (FIPS 48453), **When** the readiness validator runs on the catalog, **Then** it returns overall PASS with seeding and ingest allowed, its full report is kept, the catalog names every source in `A-oracle.md` § 4, the internal destination is proven by two independent identity sources, and every blocked or records-request row has a complete records request. (AC-1)
2. **Given** discovery is complete, **When** the story branch is pushed, **Then** the catalog, its summary and the validator report are committed and visible in the PR, and every number in the summary has a source URL and a UTC capture time. (AC-7)

---

### User Story 4 - Stop honestly when a source is blocked (Priority: P1)

The operator wants a blocked source recorded with evidence and a lawful next step, never worked around, so the project stays within source terms and the evaluator sees an honest limitation instead of a hidden gap.

**Why this priority**: TCAD answered HTTP 403 on 2026-10-17 and 2026-10-19 and the GIS layer timed out on both days, so this path is likely, not hypothetical.

**Independent Test**: Simulate or observe a 403 or timeout; the catalog shows the source as blocked with code, time and evidence, the run waits for a human, no request repeats with a changed address or identity, and a complete records request is named.

**Acceptance Scenarios**:

1. **Given** `traviscad.org/publicinformation` returns HTTP 403 or the GIS layer times out, **When** discovery reaches it, **Then** the source is recorded as blocked with response code, time and evidence, the run waits for a human, and nothing is retried with a changed network address or user agent. (AC-6)
2. **Given** the source's saved response says the block is location-based (FR-006b), **When** the operator checks it, **Then** exactly one identified request from a US-based runner is made; a plain 403 or bot challenge is never retried and goes straight to a records request. (AC-6)
3. **Given** the US check returns HTTP 200, **When** discovery continues, **Then** the source is captured from there and User Story 3 scenario 1 and User Story 1 scenario 2 must pass; **given** it does not, **then** the source stays blocked with a complete records request, the run keeps waiting, the story is judged on AC-2, AC-4, AC-5 and AC-7, and the failing verdict and missing roll count are recorded as the documented blocker. (AC-6)

---

### Edge Cases

- A jurisdiction's portal exists but has no permit history before a given year → classified "supported from {year}" with the earliest date seen.
- The Austin row count changes between discovery and backfill → the count is stored with its capture time; A-06 reconciles to the count at its own watermark.
- The Austin source answers "too many requests" during measurement → back off (1 s base, 60 s cap, 5 attempts) and record the observed limit.
- The TCAD Special Export lacks a field the legacy fixed-width layout has (for example the deed date) → record both layouts and which one A-04 uses.
- TCAD is reachable but the GIS layer times out → TCAD measurements are recorded; GIS is blocked under User Story 4, and the GIS-vs-roll gap is recorded as unknown with the reason.
- The Census list contains a place not among the 18 named (for example a small village) → it is added and classified like any other jurisdiction.
- BBB answers with a bot challenge → recorded as blocked with evidence; no bypass; the next step is the official BBB API application (recorded only).
- A source keeps answering "too many requests" after 5 attempts → the measurement is `null` with "throttled: 5 attempts exhausted" and the source waits for a human (FR-006e).
- The TCAD export download stalls for 10 minutes or runs past 2 hours → treated as a timeout: recorded as blocked with the elapsed time (FR-003, FR-006).

## Requirements *(mandatory)*

### Functional Requirements

**AC-1: readiness verdict**

- **FR-001**: System MUST run the kit flow onboarding → discovery → readiness preflight for Travis County (FIPS 48453) and keep the validator's exit result and full report as evidence. The onboarding intake, the discovery procedure and the readiness validator are the kit's own procedures, run by the builder agent from its kit skills; the Travis probes are new code that supply the measurements those procedures record. No kit step is reimplemented.
- **FR-001a**: The readiness verdict MUST be overall PASS with seeding and ingest allowed; a non-passing verdict stops seed, pilot and full ingest (safe preparation work may continue).
- **FR-001b**: The catalog MUST name every source in `A-oracle.md` § 4: TCAD certified and supplemental exports, TCAD parcel GIS, Austin permits, other jurisdictions, Texas Comptroller franchise-tax holders, BBB, Overture places, and contractor licensing recorded as "no statewide roofing licence" with evidence. The Overture places row records its denominator as `null` with the reason "not measured in A-01: optional source; licence gate decided in A-09".
- **FR-001c**: The internal destination MUST be proven by two independent identity sources before any write (validator rule 4).
- **FR-001d**: Every blocked, custodian-only or records-request row MUST carry a complete records request: recipient office, portal or email, system and date scope, and whether it is API-first or records-first (validator rule 5).
- **FR-001e**: The Texas Comptroller row (`9cir-efmm`) MUST record two counts, each with URL and capture time: the Travis-coded rows (county code 227), which are its coverage denominator, and the statewide active-holder count, recorded as the lookup set for contractor identity matching (A-07).

**AC-2: Austin permits measured**

- **FR-002**: For Austin permits `3syk-w9eu`, the catalog MUST record the row count re-measured at capture, the missing-parcel-ID count, the anti-bot posture (rate limits observed, any challenge, whether an access token was used), the measured rows per minute (median of at least 3 consecutive full pages of at most 50,000 rows, read one after another, with the pages read and the time window recorded), the projected full-backfill hours, and a decision (`bulk download`, `ingest` or `runtime retrieval`) with its reason.

**AC-3: TCAD roll and GIS measured**

- **FR-003**: System MUST download the TCAD **2026** Certified Special Export (the latest certified roll) once, record its size, content fingerprint, download rate and capture time, and keep it out of version control. The download stops after 10 minutes without data or 2 hours in total; either limit counts as a timeout under FR-006. If the connection drops part-way and the source advertises byte ranges (`Accept-Ranges: bytes`), the download continues from the last byte received with an HTTP Range request, using the same identity, at most 5 resumes, all within the same 2-hour total limit; a resumed file is accepted only if its final size equals the advertised length. Without range support, or after 5 resumes, the drop is recorded as `failed` (PO decision 2026-10-20).
- **FR-003a**: The catalog MUST record the certified account count (property denominator) with its roll year and certification date, the property key exactly as printed in the export (the 2026 JSON export prints `pID`, which the TCAD layout names `prop_id`; or a geo id), with its layout name recorded beside it and proof that it is present and unique on every record (PO decision 2026-10-20), and whether deed or sale dates are present. *Amended 2026-10-20 (PO, ERR-4):* when no official TCAD source states the certification date, it is recorded as missing with the reason, source URL and capture time, and the date in the export's file name is not used. The 2026 roll's date is recorded this way (the public-information page gives only "(July)").
- **FR-003b**: The catalog MUST record the GIS parcel count, its gap from the roll as a percentage, and, when GIS is below the roll, whether separately assessed units without geometry are acknowledged; a gap above 2% blocks GIS-only seeding.
- **FR-003c**: The catalog MUST record the anti-bot posture of the TCAD and GIS sources.

**AC-4: jurisdictions classified**

- **FR-004**: System MUST build the expected jurisdiction set from the U.S. Census Bureau list of incorporated places with land in Travis County (vintage and capture date recorded) plus Travis County unincorporated.
- **FR-004a**: The catalog's jurisdiction count MUST equal the expected count, and no row may remain unclassified or "needs review".
- **FR-004b**: Each jurisdiction MUST have exactly one class with an evidence URL and date, using these rules:
  - **supported**: permit records with history are publicly available online (API, bulk file or searchable portal) and can be captured within the source's terms;
  - **records request**: records exist but only through a custodian, or the online portal is intake-only (application submission, one-stop), blocked, or has no history;
  - **no public history**: evidence shows the jurisdiction keeps no public permit records, or another body issues its permits; in that case the permits are counted under the issuing body and the row names it.
  - Each row also records the kit validator's status word for its class: supported → `supported`; records request → `custodian-only` (custodian only), `manual-only` (intake-only or no-history portal) or `blocked` (portal blocked); no public history → `delegated` (another body issues) or `unavailable` (no records). No other status word is used.
- **FR-004c**: Austin-issued permits located in other jurisdictions MUST be recorded as Austin-issued, not as those jurisdictions' own permits.

**AC-5: long captures decided**

- **FR-005**: Every source whose full capture is projected above 48 hours MUST carry an explicit decision (`bulk download`, `ingest` or `runtime retrieval`) and the measurement behind it. Paged sources are measured as in FR-002 (median of at least 3 consecutive full pages); a single-file source's measurement is its recorded download rate.

**AC-6: blocked sources**

- **FR-006**: A source answering HTTP 403, a bot challenge or a timeout MUST be recorded as `blocked` with response code, time and evidence, and the run MUST move to a waiting-for-human state.
- **FR-006a**: System MUST NOT retry a blocked source with a changed network address or user agent, and MUST NOT bypass any CAPTCHA or bot check.
- **FR-006b**: Only when the evidence shows a geo-block MAY one identified request be made from a US-based runner; a plain 403 or challenge goes straight to a records request. Geo-block evidence means the source's own response says the block is about location (for example a "not available in your country/region" page, a country-block error code, or a header naming a geo restriction), and that response is saved; a bare 403 with no such signal is not geo-block evidence. *Amended 2026-10-20 (PO, DEC-A-01-source-access D-2):* when there is no response at all, it also counts as **suspected** geo-block evidence if the source host never accepts a TCP connection from non-US egress while a sibling host on the same domain answers from the same egress in the same minute, with both checks saved. This allows exactly one identified **count** request from a US-based runner, with no retry; a plain 403 or challenge is still never sent to the runner.
- **FR-006c**: If the US check succeeds, the source is captured from there and FR-001 and FR-003 apply in full; otherwise the source stays blocked with a complete records request, and the failing verdict and missing roll count are recorded as the documented blocker in the summary and the story evidence.
- **FR-006d**: Seed, pilot and full ingest for a blocked source MUST stay stopped until it is resolved.
- **FR-006e**: A "too many requests" or server error that still fails after 5 attempts MUST record the measurement as `null` with the reason "throttled: 5 attempts exhausted" and move that source to the waiting-for-human state, as for a block; it is never retried with a changed network address or user agent.
- **FR-006f**: A human MUST resolve a waiting source with one operator command and one of two outcomes: **captured** (that source is probed once more with the same identity, then the catalog and the validator re-run) or **still blocked** (the records request is confirmed and the run stays waiting, documented as the blocker in the summary and the story evidence).

**AC-7: committed proof**

- **FR-007**: The catalog, its readable summary and the validator report MUST be committed on the story branch and visible in the PR.
- **FR-007a**: Every number in the summary MUST have a source URL and a UTC capture time.
- **FR-007b**: Every Markdown artifact A-01 commits (the summary, the findings profile, the evidence files, the test report and the review) MUST carry front matter with `id` and `parent` (constitution XIX). The catalog is identified by its path and content fingerprint instead.

### Non-Functional Requirements

- **NFR-001** (source etiquette, project NFR-07): at most 2 concurrent requests per source; backoff on "too many requests" and server errors (1 s base, 60 s cap, 5 attempts); an identified user agent; 0 CAPTCHA or bot-check bypasses. Traces to AC-2, AC-6.

### Key Entities

- **Source**: a public data provider for Travis County (TCAD roll, GIS parcels, Austin permits, other jurisdictions, Comptroller, BBB, Overture, contractor licensing). Attributes: name, URL, denominator, measured throughput, anti-bot posture, status (available / blocked), decision, capture time.
- **Measurement**: one observation of a source (count, rate, response code), with URL and UTC capture time.
- **Permit jurisdiction**: a body that issues building permits in Travis County. Attributes: name, class, evidence URL and date, earliest history date, Austin-issued counts located there.
- **Records request**: the lawful next step for a blocked or custodian-only source: recipient office, channel, scope, API-first or records-first.
- **Readiness verdict**: the validator result for the catalog: overall result, seeding and ingest allowed, blocker actions.
- **Destination proof**: two independent identities of the internal store that will receive data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the sources in `A-oracle.md` § 4 appear in the catalog, each with a denominator (or a recorded reason it is unknown), throughput, anti-bot posture and decision.
- **SC-002**: 100% of numbers in the summary carry a source URL and a UTC capture time; an evaluator can trace any one number to its source in under 2 minutes.
- **SC-003**: The catalog's jurisdiction count equals the expected count, with 0 rows unclassified.
- **SC-004**: 100% of sources projected above 48 hours of capture have an explicit decision.
- **SC-005**: 0 retries with changed network identity and 0 CAPTCHA or bot-check bypasses in the run record.
- **SC-006**: The readiness verdict is PASS with seeding and ingest allowed, or, if a source stays blocked, a documented blocker with a complete records request exists for it; either outcome is reached by a discovery run that takes at most 8 hours from the first source capture to the catalog snapshot, excluding time spent waiting for a human (recorded in the catalog as `waiting_human_hours`).

## Assumptions

- The kit's onboarding, discovery and readiness-preflight flow and its fail-closed validator are mandated by the constitution and the task guide; the catalog follows the validator's catalog contract (shaped like the kit's Duval example).
- The local pipeline stack (durable workflow server and internal store) already exists (commit 1027cfd).
- Facts and dates in this spec come from `A-oracle.md` § 4 and the story's live queries (2026-10-17 and 2026-10-19); every count is re-measured at capture and may differ.
- The operator machine may be outside the US; a US-based runner may be used only for a geo-block check (ARD § 8).
- The U.S. Census Bureau list of incorporated places is the reference for "every jurisdiction"; its vintage is recorded.
- Changes to the roll after the 2026 certification arrive through the supplemental exports, which A-12 uses as the incremental property feed.
- **Out of scope**: parsing or loading TCAD roll data and ingesting any full dataset (A-04 to A-09); downloading supplemental exports; filing records requests or requesting the BBB API key (recorded as next steps only); any hosted display (A-11 manifest coverage, A-13 Runs and Coverage pages).

## Traceability (story → spec)

| Story item | Spec |
| --- | --- |
| AC-1 | FR-001, FR-001a–e; User Story 3 scenario 1 |
| AC-2 | FR-002; User Story 1 scenario 1 |
| AC-3 | FR-003, FR-003a–c; User Story 1 scenario 2 |
| AC-4 | FR-004, FR-004a–c; User Story 2 scenario 1 |
| AC-5 | FR-005; User Story 1 scenario 3 |
| AC-6 | FR-006, FR-006a–f; User Story 4 scenarios 1–3 |
| AC-7 | FR-007, FR-007a–b; User Story 3 scenario 2 |
| Story FR-001 | FR-001 |
| Story FR-002 | FR-001e, FR-002, FR-003a–c, FR-005 |
| Story FR-003 | FR-004–FR-004c |
| Story FR-004 | FR-006–FR-006f |
| Story FR-005 | FR-007–FR-007b |
| Story NFR-001 | NFR-001 |
