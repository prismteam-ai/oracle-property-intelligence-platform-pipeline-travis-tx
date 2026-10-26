---
id: QC-TC-A-01
type: test-cases
title: Discover Travis County sources and pass readiness preflight
parent: FEAT-A01
story: stories/A-01-discover-sources.md
spec: specs/001-discover-sources/spec.md
owner: HebaGaber             # QC Lead
status: Approved             # Draft → In Review → Approved
gate: G6
version: 0.7
created: 2026-10-19
runtime_url: "none: Project story (G4 C-04 exception); every case runs from a terminal at the repo root on branch 001-discover-sources"
reviewed_code: 7311edd
qc_signoff: true
---

# Test Cases: A-01 Discover Travis County sources and pass readiness preflight

> Drafted with `developmentsupport-testcases` from the story's Given / When / Then ACs and the spec's FR numbering, **not** from `tasks.md`. A-01 has no hosted runtime until A-03 (G4 C-04 exception, plan Complexity Tracking), so each case starts in a terminal at the repository root on branch `001-discover-sources` and names the exact command and the exact expected output (exit code, YAML or JSON field and value). Each case maps to one automated test titled with its TC ID.

## 1. Feature overview

A-01 discovers, measures and classifies every public Travis County source and permit jurisdiction, then runs the kit's fail-closed readiness validator on the source catalog `pipeline/docs/travis-sources.yaml`. The value validated: full-county ingestion later starts from known denominators, speeds and access limits, and a blocked source is recorded honestly instead of worked around.

## 2. Requirement mapping

| Source | Reference | Covered by |
| --- | --- | --- |
| Acceptance criterion | A-01-AC-1 | TC-001, TC-002, TC-003, TC-004, TC-024, TC-025 |
| Acceptance criterion | A-01-AC-2 | TC-006, TC-007, TC-008, TC-NF-02 |
| Acceptance criterion | A-01-AC-3 | TC-009, TC-010, TC-011, TC-012 |
| Acceptance criterion | A-01-AC-4 | TC-013, TC-014, TC-015, TC-016 |
| Acceptance criterion | A-01-AC-5 | TC-017 |
| Acceptance criterion | A-01-AC-6 | TC-011, TC-018, TC-019, TC-020, TC-021, TC-026, TC-027 |
| Acceptance criterion | A-01-AC-7 | TC-022, TC-023 |
| Functional requirement | FR-001 (kit flow, exit code + report kept) | TC-001, TC-025 |
| Functional requirement | FR-001a (PASS with seed + ingest allowed) | TC-001, TC-018 |
| Functional requirement | FR-001b (every § 4 source named) | TC-002 |
| Functional requirement | FR-001c (destination proof, 2 identities) | TC-003 |
| Functional requirement | FR-001d (complete records requests) | TC-004, TC-018 |
| Functional requirement | FR-001e (Comptroller two counts) | TC-005 |
| Functional requirement | FR-002 (Austin measurements) | TC-006, TC-007, TC-008 |
| Functional requirement | FR-003 / FR-003a (one TCAD download; count, key, deed dates) | TC-009 |
| Functional requirement | FR-003b (GIS gap, 2%, acknowledgement) | TC-010, TC-011 |
| Functional requirement | FR-003c (TCAD and GIS anti-bot posture) | TC-011 |
| Functional requirement | FR-004 / FR-004a (Census expected set, count equal) | TC-013, TC-015 |
| Functional requirement | FR-004b (class rules) | TC-013, TC-015, TC-016 |
| Functional requirement | FR-004c (Austin-issued records) | TC-014 |
| Functional requirement | FR-005 (> 48 h decisions) | TC-017 |
| Functional requirement | FR-006 (blocked + WAITING_HUMAN) | TC-011, TC-018, TC-021 |
| Functional requirement | FR-006a (no rotation, no bypass) | TC-019 |
| Functional requirement | FR-006b (US check only on a geo signal) | TC-020 |
| Functional requirement | FR-006c / FR-006d (outcome; ingest stays stopped) | TC-018 |
| Functional requirement | FR-006e (429/5xx after 5 attempts → null + waiting) | TC-026 |
| Functional requirement | FR-006f (human resolves: captured / still blocked) | TC-027 |
| Functional requirement | FR-003 download limits (10 min idle, 2 h total) | TC-026 |
| Functional requirement | FR-007 / FR-007a (committed; URL + time per number) | TC-022, TC-023 |
| Functional requirement | FR-007b (front matter on committed Markdown) | TC-022 |
| NFR | NFR-001 (≤ 2 concurrent, backoff 1 s / 60 s / 5, identified UA, 0 bypasses) | TC-NF-01, TC-019 |
| NFR | Clarification Q3 (≥ 3 pages of ≤ 50,000 rows; measurement, not ingest) | TC-NF-02 |
| Success criterion | SC-006 (discovery run ≤ 8 h, excluding time waiting for a human) | TC-NF-03 |
| Story requirement | Story FR-001 … FR-005, NFR-001 | via spec FRs above (spec § Traceability) |

## 3. Assumptions

- The local stack (Restate + Postgres) has been started per `bootstrap-oracle-infra`, and `npm --prefix pipeline/oracle-runtime ci` has run.
- Operator commands are those in `specs/001-discover-sources/contracts/cli.md`; `check-catalog` accepts an optional catalog path (default `pipeline/docs/travis-sources.yaml`) so negative cases can run on a scratch copy.
- Catalog field names come from `specs/001-discover-sources/contracts/catalog.md` and `data-model.md`. Where those name a field only in prose, this plan fixes it: Austin's missing-parcel-ID count is `tcad_id_null_count`; Austin-issued counts located elsewhere are `located_in_other_jurisdictions` (an array of `{jurisdiction, value, source_url, captured_at}`).
- Blocked evidence (`blocked_evidence` on a source or jurisdiction row) also carries `attempts` and `user_agent` from the capture receipt (`contracts/capture-receipt.md`), so TC-019 can read them from the catalog.
- The catalog's top level records `waiting_human_hours` (number, `0` when nothing waited) so SC-006 can be measured (TC-NF-03).
- `check-catalog` prints one line per failed rule in the format `FAIL rule <n>: <subject> <detail>` and exits 1; this plan quotes the exact lines for rule 3 (TC-017) and rule 6 (TC-015).
- Counts that change daily are checked against an independent recount bounded by the measurement's own `captured_at`; the story's figures are reference values with their dates, not fixed expectations.
- **Exactly one of two outcomes applies (spec FR-006c):** (A) TCAD is reachable → TC-001 and TC-009 apply and TC-018 is N/A; (B) TCAD stays blocked → TC-018 applies and TC-001 / TC-009 are recorded N/A with the blocker. Every other case applies in both outcomes.

## 4. Scope

- **In scope:** the source catalog, the readiness verdict, jurisdiction classification, blocked-source handling, the rendered summary and the committed evidence (AC-1 … AC-7).
- **Out of scope:** hosted display of these numbers (A-11 AC-4, A-13 AC-1/AC-2); loading TCAD rows (A-04); permit, contractor, BBB and places ingestion (A-06 … A-09); filing records requests (recorded only).

## 5. Test data

