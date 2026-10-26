// A-14 hosted UI cases (testplans/A-14-test-cases.md; demo lines D-10 and D-11 in order, then
// D-12's "Try a tool"): the Explore · AI tab (`?mode=ai`, apps/web/src/routes/ExploreAi.tsx) and
// Help · MCP. One test per UI case, titled `@scenario:A-14-TC-{nnn}`; every assertion saves a
// checkpoint screenshot at docs/evidence/img/A-14-TC-{nnn}-{step}.png. Runs against RUNTIME_URL
// only (https://014-agent-and-mcp.d2lx0utip89u18.amplifyapp.com for the story preview); loading
// this file throws for a localhost URL.
//
// Real model calls vs stubbed responses
//  - The shared Bedrock budget is 10 requests a minute, so this file makes at most 6 REAL asks
//    (MAX_REAL_ASKS; the helper throws on the 7th) with a 7 s gap between them (ASK_GAP_MS):
//    TC-001 (G1), TC-002 (G2), TC-009 (the edited-chip re-ask), TC-004 (G6), TC-006 (G4) and
//    TC-007 (G5). TC-003 only reads the G2 answer already on screen. TC-005 (G3) and TC-008
//    (Round Rock) would be a 7th and 8th ask, so they run only when A14_EXTRA_ASKS=1.
//  - The UI cannot pin a manifest, and the latest run (Run 2, full county) is too heavy for the
//    server, so a real ask about roof age may honestly end in "Took too long", "could not answer"
//    or "busy". The real tests therefore assert an HONEST TERMINAL STATE (answered, no results,
//    throttled, paused, timed out, failed, unreachable), never an invented answer, and check the
//    answer content (centre, radius, threshold, citations, provenance) only when the agent did
//    answer. Which state each ask ended in is recorded as a test annotation and in
//    docs/evidence/A-14-agent-timings.json.
//  - States that cannot be provoked for real (throttled, paused, limit reached, a 23 s server
//    timeout) are driven with page.route() on /api/agent/ask in this browser only. Those tests
//    carry `[stubbed-response]` in their title: TC-010 and TC-013.
//  - TC-011 (provider switch) is a deployment/config comparison, not a browser case: skipped.
//
// Run: RUNTIME_URL=https://014-agent-and-mcp.d2lx0utip89u18.amplifyapp.com \
//      pnpm --filter @countylens/e2e exec playwright test --project=a14-agent
import type { Browser, BrowserContext, Locator, Page, Response, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AI_TEXTS, ROUTES } from "@countylens/shared";
import {
  GOLDEN,
  SMALL_RUN_MANIFEST_CID,
  a14Checkpoint,
  percentile,
  scenario14,
} from "./lib/a14.js";
import { repoRoot, runtimeUrl } from "./lib/runtime.js";

const RUNTIME = runtimeUrl();

const MAX_REAL_ASKS = process.env.A14_EXTRA_ASKS === "1" ? 8 : 6;
const ASK_GAP_MS = 7_000;
/** Client stop (25 s, AD-27 layer 3) plus a margin for the render. */
const TERMINAL_WAIT_MS = AI_TEXTS.clientStopMs + 10_000;
const SESSION_KEY = "countylens.ai.questions";

type AiState =
  | "idle"
  | "working"
  | "answered"
  | "no_results"
  | "throttled"
  | "paused"
  | "timed_out"
  | "failed"
  | "cancelled"
  | "unreachable"
  | "limit";

const TERMINAL: readonly AiState[] = [
  "answered",
  "no_results",
  "throttled",
  "paused",
  "timed_out",
  "failed",
  "unreachable",
];

/** The fixed UI text each non-answer state must show (AI_TEXTS, no invented answer). */
const STATE_TEXT: Partial<Record<AiState, string>> = {
  throttled: AI_TEXTS.throttled,
  paused: AI_TEXTS.paused,
  timed_out: AI_TEXTS.timedOut,
  failed: AI_TEXTS.failed,
  unreachable: AI_TEXTS.unreachable,
};

interface AskRecord {
  readonly tc: string;
  readonly prompt: string;
  readonly state: AiState;
  readonly ms: number;
  readonly httpStatus: number | null;
  readonly outcome: string | null;
  readonly steps: number | null;
  readonly matches: number | null;
}

