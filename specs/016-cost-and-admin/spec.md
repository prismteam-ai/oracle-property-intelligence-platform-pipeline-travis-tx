# Feature Specification: Prove zero idle cost, let the operator run the pipeline, match the prototype, and close the carried gaps

**Feature Branch**: `016-cost-and-admin`

**Created**: 2026-10-26

**Status**: Clarified, ready for planning (2026-10-26)

**Input**: User description: "Story A-16 from stories/A-16-cost-and-admin.md (all 14 ACs: Part 1 cost and limits AC-1..5, Part 2 admin sign-in and run commands AC-6..11 with Task B's email+password Cognito sign-in, Part 3 prototype parity AC-12, full-county per-run Explore index AC-13, carried gaps closure AC-14). Branch must be 016-cost-and-admin cut from feature/oracle-pipeline."

**Story**: `stories/A-16-cost-and-admin.md` (merged from parts A-16 cost and limits + A-17 admin sign-in; Part 3 added by the PO on 2026-10-26) | **Evaluation point**: A4 (primary) · A1 · A3 · A5 · A6 | **Demo line(s)**: D-1, D-4; D-8, D-9 (Explore on the full county); D-10 to D-12 (agent and MCP on the full county)

**Owner agents** (from the story front matter; used by the plan, not by this spec): design `metagross`, `machamp` · builder `metagross` (cost page, sign-in, UI, API), `machamp` (index, queue, DLQ, bridge) · reviewers `metagross`, `machamp`, `audino` · verify `docs/cost.md` + billing evidence; Playwright admin sign-in + Start reaches the bridge; non-admin refused; prototype parity matrix; Explore, agent and MCP answer on the full county

> Every story acceptance criterion becomes at least one FR below with the same number. No technology choices in this file; they belong in plan.md. The story names a few technologies because the architecture already fixed them (AD-12); this spec keeps to outcomes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what CountyLens costs while idle and how fast each source can be read (Priority: P1) [part A-16]

The evaluator opens the hosted Coverage page and reads, per component, what the system costs while nobody uses it, what one use costs and who pays for it, with the billing date and its source. A second section shows, for every public source, how fast it can be read, its page size, how long a full capture took at full scale, its rate limits and anti-bot posture, and what was done to respect them.

**Why this priority**: evaluation point A4 and demo lines D-1 and D-4 claim that Oracle runs without carrying infrastructure cost. A claim without a real bill scores nothing.

**Independent Test**: open Coverage · Cost on the hosted URL: it shows the fixed monthly idle cost with the billing date, gross cost and credits apart, and the build-time checks that forbid always-on resources pass.

**Acceptance Scenarios**:

1. **Given** the deployed system, **When** the billing data for the last full billed days (at least 3) is read, with per-use lines separated from idle lines, **Then** the cost document lists each component's idle cost (static hosting, functions, API, CID copy storage and CDN, on-demand table, parameters, logs, the disabled scheduler, sign-in, command queue and dead-letter queue, notifications) with the fixed monthly amount plus storage cents, cost per use and who pays, and the billing evidence image is stored with the evidence. (AC-1)
2. **Given** the infrastructure definition, **When** it is synthesised, **Then** automated checks confirm the scheduler is disabled; there is no secrets vault, relational database, customer-managed key, provisioned concurrency, web firewall or hosted DNS zone; log retention is 14 days (query log 30); a $10 budget alert exists; and the region comes from configuration. (AC-2)
3. **Given** the measurements from A-01 to A-11, **When** the source-limits document is written, **Then** every source has throughput, page size, the full-capture duration measured at full scale, rate limits, anti-bot posture and the optimisation applied. (AC-3)
4. **Given** the hosted Coverage page, **When** the evaluator opens Cost and Limits, **Then** both sections show the same numbers as the two documents, each with its "as of" date and source. (AC-4)
5. **Given** billing data for today is not yet available, or storage-provider usage cannot be read, **When** the page renders, **Then** it shows the last available date ("as of {date}") or "usage: not available · {reason}", never a filled-in zero. (AC-5)

---

### User Story 2 - The operator signs in and starts, stops or retries a run from the hosted app (Priority: P2) [part A-17]

The Oracle operator opens Admin, signs in with their email and password (the same sign-in pattern already working in Task B), and sees Start, Stop and Retry on the Runs page. A Start command is queued in the cloud; a small program on the operator's machine pulls it, starts the incremental run and reports its state back. Nothing in the cloud can reach the operator's machine or the private Query DB. The operator also sees recent activity: questions per day, latency and failures.

**Why this priority**: it shows how a run is started (supports D-2 and A3) but no demo line needs it; the public demo works signed out.

**Independent Test**: sign in as the admin on the hosted URL, press Start for an Austin-permits window, see the command reach the bridge and the run state change on the Runs page; a signed-in non-admin is refused.

**Acceptance Scenarios**:

