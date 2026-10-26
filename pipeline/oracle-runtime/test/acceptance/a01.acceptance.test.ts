// T055: acceptance tests for testplans/A-01-test-cases.md (QC-TC-A-01 v0.5).
//
// One test per case whose "Automated test" column names a01.acceptance.test.ts, titled
// exactly with its TC ID. Test bodies call step helpers only (a01.steps.ts). They run
// against the committed live catalog, validator report and evidence, so they fail until
// the live run (T048-T051) has produced them. Excluded from `npm test`; run with
// `npm --prefix pipeline/oracle-runtime run test:acceptance`.
//
// Not here, by the plan's mapping: TC-008, TC-026 and TC-NF-01 are unit tests
// (source-client.test.ts, workflow.blocked.test.ts); TC-023 is a manual timed check.
//
// Exactly one TCAD outcome applies (§ 3): outcome A (TCAD available) runs TC-001 and TC-009
// and skips TC-018; outcome B (TCAD blocked) runs TC-018 and skips TC-001 and TC-009.
import { describe, it } from "vitest";
import {
  gisBlocked,
  gisCounted,
  prerequisiteRun,
  skipWhen,
  step1OpenTerminal,
  tc001,
  tc002,
  tc003,
  tc004,
  tc005,
  tc006,
  tc007,
  tc009,
  tc010,
  tc011,
  tc012,
  tc013,
  tc014,
  tc015,
  tc016,
  tc017,
  tc018,
  tc019,
  tc020,
  tc021,
  tc022,
  tc024,
  tc025,
  tc027,
  tcNf02,
  tcNf03,
  tcadOutcome,
} from "./a01.steps.js";

const OUTCOME = tcadOutcome();
const OUTCOME_B_REASON =
  "outcome B: TCAD is blocked, so this case is recorded N/A with the blocker (spec FR-006c); TC-018 applies";
const OUTCOME_A_REASON = "outcome A: TCAD is available, so TC-018 is N/A; TC-001 and TC-009 apply";