/** Every real ask of this file, in order (read by TC-NF-01 and written to the evidence file). */
const askLog: AskRecord[] = [];
let lastRealAskEndedAt = 0;

const panelOf = (page: Page): Locator => page.locator('[data-panel="ai"]');
const stateOf = async (page: Page): Promise<AiState> =>
  (await panelOf(page).getAttribute("data-ai-state")) as AiState;

/** Opens Explore, clicks the AI tab and waits for the idle panel (steps 1 and 2 of every case). */
async function openAiTab(page: Page): Promise<void> {
  await page.goto(`${RUNTIME}${ROUTES.explore}`);
  await page.getByRole("tab", { name: "AI" }).click();
  await expect(panelOf(page)).toHaveAttribute("data-ai-state", "idle", { timeout: 60_000 });
}

/** Types the prompt and submits. Returns once the click is done. */
async function submit(page: Page, prompt: string): Promise<void> {
  await page.locator("#ai-question").fill(prompt);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
}

/** Waits until the panel leaves idle/working and returns the state it ended in. */
async function terminal(page: Page, timeout = TERMINAL_WAIT_MS): Promise<AiState> {
  await expect(panelOf(page)).not.toHaveAttribute("data-ai-state", /^(idle|working)$/, { timeout });
  return stateOf(page);
}

/**
 * One REAL ask against the hosted agent. Enforces the budget (MAX_REAL_ASKS) and the 7 s gap,
 * records state, time and the response shape. Takes a "Working…" checkpoint when the spinner is
 * seen, and returns the terminal state.
 */