1. **Given** the operator's email is in the admin group, **When** they sign in with email and password, **Then** they land on Runs with Start / Stop / Retry and "Signed in as admin"; signed-out visitors never see these controls. (AC-6)
2. **Given** a signed-in admin and the bridge running, **When** they press Start for "Austin permits since Run {n} watermark", **Then** one command with an ID is queued, the bridge picks it up within 60 s, the incremental workflow starts and the Runs page shows "Running · started {UTC time}". (AC-7)
3. **Given** a signed-in non-admin or an expired session, **When** any admin action is called, **Then** it is refused (403 or 401), nothing is queued, and the refusal is logged without the token. (AC-8)
4. **Given** the bridge is offline, **When** a Start command waits 15 minutes, **Then** it expires, the page shows "Bridge offline · command expired at {time}", nothing runs later by surprise, and after 3 failed receives the message moves to the dead-letter queue, whose alarm emails the operator. (AC-9)
5. **Given** 30 days of query log, **When** the admin opens Activity, **Then** the summary (questions per day, p95 latency, failures by outcome) loads in p95 < 3 s through a 5-minute cache, and every number links to its log query. (AC-10)
6. **Given** the infrastructure definition, **When** it is synthesised, **Then** checks confirm self sign-up is off, the queue has its dead-letter queue and alarm, there is no inbound path to the operator machine, no Query DB connection string in the app or infrastructure code, and $0 idle cost. (AC-11)

---

### User Story 3 - Every page matches its approved prototype board (Priority: P1) [Part 3]

The evaluator, and any reviewer comparing the product with its approved design, opens each page at phone (390 px), tablet (768 px) and desktop (1440 px) width in every state its board shows, and sees the same layout, section order, components, labels and states as the CountyLens prototype board. Where the product differs, the reason is written down.

**Why this priority**: the PO requires the hosted UI to follow the prototype board by board before release; it also feeds the runtime and demo score (states, no layout breaks).

**Independent Test**: open the parity matrix: every board/width/state cell is Match, Fixed, or Justified with a reason; spot-check three cells side by side on the hosted URL.

**Acceptance Scenarios**:

1. **Given** the hosted app and the boards, **When** each page is opened at 390, 768 and 1440 px in each board state (light theme), **Then** layout, section order, components, labels and states match, and every remaining difference is listed with its reason (an architecture decision, real data, or an accessibility rule); placeholder numbers on the boards are not compared. (AC-12)

---

### User Story 4 - Explore, the agent and the MCP server answer on the full county (Priority: P1) [Part 3]

A CRM developer searches the full Travis County run on Explore (radius, roof age, open permits, tenure, out-of-area owner), asks the agent a README prompt, or calls an MCP data tool, and gets an answer in seconds instead of a timeout. The answers come from a per-run search index built only from that run's published, content-addressed files, and the index records which files it came from.

**Why this priority**: evaluation points A5 and A6 and demo lines D-8 to D-12 fail on live data today; the A-13 and A-14 exceptions both point here.

**Independent Test**: run the README radius/roof-age search and the two README agent prompts on the hosted URL against the latest full-county run; each answers without a timeout, and the previously parked tests run.

**Acceptance Scenarios**:

1. **Given** the latest published full-county run (441,961 properties), **When** an Explore search, a README agent prompt or an MCP data tool call is made, **Then** each answers from the per-run index (built only from published CIDs, recorded in the index), Explore p95 < 3 s, no function timeout, and the A-13/A-14 tests parked for this gap run again. (AC-13)

---

### User Story 5 - Every carried gap is closed or openly accepted (Priority: P1) [Part 3]

The evaluator reads the final evidence and the pull request and finds no silent gap: each item carried from A-11, A-13 and A-14 is either closed with evidence or listed as an exception with its reason and the PO's decision.

**Independent Test**: compare the "Carried forward" lists in the story with the evidence's Exceptions section: every item appears once, as Closed (with a link) or Exception (with reason and decision).

**Acceptance Scenarios**:

1. **Given** the carried items, **When** A-16 reaches G7, **Then** each is closed with evidence or listed as a PO-approved exception with its reason; no parked test is counted as passed. (AC-14)

### Edge Cases

- Free-plan credits offset the bill → gross cost and credits applied are shown separately, so "$0" is not just credits.
- A function call during the sampled days (evaluator traffic) → shown as per-use cost, not idle cost.
- A source that never became reachable (TCAD 403) → its limit row says "blocked" with dates, not a throughput.
- Cost window (PO 2026-10-26): the story finishes in one session, so the bill is read from the last full billed days; sign-in, queue and notification pieces are stated from their pricing model until their first billed day (recorded gate exception).
- Two Start presses in a row → the second is rejected while a run is active ("A run is already running"); one command ID per run.
- Stop during publication → the bridge finishes the current atomic step, never leaves half-published CIDs, and records "stopped by admin".
- Sign-in service email or rate limit reached → the sign-in screen shows a plain "try later" message; the public app is unaffected.
- A board shows a feature an architecture decision removed (e.g. user sign-in shown as Coming soon) → recorded as Justified, not built.
- A run published after the index was built → the index is per run; a run without an index answers with a plain "index not available for this run" reason, never a timeout.

## Clarifications

### Session 2026-10-26 (PO answers, recorded in place of a separate `/speckit-clarify` round; no open questions remained)