describe("A-01 acceptance (testplans/A-01-test-cases.md)", () => {
  it("A-01-TC-001 verdict PASS", (ctx) => {
    skipWhen(ctx, OUTCOME === "B", OUTCOME_B_REASON);
    step1OpenTerminal();
    prerequisiteRun();
    tc001.step2Validate();
    tc001.step3Overall();
    tc001.step4Seed();
    tc001.step5Ingest();
    tc001.step6Execution();
    tc001.step7Gates();
  });

  it("A-01-TC-002 all sources present", () => {
    step1OpenTerminal();
    prerequisiteRun();
    tc002.step2Keys();
    tc002.step3Licensing();
    tc002.step4Provenance();
    tc002.step5OvertureNull();
    tc002.step6OvertureReason();
  });

  it("A-01-TC-003 destination proof", () => {
    step1OpenTerminal();
    prerequisiteRun();
    tc003.step2Writes();
    tc003.step3Proven();
    tc003.step4Two();
    tc003.step5Distinct();
    tc003.step6NoSecrets();
    tc003.step7Gate();
  });

  it("A-01-TC-004 incomplete records request", (ctx) => {
    step1OpenTerminal();
    prerequisiteRun();
    tc004.step2Complete();
    const dir = tc004.step3Scratch();
    const mutated = tc004.step4RemoveOffice(dir);
    skipWhen(ctx, !mutated, "no records-request rows in the catalog (step 4 note)");
    tc004.step5Validator(dir);
    tc004.step6PermitBlocked(dir);
    tc004.expectedCommittedUnchanged();
  });

  it("A-01-TC-005 comptroller counts", () => {
    step1OpenTerminal();
    prerequisiteRun();
    const travis = tc005.step2TravisCoded();
    tc005.step3Statewide(travis);
    tc005.step4Recount(travis);
    tc005.step5Denominator();
  });

  it("A-01-TC-006 austin counts", () => {
    step1OpenTerminal();
    prerequisiteRun();
    const value = tc006.step2Denominator();
    tc006.step3Recount(value);
    const nulls = tc006.step4NullCount();
    const recount = tc006.step5NullRecount();
    tc006.step6NullDrift(nulls, recount);
  });

  it("A-01-TC-007 austin throughput", () => {
    step1OpenTerminal();
    prerequisiteRun();
    tc007.step2Pages();
    tc007.step3Window();
    tc007.step4Projection();
    tc007.step5Decision();
    tc007.step6Token();
    tc007.step7AntiBot();
  });

  it("A-01-TC-009 tcad roll", (ctx) => {
    skipWhen(ctx, OUTCOME === "B", OUTCOME_B_REASON);
    step1OpenTerminal();
    prerequisiteRun();
    tc009.step2Count();
    tc009.step3RollYear();
    tc009.step4Certification();
    tc009.step5Identifier();
    tc009.step6DeedDates();
    const hash = tc009.step7FileHash();
    tc009.step8ReceiptHash(hash);
    tc009.step9Ignored();
    tc009.step10NotTracked();
  });

  it("A-01-TC-010 gis gap", (ctx) => {
    step1OpenTerminal();
    prerequisiteRun();
    skipWhen(ctx, !gisCounted(), "GIS is not counted (precondition): TC-011 applies");
    tc010.step2Gap();
    tc010.step3Explanation();
    tc010.step4Acknowledged();
    tc010.step5Canonical();
  });

  it("A-01-TC-011 gis timeout", (ctx) => {
    step1OpenTerminal();
    prerequisiteRun();
    skipWhen(ctx, !gisBlocked(), "GIS was reachable at capture: TC-010 applies (N/A)");
    tc011.step2Blocked();
    tc011.step3NullWithReason();
    tc011.step4GapUnknown();
    tc011.step5Timeout();
    tc011.step6AntiBot();
  });

  it("A-01-TC-012 layouts", () => {
    step1OpenTerminal();
    prerequisiteRun();
    tc012.step2ExportLayout();
    tc012.step3BothLayouts();
    tc012.step4ChosenLayout();
  });

  it("A-01-TC-013 jurisdictions", () => {
    step1OpenTerminal();
    prerequisiteRun();
    tc013.step2Census();
    tc013.step3Count();
    tc013.step4Classes();
    tc013.step5NoReview();
    tc013.step6Leads();
    tc013.step7NoUnified();
    tc013.step8Gate();
  });

  it("A-01-TC-014 austin-issued", () => {
    step1OpenTerminal();
    prerequisiteRun();
    const recorded = tc014.step2Entries();
    tc014.step3Recount(recorded);
    tc014.step4Lakeway();
    tc014.step5OwnEvidence();
  });

  it("A-01-TC-015 vocabulary and count", () => {
    step1OpenTerminal();
    prerequisiteRun();
    const dir = tc015.step2Scratch();
    tc015.step3SpecLabel(dir);
    tc015.step4Validator(dir);
    tc015.step5PermitBlocked(dir);
    tc015.step6Copy(dir);
    tc015.step7Pop(dir);
    tc015.step8Checker(dir);
  });

  it("A-01-TC-016 class edge rows", () => {
    step1OpenTerminal();
    prerequisiteRun();
    tc016.step2Supported();
    tc016.step3Delegated();
    tc016.step4Intake();
    tc016.step5Unavailable();
  });

  it("A-01-TC-017 48h decisions", () => {
    step1OpenTerminal();
    prerequisiteRun();
    tc017.step2Decisions();
    const dir = tc017.step3Scratch();
    tc017.step4Remove(dir);
    tc017.step5Checker(dir);
  });

  it("A-01-TC-018 tcad blocked", (ctx) => {
    skipWhen(ctx, OUTCOME === "A", OUTCOME_A_REASON);
    step1OpenTerminal();
    prerequisiteRun();
    tc018.step2Status403();
    tc018.step3Url();
    tc018.step4Time();
    tc018.step5EvidenceCommitted();
    tc018.step6RecordsRequest();
    tc018.step7Validate();
    tc018.step8OnlyParcel();
    tc018.step9Seed();
    tc018.step10Ingest();
    tc018.step11WaitingHuman();
    tc018.step12Summary();
    tc018.step13RollMissing();
  });

  it("A-01-TC-019 no evasion", () => {
    step1OpenTerminal();
    prerequisiteRun();
    tc019.step2Unit();
    tc019.step3OneAttempt();
    tc019.step4OneAgent();
    tc019.step5NoProxy();
  });

  it("A-01-TC-020 geo rule", () => {
    step1OpenTerminal();
    prerequisiteRun();
    const allNone = tc020.step2Signals();
    if (allNone) {
      tc020.step3NoWorkflow();
      tc020.step4NotApplicable();
    } else {
      tc020.step5OneUsRun();
      tc020.step6UsStatusRecorded();
    }
  });

  it("A-01-TC-021 bbb blocked", () => {
    step1OpenTerminal();
    prerequisiteRun();
    tc021.step2SourceBlocked();
    tc021.step3EnrichmentBlocked();
    tc021.step4NotAdvertised();
    tc021.step5ApiNextStep();
    tc021.step6Gate();
  });

  it("A-01-TC-022 committed proof", () => {
    step1OpenTerminal();
    prerequisiteRun();
    tc022.step2Tracked();
    tc022.step3Render();
    tc022.step4NoDiff();
    tc022.step5Provenance();
    tc022.step6FrontMatter();
  });

  it("A-01-TC-024 hygiene", () => {
    step1OpenTerminal();
    prerequisiteRun();
    tc024.step2NoSecrets();
    tc024.step3RelativePath();
    tc024.step4Gitleaks();
  });

  it("A-01-TC-025 gate integrity", () => {
    step1OpenTerminal();
    prerequisiteRun();
    tc025.step2SelfTest();
    tc025.step3Hash();
    const dir = tc025.step4WithPyYaml();
    tc025.step5WithoutPyYaml(dir);
    tc025.step6Identical(dir);
  });

  it("A-01-TC-027 resolve", () => {
    step1OpenTerminal();
    prerequisiteRun();
    tc027.step2RefuseNotWaiting();
    tc027.step3Unit();
    if (OUTCOME === "B") {
      tc027.step4StillBlocked();
      tc027.step5Recorded();
    }
  });

  it("A-01-TC-NF-02 bounded measurement", () => {
    step1OpenTerminal();
    prerequisiteRun();
    tcNf02.step2Bounded();
    tcNf02.step3OnlyTcad();
  });

  it("A-01-TC-NF-03 run duration", () => {
    step1OpenTerminal();
    prerequisiteRun();
    tcNf03.step2Duration();
  });
});