async function realAsk(page: Page, tc: string, prompt: string): Promise<AiState> {
  if (askLog.length >= MAX_REAL_ASKS) {
    throw new Error(`A-14 real-ask budget of ${MAX_REAL_ASKS} is used up; ${tc} must not ask`);
  }
  const wait = lastRealAskEndedAt + ASK_GAP_MS - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);

  let httpStatus: number | null = null;
  let body: { outcome?: string; steps?: unknown[]; matches?: unknown[] } | null = null;
  const onResponse = (response: Response): void => {
    if (!response.url().includes("/api/agent/ask")) return;
    httpStatus = response.status();
    void response
      .json()
      .then((json: { result?: { data?: typeof body } }) => {
        body = json.result?.data ?? null;
      })
      .catch(() => undefined);
  };
  page.on("response", onResponse);
  const started = Date.now();
  await submit(page, prompt);
  const sawWorking = await expect(panelOf(page))
    .toHaveAttribute("data-ai-state", "working", { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (sawWorking) {
    await expect(page.getByText(AI_TEXTS.working).first()).toBeVisible();
    await a14Checkpoint(page, tc, "working");
  }
  const state = await terminal(page);
  const ms = Date.now() - started;
  page.off("response", onResponse);
  lastRealAskEndedAt = Date.now();
  const seen = body as { outcome?: string; steps?: unknown[]; matches?: unknown[] } | null;
  askLog.push({
    tc,
    prompt,
    state,
    ms,
    httpStatus,
    outcome: seen?.outcome ?? null,
    steps: seen?.steps?.length ?? null,
    matches: seen?.matches?.length ?? null,
  });
  test.info().annotations.push({ type: "real-ask", description: `${tc}: ${state} in ${ms} ms` });
  return state;
}

/** Asserts the honest terminal state: a known state, and for a non-answer its fixed UI text. */
async function expectHonest(page: Page, tc: string, state: AiState, step: string): Promise<void> {
  expect(TERMINAL, `unexpected state ${state}`).toContain(state);
  const text = STATE_TEXT[state];
  if (text !== undefined) {
    await expect(page.getByText(text).first()).toBeVisible();
    await expect(panelOf(page).locator('article[aria-label="Answer"]')).toHaveCount(0);
  }
  await a14Checkpoint(page, tc, step);
}

/** The answered-branch checks of a golden query: answer prose, "How I read this", provenance. */
async function expectAnsweredShape(page: Page, tc: string): Promise<void> {
  const panel = panelOf(page);
  await expect(panel.locator("[data-answer]")).toBeVisible();
  await expect(panel.getByRole("heading", { name: AI_TEXTS.howTitle })).toBeVisible();
  await expect(panel.getByRole("heading", { name: AI_TEXTS.missingTitle })).toBeVisible();
  await a14Checkpoint(page, tc, "answer-sections");
  const rows = panel.locator("[data-matches] > li");
  const count = await rows.count();
  for (let i = 0; i < Math.min(count, 5); i += 1) {
    // Each cited row carries a CID and a provenance line (source, captured, table, run).
    await expect(rows.nth(i)).toContainText(/baf[a-z2-7]{10,}|…/i);
    await expect(rows.nth(i)).toContainText(/captured|source|run/i);
  }
  if (count > 0) await a14Checkpoint(page, tc, "cited-rows");
}

/** Stubs `agent.ask` in this browser only: `respond` builds the tRPC body. */
async function stubAsk(
  page: Page,
  respond: (route: Route) => Promise<void>,
): Promise<{ calls: () => number }> {
  let calls = 0;
  await page.route("**/api/agent/ask", async (route) => {
    calls += 1;
    await respond(route);
  });
  return { calls: () => calls };
}

const agentBody = (outcome: string, answer = ""): string =>
  JSON.stringify({
    result: {
      data: { answer, how: "", steps: [], matches: [], query: {}, missing: [], outcome },
    },
  });

const fulfillJson = (route: Route, outcome: string, answer = ""): Promise<void> =>
  route.fulfill({ status: 200, contentType: "application/json", body: agentBody(outcome, answer) });

// ---------------------------------------------------------------------------------------
// D-10 then D-11: one browser session, G1 then G2, then the chip edit (TC-001, 002, 003, 009)
// ---------------------------------------------------------------------------------------

test.describe("A-14 session: G1, G2, chip edit", () => {
  test.describe.configure({ mode: "serial" });
  let context: BrowserContext;
  let page: Page;
  let g2State: AiState = "idle";

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    context = await browser.newContext({ colorScheme: "light" });
    page = await context.newPage();
  });
  test.afterAll(async () => {
    await context.close();
  });

  test(`${scenario14("001")} G1 roof age + radius (D-10, real ask)`, async () => {
    await openAiTab(page);
    await expect(page.locator("#ai-question")).toBeVisible();
    await expect(page.getByText(AI_TEXTS.counter(0, AI_TEXTS.sessionLimit))).toBeVisible();
    await a14Checkpoint(page, "001", "ai-tab-open");

    const state = await realAsk(page, "001", GOLDEN.G1);
    await expectHonest(page, "001", state, "terminal-state");
    if (state === "answered") {
      const answer = await panelOf(page).locator("[data-answer]").innerText();
      // The centre, the radius and the threshold are stated (D-3: roof >= 15 whole years).
      expect(answer.toLowerCase()).toContain("pflugerville");
      expect(answer).toMatch(/5\s*(mi|miles)|five miles/i);
      expect(answer).toMatch(/15/);
      await expect(panelOf(page).locator('[data-chip="radius_mi"] input')).toHaveValue("5");
      await expect(panelOf(page).locator('[data-chip="roof_age_years_min"] input')).toHaveValue(
        "15",
      );
      await expectAnsweredShape(page, "001");
      await expect(page.getByText(AI_TEXTS.counter(1, AI_TEXTS.sessionLimit))).toBeVisible();
    } else if (state === "no_results") {
      // An honest empty answer states what it could not tell (nothing invented).
      await expect(panelOf(page).getByText(AI_TEXTS.noResults)).toBeVisible();
      await a14Checkpoint(page, "001", "no-results");
    }
    test.info().annotations.push({ type: "state", description: state });
  });

  test(`${scenario14("002")} G2 follow-up "that area", open permits + contractor (D-11, real ask)`, async () => {
    // Same page, no reload: the client holds the last turns, so "that area" is carried over.
    const state = await realAsk(page, "002", GOLDEN.G2);
    g2State = state;
    await expectHonest(page, "002", state, "terminal-state");
    if (state === "answered" || state === "no_results") {
      const answer = await panelOf(page).locator("[data-answer]").innerText();
      // "that area" is not asked back, and the "many years" reading is stated (>= 5 years).
      expect(answer).not.toMatch(/which area|please specify|where do you mean/i);
      const how = await panelOf(page).getByRole("region", { name: AI_TEXTS.howTitle }).innerText();
      expect(`${answer} ${how}`).toMatch(/5/);
      await a14Checkpoint(page, "002", "that-area-reused");
      // Each cited permit shows the contractor as printed, a BBB status or the stated reason.
      const rows = panelOf(page).locator("[data-matches] > li");
      for (let i = 0; i < Math.min(await rows.count(), 5); i += 1) {
        await expect(rows.nth(i)).toContainText(/contractor|permit/i);
        await expect(rows.nth(i)).toContainText(/BBB|not available|unavailable|bbb_status/i);
      }
      await a14Checkpoint(page, "002", "contractor-and-bbb");
    }
    test.info().annotations.push({ type: "state", description: state });
  });

  test(`${scenario14("003")} no open roofing permits: stalled offered, honestly labelled`, async () => {
    // Reads the G2 answer already on screen (no extra model call). Branches on what the live
    // run returned; only the honest wording is asserted, never a count.
    test.skip(
      g2State !== "answered" && g2State !== "no_results",
      `depends on a G2 answer; the G2 ask ended as "${g2State}" (Run 2 is too heavy for the server)`,
    );
    const text = (await panelOf(page).innerText()).toLowerCase();
    if (/no open roofing permits/.test(text)) {
      expect(text).toMatch(/stalled/);
      await expect(
        panelOf(page)
          .getByText(/stalled/i)
          .first(),
      ).toBeVisible();
      await a14Checkpoint(page, "003", "no-open-stalled-offered");
    } else {
      // Open permits exist in the radius on this run: nothing to offer instead. The case then
      // verifies the missing-data list is explicit rather than silent.
      await expect(
        panelOf(page).getByRole("heading", { name: AI_TEXTS.missingTitle }),
      ).toBeVisible();
      await a14Checkpoint(page, "003", "open-permits-present-missing-listed");
      test.info().annotations.push({
        type: "branch",
        description: "open permits present in radius; the no-open sentence did not apply",
      });
    }
    // Missing data is named, not omitted: the section lists items or says nothing is missing.
    await expect(
      panelOf(page)
        .locator("[data-missing]")
        .or(panelOf(page).getByText(AI_TEXTS.noMissing))
        .first(),
    ).toBeVisible();
    await a14Checkpoint(page, "003", "missing-data-named");
  });

  test(`${scenario14("009")} edit "How I read this" chip 5 to 3 re-runs and updates citations (real ask)`, async () => {
    const chip = panelOf(page).locator('[data-chip="open_years_min"] input');
    test.skip(
      (await chip.count()) === 0,
      `depends on an answered G2 with an editable "open at least" chip; G2 ended as "${g2State}"`,
    );
    const before = await panelOf(page).locator("[data-matches] > li").count();
    await expect(chip).toHaveValue("5");
    await a14Checkpoint(page, "009", "chip-5");
    await chip.fill("3");
    // The re-ask is a real call: keep the gap and the budget like any other ask.
    const wait = lastRealAskEndedAt + ASK_GAP_MS - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    if (askLog.length >= MAX_REAL_ASKS) throw new Error("A-14 real-ask budget used up");
    const started = Date.now();
    await page.getByRole("button", { name: "Ask again" }).click();
    await expect(panelOf(page)).toHaveAttribute("data-ai-state", "working", { timeout: 5_000 });
    await a14Checkpoint(page, "009", "working-again");
    const state = await terminal(page);
    lastRealAskEndedAt = Date.now();
    askLog.push({
      tc: "009",
      prompt: "(G2 again with open_years_min=3)",
      state,
      ms: Date.now() - started,
      httpStatus: null,
      outcome: null,
      steps: null,
      matches: null,
    });
    await expectHonest(page, "009", state, "re-run-terminal-state");
    if (state === "answered" || state === "no_results") {
      await expect(panelOf(page).locator('[data-chip="open_years_min"] input')).toHaveValue("3");
      const after = await panelOf(page).locator("[data-matches] > li").count();
      // A wider threshold never returns fewer permits than the 5-year answer.
      expect(after).toBeGreaterThanOrEqual(before);
      await a14Checkpoint(page, "009", "chip-3-citations");
    }
  });
});