- Q: The UI must follow the prototype — layout only, or data too? → A: Board by board at 390/768/1440: layout, section order, components, labels, states; light theme only; placeholder numbers are not compared (AC-12).
- Q: Admin sign-in method? → A: Copy Task B's working email + password Cognito flow instead of the email code (AC-6).
- Q: How is the full-county gap closed? → A: Option (a), a private per-run index built only from published CIDs (AC-13, ADR-0001 amendment 1).
- Q: Cost proof window? → A: Last full billed days, idle vs per-use split; Part 2 resources from pricing until billed (AC-1, gate exception).
- Q: Spend more AWS to fix MCP burst 503 (WAF)? → A: No; zero idle cost wins, A14-2 stays an exception.
- Q: Second independent pin? → A: On hold until the PO has seen the alternatives.
- Q: Dark theme? → A: Out of scope.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (AC-1): System MUST document idle and per-use cost per component from billing data, with gross cost and credits apart.
- **FR-002** (AC-2): The infrastructure definition MUST fail its checks if any always-on cost resource or wrong retention is introduced.
- **FR-003** (AC-3): System MUST document measured limits for every source.
- **FR-004** (AC-4): Coverage MUST show both documents' numbers with dates and sources.
- **FR-005** (AC-5): Coverage MUST show reasons for unavailable cost or usage data, never a filled-in zero.
- **FR-006** (AC-6): System MUST sign in admins with email and password and show admin controls only to admin-group members.
- **FR-007** (AC-7): System MUST deliver run commands through a cloud queue to an outbound-polling bridge on the operator machine.
- **FR-008** (AC-8): System MUST refuse non-admin and expired sessions on every admin action, queue nothing and log without tokens.
- **FR-009** (AC-9): System MUST expire unpicked commands after 15 minutes and alarm the operator on dead-lettered commands.
- **FR-010** (AC-10): System MUST show Activity from the query log with links to its queries.
- **FR-011** (AC-11, AC-12): Each page MUST match its prototype board at 390/768/1440 in each board state, or the difference MUST be recorded with its reason; the infrastructure checks for Part 2 (self sign-up off, dead-letter queue and alarm, no inbound path, no Query DB connection string, $0 idle) MUST pass.
- **FR-012** (AC-13): Explore, the agent and the MCP data tools MUST read a per-run index built only from that run's published CIDs, recording them.
- **FR-013** (AC-14): Every carried gap MUST be closed with evidence or recorded as a PO-approved exception.

### Non-Functional Requirements

- **NFR-001**: $0.00 fixed per month while idle; $10 budget alert (AC-1, AC-2, AC-11).
- **NFR-002**: Responsive at 390/768/1440, Atlas tokens and components only, light theme (AC-4, AC-6, AC-12).
- **NFR-003**: Activity p95 < 3 s cached; command pickup ≤ 60 s while the bridge runs; Explore p95 < 3 s on the full county (AC-7, AC-10, AC-13).
- **NFR-004**: Least-privilege access; no token in logs; WCAG 2.2 AA (AC-6, AC-8).

### Key Entities

- **Cost line**: component, idle cost per month, cost per use, who pays, billing date, source.
- **Source limit**: source, throughput, page size, full-capture duration, rate limit, anti-bot posture, optimisation, status (reachable / blocked with dates).
- **Run command**: command ID, action (start / stop / retry), window, requested by, requested at, expires at.
- **Live run state**: run ID, state, started at, last update, command ID, limitations.
- **Explore index (per run)**: one row per property with location, roof age and basis, tenure, out-of-area owner flag, nearest open-permit age and permit links; header with the run's manifest CID and the source part CIDs.
- **Parity cell**: board, route, width, state, verdict (Match / Fixed / Justified / Not built), reason, evidence image.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The Coverage page shows the idle monthly cost with a billing date no older than the last billed day, and every component row has a source.
- **SC-002**: 100% of sources in the source register have a limits row (or "blocked" with dates).
- **SC-003**: An admin Start reaches the operator's machine within 60 s; a non-admin is refused 100% of the time.
- **SC-004**: 100% of prototype board/width/state cells are Match, Fixed or Justified; 0 unexplained differences.
- **SC-005**: On the full county, 95% of Explore searches answer in under 3 s and the two README agent prompts answer without a timeout.
- **SC-006**: 100% of carried items appear once in the evidence as Closed or Exception; 0 parked tests counted as passed.

## Assumptions

- The cost proof uses the last full billed days (PO 2026-10-26), not a dedicated quiet day; newly deployed per-request services are stated from pricing until billed.
- The sign-in pattern is copied from Task B's working email + password flow (PO 2026-10-26); admin users are created by the operator, self sign-up stays off.
- The index is a private derived file built on the operator's laptop from published CIDs only (PO option a); it is never a replacement for the published data and never exposes the Query DB.
- Run 3 is produced by the A-11 Run 3 work; if it is published before G7, the index and parity checks run on it, otherwise on Run 2.
- A second independent pin service is on hold (PO 2026-10-26) and stays a listed item.
- Dark theme is out of scope (PO 2026-10-26).