- **Austin permits** Socrata `3syk-w9eu` (data.austintexas.gov): reference 2,380,725 rows on 2026-10-19 (re-measured at capture); `tcad_id` null on 63,019 rows on 2026-10-17. Austin-issued records located elsewhere (from the same dataset's `jurisdiction` field): `LAKEWAY FULL PURPOSE` 6,825; `BEE CAVE FULL PURPOSE` 4,822; Pflugerville 1,117 full purpose + 592 ETJ.
- **TX Comptroller franchise-tax holders** Socrata `9cir-efmm` (data.texas.gov): 342,334 rows with Travis county code `227` (2026-10-19).
- **TCAD** `traviscad.org/publicinformation`: HTTP 403 from the operator machine on 2026-10-17 and 2026-10-19. 2026 Certified Special Export (JSON); no account count measured yet (first measured here).
- **Travis County GIS** `TCAD.TC_USER.TCAD_PARCELS` (`gis.traviscountytx.gov/server1/rest/services/CIPStoryMap/Main_Location_Map2/MapServer/6`): timed out on 2026-10-17 and 2026-10-19.
- **BBB**: Cloudflare bot challenge on 2026-10-17.
- **The 18 named jurisdiction leads** (A-oracle § 4): Travis County unincorporated, Austin, Pflugerville, Lakeway, Bee Cave, West Lake Hills, Manor, Sunset Valley, Rollingwood, Lago Vista, Jonestown, Briarcliff, Creedmoor, Mustang Ridge, Webberville, Cedar Park (Travis part), Leander (Travis part), Round Rock (Travis part).
- **Data snapshot:** no manifest CID exists in A-01 (nothing is published). The snapshot is the catalog's `snapshot_time` plus the SHA-256 of `pipeline/docs/travis-sources.yaml`, both recorded in `docs/evidence/A-01.md` at the live run; § 11 records that SHA per execution.
- No synthetic data is used in these cases. Negative cases mutate a **scratch copy** of the real catalog in a temporary folder and never touch committed files.

## 6. Environment, risks and dependencies

- **Runtime:** a terminal at the repository root, branch `001-discover-sources`; local Restate + Postgres stack; network access to the sources. No `RUNTIME_URL` (Project story).
- **Shell setup, pasted once per session** (read-only helpers; Node is already required by the pipeline):

```bash
V=pipeline/oracle-runtime/kit/use-oracle/scripts/validate-county-readiness.py
CAT=pipeline/docs/travis-sources.yaml
REP=docs/evidence/A-01-readiness.json
# catq EXPR [FILE]: print one catalog field as JSON, e.g. catq 'parcel.roll_year'
catq() { node -e "const y=require('./pipeline/oracle-runtime/node_modules/yaml');const c=y.parse(require('fs').readFileSync(process.argv[2]||'$CAT','utf8'));console.log(JSON.stringify(new Function('c','with(c){return '+process.argv[1]+'}')(c)))" "$1" "$2"; }
# repq EXPR: print one validator-report field as JSON, e.g. repq 'overall'
repq() { node -e "const r=JSON.parse(require('fs').readFileSync('$REP','utf8'));console.log(JSON.stringify(new Function('r','with(r){return '+process.argv[1]+'}')(r)))" "$1"; }
# every source request carries the project's identified User-Agent (NFR-001, ERR-1)
ORACLE_UA='oracle-travis-discovery/0.1 (PrismTeam Oracle Travis County pipeline; +https://github.com/prismteam-ai/oracle-property-intelligence-platform-pipeline-travis-tx)'
curl() { command curl -A "$ORACLE_UA" "$@"; }
```

- **Risks:** source counts drift daily (handled by capture-bounded recounts); TCAD may stay blocked (outcome B in § 3); Socrata may throttle without an app token (TC-008).

## 7. Coverage matrix

Types: CLI = terminal command and file checks; UNIT = automated unit test run from the terminal. Automation: each case is one test titled with its TC ID in `pipeline/oracle-runtime/test/acceptance/a01.acceptance.test.ts` (Vitest, shells out to the commands below). **Playwright: N/A**, as there is no hosted URL until A-03 (G4 C-04 exception).

| TC ID | Title | Priority | Tags | Type | Requirement(s) | Automated test |
| --- | --- | --- | --- | --- | --- | --- |
| A-01-TC-001 | Readiness verdict PASS (outcome A) | P1 | @smoke @happy | CLI | AC-1, FR-001, FR-001a | `a01.acceptance.test.ts › "A-01-TC-001 verdict PASS"` |
| A-01-TC-002 | All 9 § 4 source rows present | P1 | @happy | CLI | AC-1, FR-001b | `› "A-01-TC-002 all sources present"` |
| A-01-TC-003 | Destination proven by 2 independent identities | P1 | @happy @security | CLI | AC-1, FR-001c | `› "A-01-TC-003 destination proof"` |
| A-01-TC-004 | Incomplete records request blocks the gate | P1 | @negative | CLI | AC-1, FR-001d | `› "A-01-TC-004 incomplete records request"` |
| A-01-TC-005 | Comptroller: Travis-coded and statewide counts | P1 | @happy | CLI | FR-001e | `› "A-01-TC-005 comptroller counts"` |
| A-01-TC-006 | Austin row count and null `tcad_id` count | P1 | @happy @scale | CLI | AC-2, FR-002 | `› "A-01-TC-006 austin counts"` |
| A-01-TC-007 | Austin throughput, projection and decision | P1 | @happy | CLI | AC-2, FR-002 | `› "A-01-TC-007 austin throughput"` |
| A-01-TC-008 | Socrata 429 during measurement | P2 | @edge @error | UNIT | AC-2, FR-002, NFR-001 | `source-client.test.ts › "A-01-TC-008 429 backoff"` |
| A-01-TC-009 | TCAD certified count, key, deed dates (outcome A) | P1 | @happy @scale | CLI | AC-3, FR-003, FR-003a | `› "A-01-TC-009 tcad roll"` |
| A-01-TC-010 | GIS vs roll gap and 2% rule | P1 | @validation | CLI | AC-3, FR-003b | `› "A-01-TC-010 gis gap"` |
| A-01-TC-011 | GIS timeout recorded as missing with reason | P1 | @missing-data | CLI | AC-3, AC-6, FR-003b, FR-003c, FR-006 | `› "A-01-TC-011 gis timeout"` |
| A-01-TC-012 | JSON export lacks a legacy-layout field | P3 | @edge | CLI | AC-3 (edge case) | `› "A-01-TC-012 layouts"` |
| A-01-TC-013 | Every jurisdiction classified, count = Census + 1 | P1 | @happy @scale | CLI | AC-4, FR-004, FR-004a, FR-004b | `› "A-01-TC-013 jurisdictions"` |
| A-01-TC-014 | Austin-issued records recorded under Austin | P1 | @integration | CLI | AC-4, FR-004c | `› "A-01-TC-014 austin-issued"` |
| A-01-TC-015 | Spec label in `status` or a missing place is rejected | P1 | @negative | CLI | AC-4, FR-004a, FR-004b | `› "A-01-TC-015 vocabulary and count"` |
| A-01-TC-016 | Partial history, delegated and intake-only rows | P2 | @edge | CLI | AC-4, FR-004b | `› "A-01-TC-016 class edge rows"` |
| A-01-TC-017 | Sources above 48 h carry a decision | P1 | @validation | CLI | AC-5, FR-005 | `› "A-01-TC-017 48h decisions"` |
| A-01-TC-018 | TCAD 403: blocked, records request, documented blocker (outcome B) | P1 | @error @missing-data | CLI | AC-6, FR-001a, FR-001d, FR-006, FR-006c, FR-006d | `› "A-01-TC-018 tcad blocked"` |
| A-01-TC-019 | No retry with changed identity; 1 attempt on 403 | P1 | @security @negative | CLI + UNIT | AC-6, FR-006a, NFR-001 | `› "A-01-TC-019 no evasion"` |
| A-01-TC-020 | US check only with a saved geo signal | P1 | @security | CLI | AC-6, FR-006b | `› "A-01-TC-020 geo rule"` |
| A-01-TC-021 | BBB challenge recorded as blocked, no bypass | P2 | @error | CLI | AC-6, FR-006 | `› "A-01-TC-021 bbb blocked"` |
| A-01-TC-022 | Proof committed; summary regenerates with no diff | P1 | @happy | CLI | AC-7, FR-007, FR-007a | `› "A-01-TC-022 committed proof"` |
| A-01-TC-023 | Any number traced to URL + time in under 2 minutes | P2 | @usability | CLI (manual timed) | AC-7, FR-007a, SC-002 | manual; timing in § 11 |
| A-01-TC-024 | No secrets or absolute paths in evidence | P1 | @security @negative | CLI | AC-1, constitution XII | `› "A-01-TC-024 hygiene"` |
| A-01-TC-025 | Kit gate integrity and parser parity | P1 | @integration | CLI | AC-1, FR-001 | `› "A-01-TC-025 gate integrity"` |
| A-01-TC-026 | Throttling exhausted and TCAD download limits lead to waiting, not guesses | P1 | @error @missing-data | UNIT | AC-6, FR-006e, FR-003 | `workflow.blocked.test.ts › "A-01-TC-026 exhausted and download limits"` |
| A-01-TC-027 | Human resolves a waiting source | P1 | @recovery | CLI + UNIT | AC-6, FR-006f | `› "A-01-TC-027 resolve"` |
| A-01-TC-NF-01 | Source etiquette thresholds | P1 | @nfr | UNIT | NFR-001 | `source-client.test.ts › "A-01-TC-NF-01 etiquette"` |
| A-01-TC-NF-02 | Measurement stays a measurement (≤ 150,000 Austin rows read) | P2 | @nfr @scale | CLI | Clarification Q3, FR-002 | `› "A-01-TC-NF-02 bounded measurement"` |
| A-01-TC-NF-03 | Discovery run finishes within 8 hours | P2 | @nfr | CLI | SC-006 | `› "A-01-TC-NF-03 run duration"` |

## 8. Functional test cases

Common step 1 for every case: **Open** a terminal at the repository root and run `git branch --show-current` → prints `001-discover-sources`. Then paste the § 6 shell setup. "Prerequisite run" means `npm --prefix pipeline/oracle-runtime run discover` has completed with exit code `0` and produced `pipeline/docs/travis-sources.yaml`.

### A-01-TC-001: Readiness verdict PASS (happy path, outcome A)

- **Priority / tags:** P1 · `@smoke @happy`
- **Maps to:** AC-1, FR-001, FR-001a · demo line D-2
- **Preconditions:** prerequisite run done; `catq 'sources.find(s=>s.key==="tcad_certified").status'` prints `"available"` (otherwise record N/A and run TC-018).
- **Steps:**
  1. **Open** a terminal at the repo root; `git branch --show-current` → `001-discover-sources`.
  2. **Run** `npm --prefix pipeline/oracle-runtime run validate; echo "exit=$?"` → last line `exit=0`.
  3. **Run** `repq 'overall'` → `"PASS"`.
  4. **Run** `repq 'seed_allowed'` → `true`.
  5. **Run** `repq 'ingest_allowed'` → `true`.
  6. **Run** `repq 'execution_allowed'` → `true`.
  7. **Run** `repq 'gates.map(g=>g.gate+":"+g.status).join(",")'` → contains `catalog_metadata:PASS`, `parcel:PASS`, `permit:PASS`, `destination:PASS`, `enrichment:PASS` and no `BLOCKED`.
- **Expected result:** exit code 0; `overall: "PASS"`, `seed_allowed: true`, `ingest_allowed: true`; all five gates PASS; the report is saved at `docs/evidence/A-01-readiness.json`.

### A-01-TC-002: All 9 § 4 source rows present (happy path)

- **Priority / tags:** P1 · `@happy`
- **Maps to:** AC-1, FR-001b
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `catq 'sources.map(s=>s.key).sort()'` → exactly `["austin_permits","bbb","contractor_licensing","other_jurisdictions","overture","tcad_certified","tcad_gis","tcad_supplemental","tx_comptroller"]`.
  3. **Run** `catq 'sources.find(s=>s.key==="contractor_licensing").decision_reason'` → a string containing `no statewide roofing licence`.
  4. **Run** `catq 'sources.every(s=>s.url && s.captured_at)'` → `true`.
  5. **Run** `catq 'sources.find(s=>s.key==="overture").denominator.value'` → `null`.
  6. **Run** `catq 'sources.find(s=>s.key==="overture").denominator.missing_reason'` → `"not measured in A-01: optional source; licence gate decided in A-09"`.
- **Expected result:** 9 keys, no extras or omissions; contractor licensing recorded as "no statewide roofing licence" with evidence; Overture's denominator is `null` with the stated reason, not a guess; every row has a URL and capture time.

### A-01-TC-003: Destination proven by two independent identities (happy path)

- **Priority / tags:** P1 · `@happy @security`
- **Maps to:** AC-1, FR-001c
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `catq 'destination.writes_in_scope'` → `true`.
  3. **Run** `catq 'destination.proven'` → `true`.
  4. **Run** `catq 'destination.independent_identity_sources.length >= 2'` → `true` (3 since OR-m4: Docker side, SQL side and the configured connection; ERR-6).
  5. **Run** `catq 'new Set(destination.independent_identity_sources).size === destination.independent_identity_sources.length'` → `true`.
  6. **Run** `catq 'JSON.stringify(destination)' | grep -cE 'postgres://|password|DATABASE_URL'` → `0`.
  7. **Run** `repq 'gates.find(g=>g.gate==="destination").status'` → `"PASS"`.
- **Expected result:** at least two distinct identity entries (Docker side, SQL side, and since OR-m4 the configured connection); no connection URL, password or variable name recorded; the destination gate passes.

### A-01-TC-004: Incomplete records request blocks the gate (negative)

- **Priority / tags:** P1 · `@negative`
- **Maps to:** AC-1, FR-001d
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `catq 'permits.jurisdictions.filter(j=>["custodian-only","manual-only","blocked"].includes(j.status)).every(j=>j.records_request && j.records_request.recipient_office && j.records_request.system_scope && ["api-first","records-first"].includes(j.records_request.route) && (j.records_request.request_portal_url||j.records_request.request_email))'` → `true`.
  3. **Run** `T=$(mktemp -d); cp "$CAT" "$T/c.yaml"`.
  4. **Run** `node -e "const y=require('./pipeline/oracle-runtime/node_modules/yaml'),f=require('fs'),p='$T/c.yaml',c=y.parse(f.readFileSync(p,'utf8'));const j=c.permits.jurisdictions.find(j=>j.records_request);delete j.records_request.recipient_office;f.writeFileSync(p,y.stringify(c))"` → no output. (If step 2 finds no row with a records request, record "no records-request rows" and skip to the expected result.)
  5. **Run** `python3 "$V" "$T/c.yaml" > "$T/r.json"; echo "exit=$?"` → `exit=1`.
  6. **Run** `node -e "console.log(JSON.parse(require('fs').readFileSync('$T/r.json')).gates.find(g=>g.gate==='permit').status)"` → `BLOCKED`.
- **Expected result:** every records-request row in the real catalog is complete (step 2 `true`); removing one `recipient_office` on the scratch copy makes the validator exit 1 with the permit gate `BLOCKED`. Committed files are unchanged (`git status --short pipeline/docs` prints nothing).

### A-01-TC-005: Comptroller Travis-coded and statewide counts (happy path)

- **Priority / tags:** P1 · `@happy`
- **Maps to:** FR-001e
- **Test data:** `9cir-efmm`; reference 342,334 Travis-coded rows (code `227`) on 2026-10-19.
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `catq 'sources.find(s=>s.key==="tx_comptroller").travis_coded_rows'` → an object with integer `value`, `source_url` on `data.texas.gov/resource/9cir-efmm`, and UTC `captured_at`.
  3. **Run** `catq 'sources.find(s=>s.key==="tx_comptroller").statewide_rows.value'` → an integer greater than the Travis-coded value.
  4. **Run** `curl -s "$(catq 'sources.find(s=>s.key==="tx_comptroller").travis_coded_rows.source_url' | tr -d '"')"` → `[{"count":"N"}]` where |N − step 2's `value`| ≤ 0.5% of `value` (the active-holder list changes daily; a larger gap means the measurement is stale or wrong).
  5. **Run** `catq 'sources.find(s=>s.key==="tx_comptroller").denominator.value === sources.find(s=>s.key==="tx_comptroller").travis_coded_rows.value'` → `true`.
- **Expected result:** both counts present with provenance; the coverage denominator equals the Travis-coded count (reference 342,334 on 2026-10-19; the recount agrees within 0.5%); statewide is larger and kept as the A-07 lookup set.

### A-01-TC-006: Austin row count and null `tcad_id` count (happy path, scale)

- **Priority / tags:** P1 · `@happy @scale`
- **Maps to:** AC-2, FR-002 · demo line D-3
- **Test data:** `3syk-w9eu`; reference 2,380,725 rows (2026-10-19) and 63,019 null `tcad_id` (2026-10-17).
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `A='sources.find(s=>s.key==="austin_permits")'; catq "$A.denominator"` → `{value: <integer>, source_url: "…data.austintexas.gov/resource/3syk-w9eu…", captured_at: "<UTC>", method: "count(*)"}`.
  3. **Run** `TS=$(catq "$A.denominator.captured_at" | tr -d '"'); curl -sG https://data.austintexas.gov/resource/3syk-w9eu.json --data-urlencode '$select=count(*)' --data-urlencode '$where=1=1'` → `[{"count":"N"}]` where |N − step 2's `value`| ≤ 0.5% of `value`. The city reloads `3syk-w9eu` in full (every row has the same `:created_at`), so a recount bounded by `:created_at` is always 0 (ERR-3).
  4. **Run** `catq "$A.tcad_id_null_count"` → an object with integer `value`, `source_url`, `captured_at`.
  5. **Run** `curl -sG https://data.austintexas.gov/resource/3syk-w9eu.json --data-urlencode '$select=count(*)' --data-urlencode '$where=tcad_id IS NULL'` → count M.
  6. **Check** |M − step 4's `value`| ≤ 0.5% of step 4's `value`.
- **Expected result:** the denominator and the null-`tcad_id` count match today's recounts within 0.5% (references 2,380,725 and 63,019; on 2026-10-20 the recounts were 2,380,939 and 63,019).

### A-01-TC-007: Austin throughput, projection and decision (happy path)

- **Priority / tags:** P1 · `@happy`
- **Maps to:** AC-2, FR-002
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `A='sources.find(s=>s.key==="austin_permits")'; catq "$A.throughput.pages_read >= 3 && $A.throughput.page_size <= 50000"` → `true`.
  3. **Run** `catq "$A.throughput.rows_per_minute_median > 0 && Date.parse($A.throughput.window_end) > Date.parse($A.throughput.window_start)"` → `true`.
  4. **Run** `catq "Math.abs($A.projected_full_capture_hours - $A.denominator.value / $A.throughput.rows_per_minute_median / 60) <= 0.1"` → `true`.
  5. **Run** `catq "['bulk download','ingest','runtime retrieval'].includes($A.decision) && $A.decision_reason.length > 0"` → `true`.
  6. **Run** `catq "typeof $A.throughput.app_token_used"` → `"boolean"`.
  7. **Run** `catq "$A.anti_bot.length > 0"` → `true`.
- **Expected result:** at least 3 pages of at most 50,000 rows; a positive median rate over a real time window; projected hours = denominator ÷ median ÷ 60 (±0.1 h); a decision in the three allowed words with a reason; anti-bot posture and token use recorded.

### A-01-TC-008: Socrata 429 during measurement (edge, error handling)

- **Priority / tags:** P2 · `@edge @error`
- **Maps to:** AC-2, FR-002, NFR-001 · story edge case 3
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `npm --prefix pipeline/oracle-runtime test -- -t "A-01-TC-008"; echo "exit=$?"` → output lists the test `A-01-TC-008 429 backoff` as passed; last line `exit=0`.
  3. **Run** `catq 'sources.find(s=>s.key==="austin_permits").throughput.rate_limits_observed'` → a string (for example `"none"` or the observed limit).
- **Expected result:** the unit test proves a simulated 429 is retried at most 5 times with exponential delays starting at 1 s and capped at 60 s, honouring `Retry-After`; the live catalog records the observed limit (or `none`).

### A-01-TC-009: TCAD certified count, key and deed dates (happy path, outcome A)

- **Priority / tags:** P1 · `@happy @scale`
- **Maps to:** AC-3, FR-003, FR-003a
- **Preconditions:** outcome A (TCAD available); otherwise record N/A with TC-018.
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `catq 'parcel.assessed_parcel_count_measurement'` → `{value: <integer > 0> (equal to `parcel.assessed_parcel_count`), source_url, captured_at}` (first measurement; no reference value).
  3. **Run** `catq 'parcel.roll_year'` → `2026`.
  4. **Run** `catq 'parcel.certification_date'` → a string matching `YYYY-MM-DD`; **or**, when no official TCAD source states it (FR-003a amendment, ERR-4), `catq 'parcel.certification_date_measurement'` → `value: null` with a `missing_reason`, a `traviscad.org` `source_url` and a UTC `captured_at`.
  5. **Run** `catq 'parcel.identifier_name + "/" + parcel.identifier_layout_name'` → `"pID/prop_id"` (the key as printed in the 2026 JSON export, with its layout name; or a geo id with its layout name).
  6. **Run** `catq 'typeof parcel.deed_or_sale_dates_present'` → `"boolean"`.
  7. **Run** `F=$(catq 'parcel.export_receipt.file_path' | tr -d '"'); shasum -a 256 "$F" | cut -d' ' -f1` → a 64-character hash H.
  8. **Run** `catq 'parcel.export_receipt.sha256'` → `"H"` (the same hash as step 7).
  9. **Run** `git check-ignore -q "$F"; echo "exit=$?"` → `exit=0`.
  10. **Run** `git ls-files pipeline/data | wc -l` → `0`.
- **Expected result:** the 2026 certified account count is recorded with provenance; the key is printed exactly; deed/sale-date presence is a boolean; the downloaded file's SHA-256 matches the receipt; no TCAD file is tracked by git.

### A-01-TC-010: GIS vs roll gap and the 2% rule (validation)

- **Priority / tags:** P1 · `@validation`
- **Maps to:** AC-3, FR-003b
- **Preconditions:** `catq 'parcel.gis_feature_count'` is a number (otherwise TC-011 applies).
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `catq 'Math.abs(parcel.gap_pct - Math.abs(parcel.assessed_parcel_count - parcel.gis_feature_count) / parcel.assessed_parcel_count * 100) <= 0.01'` → `true`.
  3. **Run** `catq 'parcel.gap_pct <= 2 || parcel.discrepancy_explanation.length > 0'` → `true`.
  4. **Run** `catq 'parcel.gis_feature_count >= parcel.assessed_parcel_count || ["acknowledged","none"].includes(parcel.separately_assessed_without_geometry)'` → `true`.
  5. **Run** `catq 'parcel.canonical_source'` → `"TCAD 2026 certified roll"`.
- **Expected result:** the gap percentage is computed correctly; above 2% an explanation exists; GIS below the roll carries the acknowledgement; the roll, not GIS, is the canonical source.

### A-01-TC-011: GIS timeout recorded as missing with a reason (missing data)

- **Priority / tags:** P1 · `@missing-data`
- **Maps to:** AC-3, AC-6, FR-003b, FR-003c, FR-006
- **Test data:** the GIS layer timed out on 2026-10-17 and 2026-10-19.
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `catq 'sources.find(s=>s.key==="tcad_gis").status'` → `"blocked"` if the layer timed out at capture (otherwise TC-010 applies; record N/A).
  3. **Run** `catq 'parcel.gis_feature_count_measurement'` → `{value: null, missing_reason: "<text containing timeout>", source_url, captured_at}`.
  4. **Run** `catq 'parcel.gap_pct'` → `"unknown"`.
  5. **Run** `catq 'sources.find(s=>s.key==="tcad_gis").blocked_evidence.timeout_ms > 0'` → `true`.
  6. **Run** `catq '[sources.find(s=>s.key==="tcad_certified").anti_bot, sources.find(s=>s.key==="tcad_gis").anti_bot].every(a=>a && a.length>0)'` → `true`.
- **Expected result:** the GIS count is `null` with a timeout reason, never `0` and never guessed; the gap is `unknown`; blocked evidence records the timeout; TCAD and GIS anti-bot posture are recorded.

### A-01-TC-012: JSON export lacks a legacy-layout field (edge)

- **Priority / tags:** P3 · `@edge`
- **Maps to:** AC-3 · story edge case 4
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `grep -n -i "export layout" pipeline/docs/travis-county-findings.md` → at least one line.
  3. **Run** `grep -n -iE "fixed-width|special export \(json\)" pipeline/docs/travis-county-findings.md | wc -l` → `2` or more.
  4. **Run** `grep -n -i "A-04 uses" pipeline/docs/travis-county-findings.md` → one line naming the chosen layout.
- **Expected result:** the findings profile names both layouts, lists any field present in only one (for example the deed date), and states which layout A-04 uses.

### A-01-TC-013: Every jurisdiction classified, count = Census + 1 (happy path, scale)

- **Priority / tags:** P1 · `@happy @scale`
- **Maps to:** AC-4, FR-004, FR-004a, FR-004b
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `catq 'census_reference'` → `{dataset, vintage, source_url, captured_at, place_count: <integer>}`.
  3. **Run** `catq 'permits.expected_jurisdiction_count === census_reference.place_count + 1 && permits.jurisdictions.length === permits.expected_jurisdiction_count'` → `true`.
  4. **Run** `catq 'permits.jurisdictions.every(j=>["supported","delegated","manual-only","blocked","unavailable","excluded","custodian-only"].includes(j.status) && ["supported","records request","no public history"].includes(j.spec_class) && j.evidence_url && j.evidence_captured_at && typeof j.historical_records==="boolean")'` → `true`.
  5. **Run** `catq 'permits.jurisdictions.filter(j=>j.status==="needs-review").length'` → `0`.
  6. **Run** `catq '["Travis County","Austin","Pflugerville","Lakeway","Bee Cave","West Lake Hills","Manor","Sunset Valley","Rollingwood","Lago Vista","Jonestown","Briarcliff","Creedmoor","Mustang Ridge","Webberville","Cedar Park","Leander","Round Rock"].filter(n=>!permits.jurisdictions.some(j=>j.jurisdiction.includes(n)))'` → `[]`.
  7. **Run** `catq 'permits.assumes_unified_countywide_history'` → `false`.
  8. **Run** `repq 'gates.find(g=>g.gate==="permit").status'` → `"PASS"`.
- **Expected result:** the jurisdiction count equals the Census incorporated places with land in Travis County plus unincorporated; all 18 named leads are present; every row has one plain-language class, a valid validator status and dated evidence; nothing is left for review; the permit gate passes.

### A-01-TC-014: Austin-issued records recorded under Austin (integration)

- **Priority / tags:** P1 · `@integration`
- **Maps to:** AC-4, FR-004c
- **Test data:** `LAKEWAY FULL PURPOSE` 6,825; `BEE CAVE FULL PURPOSE` 4,822; Pflugerville 1,117 full purpose + 592 ETJ.
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `catq 'sources.find(s=>s.key==="austin_permits").located_in_other_jurisdictions.map(x=>x.jurisdiction+"="+x.value)'` → includes entries for `LAKEWAY FULL PURPOSE`, `BEE CAVE FULL PURPOSE`, and Pflugerville full purpose and ETJ.
  3. **Run** `curl -sG https://data.austintexas.gov/resource/3syk-w9eu.json --data-urlencode '$select=jurisdiction,count(*)' --data-urlencode '$group=jurisdiction' --data-urlencode "\$where=jurisdiction like '%LAKEWAY%' OR jurisdiction like '%BEE CAVE%' OR jurisdiction like '%PFLUGERVILLE%'"` → each count within 0.5% of its step 2 value (reference 6,825 / 4,822 / 1,117 / 592).
  4. **Run** `catq 'permits.jurisdictions.find(j=>j.jurisdiction.includes("Lakeway")).austin_issued_located_here.value > 0'` → `true`.
  5. **Run** `catq 'permits.jurisdictions.filter(j=>/Lakeway|Bee Cave|Pflugerville/.test(j.jurisdiction)).map(j=>j.jurisdiction+":"+j.spec_class+":"+(j.evidence_url.includes("data.austintexas.gov")?"austin-evidence":"own-evidence"))'` → three entries, each ending `:own-evidence` (each city's class rests on evidence about its own permit system, never on the Austin dataset).
- **Expected result:** Austin-issued records located in Lakeway, Bee Cave and Pflugerville are counted under Austin's source row with provenance; the city rows show them as informational `austin_issued_located_here` counts; no city's class is set by Austin's records.

### A-01-TC-015: Spec label in `status` or a missing place is rejected (negative)

- **Priority / tags:** P1 · `@negative`
- **Maps to:** AC-4, FR-004a, FR-004b
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `T=$(mktemp -d); cp "$CAT" "$T/c.yaml"`.
  3. **Run** `node -e "const y=require('./pipeline/oracle-runtime/node_modules/yaml'),f=require('fs'),p='$T/c.yaml',c=y.parse(f.readFileSync(p,'utf8'));c.permits.jurisdictions[0].status='records request';f.writeFileSync(p,y.stringify(c))"`.
  4. **Run** `python3 "$V" "$T/c.yaml" > "$T/r.json"; echo "exit=$?"` → `exit=1`.
  5. **Run** `node -e "console.log(JSON.parse(require('fs').readFileSync('$T/r.json')).gates.find(g=>g.gate==='permit').status)"` → `BLOCKED`.
  6. **Run** `cp "$CAT" "$T/d.yaml"` → no output.
  7. **Run** `node -e "const y=require('./pipeline/oracle-runtime/node_modules/yaml'),f=require('fs'),p='$T/d.yaml',c=y.parse(f.readFileSync(p,'utf8'));c.permits.jurisdictions.pop();f.writeFileSync(p,y.stringify(c))"` → no output.
  8. **Run** `npm --prefix pipeline/oracle-runtime run check-catalog -- "$T/d.yaml"; echo "exit=$?"` → output contains the line `FAIL rule 6: jurisdictions <n-1> != census place_count + 1 (<n>)`, where `<n>` is `catq 'permits.expected_jurisdiction_count'` on the real catalog; last line `exit=1`.
- **Expected result:** a plain-language class written into `status` makes the validator block the permit gate; a missing place makes the checker fail with the count mismatch. Committed files are unchanged.

### A-01-TC-016: Partial history, delegated and intake-only rows (edge)

- **Priority / tags:** P2 · `@edge`
- **Maps to:** AC-4, FR-004b · story edge case 1
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `catq 'permits.jurisdictions.filter(j=>j.status==="supported").every(j=>j.historical_records===true && j.earliest_record_date)'` → `true`.
  3. **Run** `catq 'permits.jurisdictions.filter(j=>j.status==="delegated").every(j=>j.issued_by && j.spec_class==="no public history")'` → `true`.
  4. **Run** `catq 'permits.jurisdictions.filter(j=>j.portal_kind==="application-intake").every(j=>j.historical_records===false && j.spec_class==="records request")'` → `true`.
  5. **Run** `catq 'permits.jurisdictions.filter(j=>j.status==="unavailable").every(j=>j.evidence_url)'` → `true`.
- **Expected result:** supported rows carry "supported from {earliest date}"; delegated rows name the issuing body; intake-only or one-stop portals are never treated as permit history; "no records" rows cite evidence.

### A-01-TC-017: Sources above 48 hours carry a decision (validation)

- **Priority / tags:** P1 · `@validation`
- **Maps to:** AC-5, FR-005
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `catq 'sources.filter(s=>s.projected_full_capture_hours > 48 && !(s.decision && s.decision_reason && (s.throughput || s.download_rate))).map(s=>s.key)'` → `[]`.
  3. **Run** `T=$(mktemp -d); cp "$CAT" "$T/c.yaml"` → no output.
  4. **Run** `node -e "const y=require('./pipeline/oracle-runtime/node_modules/yaml'),f=require('fs'),p='$T/c.yaml',c=y.parse(f.readFileSync(p,'utf8'));const s=c.sources.find(s=>s.key==='austin_permits');s.projected_full_capture_hours=49;delete s.decision;f.writeFileSync(p,y.stringify(c))"` → no output.
  5. **Run** `npm --prefix pipeline/oracle-runtime run check-catalog -- "$T/c.yaml"; echo "exit=$?"` → output contains the line `FAIL rule 3: austin_permits projected 49 h has no decision`; last line `exit=1`.
- **Expected result:** every source projected above 48 hours has a decision, a reason and the measurement behind it; removing the decision from such a row is rejected.

### A-01-TC-018: TCAD 403 recorded as blocked with a documented blocker (error / missing data, outcome B)

- **Priority / tags:** P1 · `@error @missing-data`
- **Maps to:** AC-6, FR-001a, FR-001d, FR-006, FR-006c, FR-006d
- **Test data:** HTTP 403 from `traviscad.org/publicinformation` on 2026-10-17 and 2026-10-19.
- **Preconditions:** `catq 'sources.find(s=>s.key==="tcad_certified").status'` prints `"blocked"` (otherwise record N/A; TC-001 and TC-009 apply).
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `B='sources.find(s=>s.key==="tcad_certified").blocked_evidence'; catq "$B.http_status"` → `403`.
  3. **Run** `catq "$B.url"` → a URL starting `"https://traviscad.org/`.
  4. **Run** `catq "$B.captured_at"` → a UTC time ending in `Z`.
  5. **Run** `test -f "$(catq "$B.evidence_path" | tr -d '"')" && git ls-files --error-unmatch "$(catq "$B.evidence_path" | tr -d '"')"; echo "exit=$?"` → `exit=0`.
  6. **Run** `catq 'sources.find(s=>s.key==="tcad_certified").records_request'` → an object with non-empty `recipient_office`, `system_scope` naming the 2026 certified and supplemental exports, `route` `"records-first"` or `"api-first"`, and `request_portal_url` or `request_email`.
  7. **Run** `npm --prefix pipeline/oracle-runtime run validate; echo "exit=$?"` → `exit=1`.
  8. **Run** `repq 'gates.filter(g=>g.status==="BLOCKED").map(g=>g.gate)'` → `["parcel"]`.
  9. **Run** `repq 'seed_allowed'` → `false`.
  10. **Run** `repq 'ingest_allowed'` → `false`.
  11. **Run** `grep -c "WAITING_HUMAN" docs/evidence/A-01.md` → `1` or more.
  12. **Run** `grep -ciE "TCAD.*(403|blocked)" docs/sources.md` → `1` or more.
  13. **Run** `catq 'parcel.assessed_parcel_count_measurement'` → `{value: null, missing_reason: "<text containing 403>", …}`.
- **Expected result:** TCAD is recorded as blocked with code 403, time, URL and committed evidence; a complete records request is named; the validator exits 1 with **only** the `parcel` gate blocked (catalog metadata, permit, destination and enrichment pass); seed and ingest stay forbidden; the run state `WAITING_HUMAN` and the missing roll count are documented in `docs/sources.md` and `docs/evidence/A-01.md`.

### A-01-TC-019: No retry with a changed identity; one attempt on 403 (security, negative)

- **Priority / tags:** P1 · `@security @negative`
- **Maps to:** AC-6, FR-006a, NFR-001
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `npm --prefix pipeline/oracle-runtime test -- -t "A-01-TC-019"; echo "exit=$?"` → the test `A-01-TC-019 no evasion` passes (a 403, a challenge page and a timeout each make exactly 1 attempt; the User-Agent is identical across all requests; no proxy or agent rotation is configured); last line `exit=0`.
  3. **Run** `catq '[...new Set([...sources, ...permits.jurisdictions].filter(x=>x.blocked_evidence).map(x=>x.blocked_evidence.attempts))]'` → `[1]`.
  4. **Run** `catq '[...new Set([...sources, ...permits.jurisdictions].filter(x=>x.blocked_evidence).map(x=>x.blocked_evidence.user_agent))].length'` → `1`.
  5. **Run** `env | grep -ciE '^(https?|all)_proxy='` → `0`.
- **Expected result:** blocked sources were tried once; one constant identified User-Agent across all evidence; no proxy configured; 0 CAPTCHA or bot-check bypasses.

### A-01-TC-020: US check only with a saved geo signal (security)

- **Priority / tags:** P1 · `@security`
- **Maps to:** AC-6, FR-006b
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `catq 'sources.flatMap(s=>[s.blocked_evidence,s.operator_blocked_evidence].filter(Boolean).map(e=>s.key+":"+e.geo_signal))'` → each entry is `<key>:none` or `<key>:<quoted signal text>` (a source captured from the US runner keeps its operator-side stop in `operator_blocked_evidence`; ERR-6).
  3. **If every signal is `none`: run** `test -e .github/workflows/geo-check.yml; echo "exit=$?"` → `exit=1`.
  4. **If every signal is `none`: run** `grep -c "N/A: no geo signal" docs/evidence/A-01.md` → `1`.
  5. **If a signal is quoted: run** `gh run list -R HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx --workflow a01-us-gis-probe.yml --branch 001-discover-sources --json conclusion --jq length` → `1` (the US check, FR-006b amendment, DEC-A-01-source-access D-2).
  6. **If a signal is quoted: run** `grep -cE "^http_status: 200|HTTP 200" docs/evidence/A-01-us-gis-runner.md` → `1` or more (the US run's status code is recorded).
- **Expected result:** a plain 403 (signal `none`) never triggers a US request, and the workflow does not exist; only a saved, quoted geo signal leads to exactly one US run, with its result recorded.

### A-01-TC-021: BBB challenge recorded as blocked, no bypass (error)

- **Priority / tags:** P2 · `@error`
- **Maps to:** AC-6, FR-006 · spec edge case "BBB answers with a bot challenge"
- **Test data:** Cloudflare challenge observed 2026-10-17.
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `catq 'sources.find(s=>s.key==="bbb").status'` → `"blocked"`.
  3. **Run** `catq 'enrichment.bbb.status'` → `"blocked"`.
  4. **Run** `catq 'enrichment.bbb.expected_count === undefined || enrichment.bbb.expected_count !== enrichment.bbb.advertised_listing_count'` → `true`.
  5. **Run** `catq 'sources.find(s=>s.key==="bbb").decision_reason'` → a string containing `BBB API`.
  6. **Run** `repq 'gates.find(g=>g.gate==="enrichment").status'` → `"PASS"`.
- **Expected result:** BBB is recorded as blocked with evidence; no advertised listing total is presented as a harvestable count; the next step is the official API application (recorded only); the enrichment gate passes.

### A-01-TC-022: Proof committed; summary regenerates with no diff (happy path)

- **Priority / tags:** P1 · `@happy`
- **Maps to:** AC-7, FR-007, FR-007a
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `git ls-files pipeline/docs/travis-sources.yaml docs/sources.md docs/evidence/A-01-readiness.json | wc -l` → `3`.
  3. **Run** `npm --prefix pipeline/oracle-runtime run render-sources; echo "exit=$?"` → `exit=0`.
  4. **Run** `git diff --exit-code docs/sources.md; echo "exit=$?"` → `exit=0` (no diff).
  5. **Run** `grep -E '\| *[0-9][0-9,]* *\|' docs/sources.md | grep -vcE 'https?://.*[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z'` → `0` (every table row with a number also has a URL and a UTC time).
  6. **Run** `for f in docs/sources.md pipeline/docs/travis-county-findings.md docs/evidence/A-01.md docs/evidence/A-01-coverage.md; do awk 'NR==1&&$0!="---"{print FILENAME": no front matter";exit} /^id: /{i=1} /^parent: /{p=1} NR>1&&/^---$/{if(!(i&&p))print FILENAME": missing id or parent";exit}' "$f"; done` → no output.
- **Expected result:** the catalog, summary and validator report are tracked on the story branch (visible in the PR); the summary is generated from the catalog, so regenerating it changes nothing; every number has a source URL and a UTC capture time; every committed A-01 Markdown file starts with front matter carrying `id` and `parent` (FR-007b).

### A-01-TC-023: Any number traced to URL and time in under 2 minutes (usability, timed)

- **Priority / tags:** P2 · `@usability`
- **Maps to:** AC-7, FR-007a, SC-002
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `grep -nE '[0-9]{1,3}(,[0-9]{3})+' docs/sources.md | shuf -n 3` → three lines with numbers.
  3. **For each line, start a stopwatch, open the source URL printed on that line in a browser, and read the capture time on the same line**, then stop the stopwatch.
- **Expected result:** each of the three numbers is traced to its source page and UTC capture time in under 2 minutes; times recorded in § 11.

### A-01-TC-024: No secrets or absolute paths in evidence (security, negative)

- **Priority / tags:** P1 · `@security @negative`
- **Maps to:** AC-1, constitution XII
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `grep -rnE 'postgres(ql)?://|/Users/|password=|X-App-Token: *[A-Za-z0-9]' pipeline/docs docs/sources.md docs/evidence; echo "exit=$?"` → no matching lines; `exit=1`.
  3. **Run** `repq 'catalog_path'` → `"pipeline/docs/travis-sources.yaml"`.
  4. **Run** `gitleaks detect --source . --log-opts "feature/oracle-pipeline..001-discover-sources" --no-banner; echo "exit=$?"` → `no leaks found`; `exit=0`.
- **Expected result:** no connection strings, home paths, passwords or tokens in any committed evidence; the report shows the relative catalog path; gitleaks finds nothing on the branch.

### A-01-TC-025: Kit gate integrity and parser parity (integration)

- **Priority / tags:** P1 · `@integration`
- **Maps to:** AC-1, FR-001
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `python3 "$V" --self-test; echo "exit=$?"` → `exit=0`.
  3. **Run** `shasum -a 256 "$V" | cut -d' ' -f1` → the value listed for this file in `pipeline/oracle-runtime/kit/VENDORED.md`, which equals `shasum -a 256 ~/.claude/plugins/cache/soofi-xyz/soofi-xyz-team-kit/0.99.1/skills/use-oracle/scripts/validate-county-readiness.py`.
  4. **Run** `T=$(mktemp -d); python3 "$V" "$CAT" > "$T/with.json"` → no output (PyYAML parser).
  5. **Run** `python3 -s "$V" "$CAT" > "$T/without.json"` → no output (`-s` skips the user site, so the fallback parser runs).
  6. **Run** `diff "$T/with.json" "$T/without.json"; echo "exit=$?"` → no diff lines; `exit=0`.
- **Expected result:** the vendored validator is byte-identical to kit 0.99.1 and passes its own self-test; both YAML parsers (PyYAML and the fallback) give the identical report.

### A-01-TC-026: Throttling exhausted and TCAD download limits lead to waiting, not guesses (error / missing data)

- **Priority / tags:** P1 · `@error @missing-data`
- **Maps to:** AC-6, FR-006e, FR-003 · spec edge cases "too many requests after 5 attempts" and "TCAD download stalls"
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `npm --prefix pipeline/oracle-runtime test -- -t "A-01-TC-026"; echo "exit=$?"` → output lists `A-01-TC-026 exhausted and download limits` with 0 failed assertions; last line `exit=0`.
  3. **Run** `catq '[...sources, ...permits.jurisdictions].filter(x=>x.blocked_evidence && x.blocked_evidence.outcome==="failed").every(x=>JSON.stringify(x).includes("\"value\":null") && JSON.stringify(x).includes("throttled: 5 attempts exhausted"))'` → `true` (also `true` when no source was throttled).
- **Expected result (measurable):** in the unit test, a source answering 429 on all 5 attempts ends with `blocked_evidence.outcome: "failed"`, `attempts: 5`, its measurement `null` with "throttled: 5 attempts exhausted", and the run `WAITING_HUMAN` for that source only (other sources finish); a TCAD download with no data for 10 minutes, or running past 2 hours, ends `outcome: "blocked"` with `timeout_ms` ≥ 600,000 or ≥ 7,200,000 respectively; in the live catalog, no throttled value is ever recorded as a number.

### A-01-TC-027: Human resolves a waiting source (recovery)

- **Priority / tags:** P1 · `@recovery`
- **Maps to:** AC-6, FR-006f
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `npm --prefix pipeline/oracle-runtime run resolve -- austin_permits captured; echo "exit=$?"` while `austin_permits` is not waiting → last line `exit=2` (refused before anything is sent: no run id, or the catalog could not be rewritten; ERR-6).
  3. **Run** `npm --prefix pipeline/oracle-runtime test -- -t "A-01-TC-027"; echo "exit=$?"` → output lists `A-01-TC-027 resolve` with 0 failed assertions; last line `exit=0`.
  4. **If TCAD is blocked (outcome B): run** `npm --prefix pipeline/oracle-runtime run resolve -- tcad_certified still-blocked; echo "exit=$?"` → last line `exit=0`.
  5. **If step 4 ran: run** `grep -cE "tcad_certified.*still blocked" docs/evidence/A-01.md` → `1` or more.
- **Expected result:** resolving a source that is not waiting is refused (`exit=1`); in the unit test, `captured` re-probes only that source exactly once with the same User-Agent and then rewrites the catalog and re-runs the validator, while `still-blocked` leaves the run `WAITING_HUMAN`; for a real TCAD block, `still-blocked` is recorded in the story evidence as the documented blocker.

### A-01-TC-NF-01: Source etiquette thresholds (NFR)

- **Priority / tags:** P1 · `@nfr`
- **Maps to:** NFR-001
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `npm --prefix pipeline/oracle-runtime test -- -t "A-01-TC-NF-01"; echo "exit=$?"` → output lists `A-01-TC-NF-01 etiquette` with 0 failed assertions for the four thresholds below; last line `exit=0`.
- **Expected result (measurable):** with 10 requests queued to one host, at most **2** are in flight at any moment; on 429/5xx the delays are ≤ 1 s, ≤ 2 s, ≤ 4 s, … capped at **60 s**, with at most **5** attempts; every request carries the same identified User-Agent; **0** CAPTCHA or bot-check solving code paths exist (403/challenge → stop).

### A-01-TC-NF-02: Measurement stays a measurement (NFR, scale)

- **Priority / tags:** P2 · `@nfr @scale`
- **Maps to:** clarification Q3, FR-002
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `catq 'sources.find(s=>s.key==="austin_permits").throughput.pages_read * sources.find(s=>s.key==="austin_permits").throughput.page_size'` → a number ≤ `150000` when `pages_read` is `3` (≈ 6% of 2,380,725).
  3. **Run** `ls pipeline/data/raw 2>/dev/null` → only `tcad`, plus `gis/us-runner-<run id>` holding the 16-byte US-runner count answer (no Austin, Comptroller or GIS row dumps; ERR-6).
- **Expected result:** throughput measurement reads at most 3 pages of 50,000 Austin rows by default (more pages only if documented), and no dataset other than the one TCAD export is downloaded in A-01.

### A-01-TC-NF-03: Discovery run finishes within 8 hours (NFR)

- **Priority / tags:** P2 · `@nfr`
- **Maps to:** SC-006
- **Steps:**
  1. **Open** the terminal at the repo root on `001-discover-sources`.
  2. **Run** `catq '(Date.parse(snapshot_time) - Math.min(...sources.map(s=>Date.parse(s.captured_at)))) / 3600000 - (waiting_human_hours || 0)'` → a number ≤ `8`.
- **Expected result (measurable):** from the first source capture to the catalog snapshot, the run takes at most 8 hours of wall time, after subtracting `waiting_human_hours` (time spent waiting for a human, recorded in the catalog; `0` when nothing waited).

## 9. Edge cases

- A jurisdiction portal exists but has no history before a given year → row is `supported` with `earliest_record_date` set (TC-016 step 2).
- The Austin count changes between discovery and backfill → the stored count keeps its `captured_at`; the recount is bounded by it (TC-006 step 3); A-06 reconciles at its own watermark.
- Socrata answers 429 during measurement → backoff 1 s base, 60 s cap, 5 attempts; observed limit recorded (TC-008).
- The TCAD JSON export lacks a legacy-layout field → both layouts recorded, with the one A-04 uses (TC-012).
- TCAD reachable but GIS times out → TCAD measured; GIS `null` with reason, gap `unknown` (TC-011 with TC-009).
- The Census list contains a place outside the 18 leads → it appears as its own row and the count still matches (TC-013 steps 3 and 6).
- BBB bot challenge → blocked, no bypass, API application as next step (TC-021).

## 10. Gap-linked cases (expected to fail until fixed)

| TC ID | Asserts | Gap | Defect |
| --- | --- | --- | --- |
| A-01-TC-001 | Verdict PASS with seed and ingest allowed | TCAD HTTP 403 (2026-10-17, 2026-10-19): while it persists, outcome B applies and TC-001 is recorded N/A, not FAIL (spec FR-006c) | — (documented blocker, not a defect) |
| A-01-TC-009 | TCAD certified account count measured | Same TCAD 403 | — |

## 11. Execution log (filled in Phase 5)

Full results for every case: `docs/reports/A-01-test-report.md` (2026-10-20, 27/27 applicable pass).

**v0.7 (2026-10-20):** updated after the first end-to-end QC run to match the automation: the § 6 setup (identified User-Agent, ERR-1; compound expressions, ERR-2), TC-006 recount (ERR-3), TC-009 step 4 (ERR-4, FR-003a amendment), TC-003, TC-020, TC-027 and TC-NF-02 (ERR-6). The G6 approval above was given on v0.6; these edits follow approved PO decisions and fixed defects, and re-approval is the PO's call.

| TC ID | Run date | Build (sha) | Catalog SHA-256 | Result | Evidence | Defect |
| --- | --- | --- | --- | --- | --- | --- |
| A-01-TC-001 | 2026-10-20 | `9c7579a` | `0616593dccae3c67cb59fd60a1b945116ebe6aae5c6c5a6436fa6a1ea4fef701` | PASS (outcome A) | `docs/evidence/A-01-readiness.json` | — |
| A-01-TC-023 | 2026-10-20 | `8a1145a` | `0616593dccae3c67cb59fd60a1b945116ebe6aae5c6c5a6436fa6a1ea4fef701` | PASS (about 1 min, PO) | `docs/reports/A-01-test-report.md` | — |

---

## Gate G6: Test Case Approval

| # | Criterion | Status |
| --- | --- | --- |
| G6-1 | Every AC and every FR maps to at least one TC (§ 2 and § 7) | ☑ |
| G6-2 | Happy, negative, edge and missing-data paths covered | ☑ |
| G6-3 | NFRs have test cases with measurable pass criteria | ☑ |
| G6-4 | Every case is a complete sequence starting from the hosted URL | ☑ |
| G6-5 | Negative cases state the exact message or rejection behavior | ☑ |
| G6-6 | Test data and environment documented, with real records | ☑ |
| G6-7 | Every TC traces to the story and a requirement | ☑ |
| G6-8 | AI pre-check (`developmentsupport-g6-precheck`): PASS | ☑ |

**Decision:** ☑ Approved ☐ Returned · 2026-10-19 (HebaGaber, QC Lead). G6-4 (hosted URL), C-07 (manifest CID) and C-09 (Playwright) accepted as justified exceptions: Project story, no hosted runtime until A-03 (same basis as G4 C-04, G5 C-05).