// ---------------------------------------------------------------------------------------
// Fresh-session real asks: TC-004 (G6), TC-006 (G4), TC-007 (G5); TC-005 and TC-008 opt-in
// ---------------------------------------------------------------------------------------

test(`${scenario14("004")} G6 out-of-scope ZIP 99999 (real ask)`, async ({ page }) => {
  await openAiTab(page);
  const state = await realAsk(page, "004", GOLDEN.G6);
  await expectHonest(page, "004", state, "terminal-state");
  if (state === "answered" || state === "no_results") {
    // Zero results and a plain statement that the ZIP is not in Travis County; no property rows.
    await expect(panelOf(page).locator("[data-matches] > li")).toHaveCount(0);
    const text = (await panelOf(page).innerText()).toLowerCase();
    expect(text).toMatch(/99999/);
    expect(text).toMatch(
      /not (a )?(valid )?(in )?travis|outside travis|out.of.scope|out of scope|invalid/,
    );
    await a14Checkpoint(page, "004", "zero-results-out-of-scope");
  }
});

test(`${scenario14("006")} G4 Lakeway tenure 10+, owners outside the area (real ask)`, async ({
  page,
}) => {
  await openAiTab(page);
  const state = await realAsk(page, "006", GOLDEN.G4);
  await expectHonest(page, "006", state, "terminal-state");
  if (state === "answered" || state === "no_results") {
    const text = (await panelOf(page).innerText()).toLowerCase();
    // The owner-outside-the-area part is a published-data gap (D-3): said plainly, never filtered.
    expect(text).toMatch(/owner|mailing/);
    expect(text).toMatch(
      /not published|not in (the )?export|can.?t tell|cannot tell|unknown|field not published/,
    );
    expect(text).toMatch(/travis/);
    await a14Checkpoint(page, "006", "owner-gap-stated");
  }
});

test(`${scenario14("007")} G5 BBB rating for permit 1982-012866 BP (real ask)`, async ({
  page,
}) => {
  await openAiTab(page);
  const state = await realAsk(page, "007", GOLDEN.G5);
  await expectHonest(page, "007", state, "terminal-state");
  if (state === "answered" || state === "no_results") {
    const text = await panelOf(page).innerText();
    expect(text).toContain("1982-012866 BP");
    // A cited BBB source, or the specific reason the rating is missing: never a guessed rating.
    expect(text).toMatch(/BBB|bbb/);
    await a14Checkpoint(page, "007", "permit-and-bbb");
  }
});

test.describe("A-14 opt-in asks (A14_EXTRA_ASKS=1, raises the budget to 8)", () => {
  test.skip(
    process.env.A14_EXTRA_ASKS !== "1",
    "a 7th and 8th real ask would exceed the shared Bedrock budget; set A14_EXTRA_ASKS=1 to run",
  );

  test(`${scenario14("005")} G3 open roofing permits older than 5 yrs near Manor (real ask)`, async ({
    page,
  }) => {
    await openAiTab(page);
    const state = await realAsk(page, "005", GOLDEN.G3);
    await expectHonest(page, "005", state, "terminal-state");
    if (state === "answered" || state === "no_results") {
      const text = (await panelOf(page).innerText()).toLowerCase();
      expect(text).toContain("manor");
      await a14Checkpoint(page, "005", "manor-centre-and-threshold");
    }
  });

  test(`${scenario14("008")} Round Rock partly outside Travis, centre stated (real ask)`, async ({
    page,
  }) => {
    await openAiTab(page);
    const state = await realAsk(page, "008", GOLDEN.ROUND_ROCK);
    await expectHonest(page, "008", state, "terminal-state");
    if (state === "answered" || state === "no_results") {
      const text = (await panelOf(page).innerText()).toLowerCase();
      expect(text).toContain("round rock");
      expect(text).toMatch(/travis/);
      await a14Checkpoint(page, "008", "centre-and-travis-only");
    }
  });
});

test(`${scenario14("011")} AI_PROVIDER=gateway same answers, no code change`, async () => {
  test.skip(
    true,
    "needs two deployments that differ only in AI_PROVIDER and a git diff of the two shas (test plan step 4); not a browser case, checked in docs/evidence/A-14-agent.md",
  );
});

// ---------------------------------------------------------------------------------------
// Stubbed states: only what cannot be provoked for real
// ---------------------------------------------------------------------------------------

test(`${scenario14("010")} [stubbed-response] session reaches 10 answered questions`, async ({
  page,
}) => {
  // [stubbed-response] agent.ask is answered by page.route() in this browser only, because 10
  // real answers would use the whole shared Bedrock budget. The session counter starts at 9 via
  // sessionStorage (the key the app itself writes). Verifies the client rule: only an `answered`
  // outcome counts, and at 10 the Ask control is blocked and nothing more is sent.
  await page.addInitScript(
    ([key]) => {
      try {
        if (window.sessionStorage.getItem(key as string) === null) {
          window.sessionStorage.setItem(key as string, "9");
        }
      } catch {
        // Blocked storage: the case then fails visibly on the counter assertion.
      }
    },
    [SESSION_KEY],
  );
  let outcome = "throttled";
  const stub = await stubAsk(page, (route) => fulfillJson(route, outcome, "stubbed answer"));
  await openAiTab(page);
  await expect(page.getByText(AI_TEXTS.counter(9, AI_TEXTS.sessionLimit))).toBeVisible();
  await a14Checkpoint(page, "010", "nine-used");

  await submit(page, "stubbed question one");
  await expect(panelOf(page)).toHaveAttribute("data-ai-state", "throttled", { timeout: 15_000 });
  await expect(page.getByText(AI_TEXTS.counter(9, AI_TEXTS.sessionLimit))).toBeVisible();
  await a14Checkpoint(page, "010", "throttled-not-counted");

  outcome = "answered";
  await submit(page, "stubbed question two");
  await expect(page.getByText(AI_TEXTS.counter(10, AI_TEXTS.sessionLimit))).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(AI_TEXTS.limitReached(AI_TEXTS.sessionLimit))).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeDisabled();
  await a14Checkpoint(page, "010", "limit-reached");

  const before = stub.calls();
  await page.locator("#ai-question").fill("an eleventh question");
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeDisabled();
  expect(stub.calls()).toBe(before);
  await a14Checkpoint(page, "010", "eleventh-blocked");
});

test(`${scenario14("013")} [stubbed-response] throttled, paused and timed-out outcomes, never a 5xx`, async ({
  page,
}) => {
  test.setTimeout(150_000);
  // [stubbed-response] The three conditions (Bedrock over 10 requests a minute, the $3 daily cap
  // tripped, a 23 s server timeout) cannot be provoked on the shared hosted agent without
  // spending or breaking the shared budget, so agent.ask is answered by page.route() in this
  // browser only, with HTTP 200 and the documented `outcome`. This verifies the UI contract
  // (fixed text, actions, no partial answer shown as final); the server side (never a 5xx) is
  // covered by the agent Lambda tests.
  let mode: "throttled" | "paused" | "timed_out" = "throttled";
  await stubAsk(page, async (route) => {
    if (mode === "timed_out") {
      // Never answers within the client's 25 s stop, like a request cut off at the HTTP API.
      await new Promise((resolveWait) => setTimeout(resolveWait, AI_TEXTS.clientStopMs + 2_000));
      await route.abort().catch(() => undefined);
      return;
    }
    await fulfillJson(route, mode);
  });
  await openAiTab(page);

  await submit(page, "stubbed question");
  await expect(panelOf(page)).toHaveAttribute("data-ai-state", "throttled", { timeout: 15_000 });
  await expect(page.getByText(AI_TEXTS.throttled)).toContainText(/try again/i);
  await expect(page.getByText(AI_TEXTS.counter(0, AI_TEXTS.sessionLimit))).toBeVisible();
  await a14Checkpoint(page, "013", "throttled");

  mode = "paused";
  await submit(page, "stubbed question again");
  await expect(panelOf(page)).toHaveAttribute("data-ai-state", "paused", { timeout: 15_000 });
  await expect(page.getByText(AI_TEXTS.paused)).toContainText(/resets at 00:00 UTC/);
  await a14Checkpoint(page, "013", "paused");

  mode = "timed_out";
  await submit(page, "a very slow stubbed question");
  await expect(panelOf(page)).toHaveAttribute("data-ai-state", "working", { timeout: 5_000 });
  await expect(panelOf(page)).toHaveAttribute("data-ai-state", "timed_out", { timeout: 40_000 });
  await expect(page.getByText(AI_TEXTS.timedOut)).toBeVisible();
  await expect(page.getByText(AI_TEXTS.timedOut)).toContainText(/try again/i);
  await expect(page.getByText(AI_TEXTS.timedOut)).toContainText(/use filters instead/i);
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(panelOf(page).locator('article[aria-label="Answer"]')).toHaveCount(0);
  await a14Checkpoint(page, "013", "timed-out");
});

// ---------------------------------------------------------------------------------------
// D-12: Help · MCP "Try a tool" through the server-side proxy (TC-027b)
// ---------------------------------------------------------------------------------------

test(`${scenario14("027b")} Help MCP try-a-tool works through the proxy, no token in the browser`, async ({
  page,
}) => {
  // Real call to the hosted proxy (no model involved). Pinned to the small run because the
  // latest run is too heavy for the server.
  const seen: { headers: Record<string, string>; body: string }[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/trpc/mcpProxy.callTool")) {
      seen.push({ headers: request.headers(), body: request.postData() ?? "" });
    }
  });
  await page.goto(`${RUNTIME}${ROUTES.helpMcp}`);
  await expect(page.locator('[data-route="help-mcp"]')).toBeVisible({ timeout: 60_000 });
  await a14Checkpoint(page, "027b", "help-mcp-open");
  await page.locator("#mcp-try-tool").selectOption("search_properties");
  await page.locator("#mcp-try-args").fill(
    JSON.stringify({
      area: { place: "Austin" },
      radius_mi: 5,
      limit: 5,
      manifest_cid: SMALL_RUN_MANIFEST_CID,
    }),
  );
  await page.getByRole("button", { name: "Try a tool" }).click();
  await expect(page.locator("[data-try-state]")).not.toHaveAttribute(
    "data-try-state",
    /^(idle|running)$/,
    {
      timeout: 60_000,
    },
  );
  await expect(page.locator("[data-try-result]")).toBeVisible();
  // A live result: provenance line, a count or an honest empty reason, never the static text.
  await expect(page.locator("[data-try-provenance]")).toBeVisible();
  await expect(page.locator("[data-try-json]")).not.toHaveText("");
  await a14Checkpoint(page, "027b", "live-result");

  expect(seen.length).toBeGreaterThan(0);
  const token = process.env.MCP_TOKEN ?? "";
  for (const request of seen) {
    expect(Object.keys(request.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
    expect(request.body).not.toMatch(/bearer/i);
    if (token !== "") expect(request.body).not.toContain(token);
  }
  const html = await page.content();
  if (token !== "") expect(html).not.toContain(token);
  await a14Checkpoint(page, "027b", "no-token-client-side");
});

// ---------------------------------------------------------------------------------------
// TC-NF-01: scale budget, read from the real asks above (runs last, makes no model call)
// ---------------------------------------------------------------------------------------

test(`${scenario14("NF-01")} agent scale budget from the real asks of this file`, async () => {
  test.skip(askLog.length === 0, "no real ask ran in this file (select the cases that ask)");
  // The browser sees the final state, the time and the response shape only; model calls and
  // output tokens are read from the agent's own trace (docs/evidence/A-14-agent.md).
  for (const ask of askLog) {
    expect(TERMINAL).toContain(ask.state);
    // Never later than the client stop plus render time, whatever the server did.
    expect(ask.ms).toBeLessThan(TERMINAL_WAIT_MS);
    expect(ask.httpStatus === null || ask.httpStatus < 500).toBe(true);
    if (ask.steps !== null) expect(ask.steps).toBeLessThanOrEqual(6);
    if (ask.matches !== null) expect(ask.matches).toBeLessThanOrEqual(1000);
  }
  // Classify by the server's own outcome when the response was seen; the displayed state is only
  // the fallback (it can briefly disagree with the response, which made this check flaky).
  const answered = askLog.filter((a) =>
    a.outcome !== null
      ? a.outcome === "answered"
      : a.state === "answered" || a.state === "no_results",
  );
  if (answered.length > 0) {
    expect(
      percentile(
        answered.map((a) => a.ms),
        95,
      ),
      `p95 over the answered asks: ${JSON.stringify(answered.map((a) => ({ tc: a.tc, state: a.state, ms: a.ms, outcome: a.outcome })))}`,
    ).toBeLessThan(20_000);
  } else {
    test.info().annotations.push({
      type: "branch",
      description: "no ask was answered on the latest (heavy) run; p95 of answers not measurable",
    });
  }
  const dir = resolve(repoRoot, "docs", "evidence");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "A-14-agent-timings.json"),
    `${JSON.stringify({ measuredAt: new Date().toISOString(), runtime: RUNTIME, asks: askLog }, null, 2)}\n`,
  );
});
