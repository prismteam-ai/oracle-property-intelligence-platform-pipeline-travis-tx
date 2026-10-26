// A-14 responsive design checks (smeargle): the Explore · AI tab (`/explore?mode=ai`,
// apps/web/src/routes/ExploreAi.tsx) and Help · MCP "Try a tool", at 390, 768 and 1440 px, on the
// hosted preview only (RUNTIME_URL). Lane: hosted browser spec with page.route() canned responses
// built from the real contract (specs/014-agent-and-mcp/contracts/agent-ask.md,
// apps/web/src/data/agent-ask.ts, mcp-try.ts), so NO real model call and no MCP call is made
// (the Bedrock budget is reserved). Every test title carries `[stubbed-response]`.
// Assertions are visual and responsive only: no horizontal page scroll, 16 px side gutter at 390,
// tap targets >= 48 px (390), text not clipped, citations/links reachable, Atlas tokens only.
// Run: RUNTIME_URL=https://014-agent-and-mcp.d2lx0utip89u18.amplifyapp.com \
//      pnpm exec playwright test --project=a14-responsive --reporter=list
import type { Page, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AI_TEXTS, MCP_TRY_TEXTS, ROUTES } from "@countylens/shared";
import { AUDITED_PROPERTIES, atlasTokenAudit, smallTapTargets } from "./lib/atlas-tokens.js";
import { SMALL_RUN_MANIFEST_CID } from "./lib/a14.js";
import { repoRoot, runtimeUrl } from "./lib/runtime.js";

const RUNTIME = runtimeUrl();
const IMG_DIR = resolve(repoRoot, "docs", "evidence", "img");
const RESULTS_FILE = resolve(repoRoot, "tests", "e2e", "test-results", "a14-responsive.json");
const MIN_TAP_TARGET_PX = 48;
const GUTTER_PX = 16;
const SESSION_KEY = "countylens.ai.questions";

// sourcesBeside: board ExploreQ-ai puts the numbered matches in a column right of the answer from
// 1240 px; below that they follow the answer.
const WIDTHS = [
  { name: "mobile", width: 390, height: 844, sourcesBeside: false },
  { name: "tablet", width: 768, height: 1024, sourcesBeside: false },
  { name: "desktop", width: 1440, height: 900, sourcesBeside: true },
] as const;

// ---- canned responses (shape of AgentAskResponse; placeholders, never presented as real data) ----
const CID = SMALL_RUN_MANIFEST_CID; // a real CIDv1 string reused as a format-valid stand-in
const match = (n: number, extra: Record<string, unknown> = {}) => ({
  n,
  property_cid: CID,
  source_url: n === 2 ? null : "https://example.org/stubbed-source-row",
  captured_at: "2026-10-20T10:00:00Z",
  table: "v_property",
  table_cid: CID,
  run_id: "stub-run",
  manifest_cid: CID,
  as_of: "2026-10-20",
  roof_age_years: 12 + n * 7,
  roof_age_basis: "permit_year",
  roof_age_confidence: "high",
  missing: n === 2 ? [{ field: "source_url", reason: "not_in_export" }] : [],
  ...extra,
});
const base = {
  how: "Centre: Pflugerville (place lookup), radius 5 mi, roof age at least 15 years.",
  steps: [{ tool: "search_properties", input: {}, summary: "stubbed step" }],
  query: { radius_mi: 5, roof_age_years_min: 15, tenure_years_min: 3, permit: "any" },
};
const RESPONSES: Record<string, unknown> = {
  answered: {
    ...base,
    answer:
      "Three stubbed properties have roofs older than 15 years near Pflugerville [1]. The second has no source link [2]. A third is the oldest [3].",
    matches: [
      match(1),
      match(2),
      match(3, { permit_number: "STUB-0001 BP", status_class: "open_or_stalled", open_days: 1200 }),
    ],
    missing: [{ field: "owner_is_out_of_area", reason: "not_in_export" }],
    outcome: "answered",
  },
  no_results: {
    ...base,
    answer: "No properties matched this stubbed question.",
    matches: [],
    query: { ...base.query, empty_reason: "no_rows_match" },
    missing: [{ field: "result", reason: "no_rows_match" }],
    outcome: "answered",
  },
  throttled: { ...base, answer: "", matches: [], missing: [], outcome: "throttled" },
  paused: {
    ...base,
    answer: "",
    matches: [],
    missing: [],
    outcome: "paused",
    resetsAt: "2026-10-26T00:00:00Z",
  },
  timed_out: { ...base, answer: "", matches: [], missing: [], outcome: "timed_out" },
};
const envelope = (data: unknown) => ({ result: { data } });

// ---- result collection (docs/evidence/A-14-smeargle.md is built from this file) ----
const results: Record<string, { pass: boolean; problems: string[] }> = {};
function record(key: string, problems: string[]): void {
  results[key] = { pass: problems.length === 0, problems };
  mkdirSync(resolve(RESULTS_FILE, ".."), { recursive: true });
  writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

// ---- generic design checks, run in the page ----
interface Metrics {
  hScroll: boolean;
  scrollWidth: number;
  innerWidth: number;
  box: { left: number; right: number } | null;
  clipped: string[];
  outside: string[];
}
function measure(rootSelector: string): Metrics {
  const root = document.querySelector(rootSelector);
  const rect = root?.getBoundingClientRect();
  const clipped: string[] = [];
  const outside: string[] = [];
  const scrollerOf = (el: Element): boolean => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
    return false;
  };
  for (const el of Array.from(root?.querySelectorAll("*") ?? [])) {
    if (el.getClientRects().length === 0) continue;
    const style = getComputedStyle(el);
    const name = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" ? `.${el.className.split(" ")[0]}` : ""}`;
    if (
      (style.overflowX === "hidden" || style.overflowX === "clip") &&
      el.scrollWidth > el.clientWidth + 1
    ) {
      clipped.push(`${name} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
    }
    if (
      (style.overflowY === "hidden" || style.overflowY === "clip") &&
      el.scrollHeight > el.clientHeight + 1 &&
      (el.textContent ?? "").trim() !== ""
    ) {
      clipped.push(`${name} scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}`);
    }
    const r = el.getBoundingClientRect();
    if (!scrollerOf(el) && r.right > window.innerWidth + 1) {
      outside.push(`${name} right ${Math.round(r.right)} > ${window.innerWidth}`);
    }
  }
  return {
    hScroll: document.documentElement.scrollWidth > window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    box: rect ? { left: rect.left, right: rect.right } : null,
    clipped,
    outside,
  };
}

async function designChecks(page: Page, root: string, width: number): Promise<string[]> {
  const problems: string[] = [];
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(measure, root);
  if (m.hScroll)
    problems.push(`horizontal page scroll: scrollWidth ${m.scrollWidth} > ${m.innerWidth}`);
  if (m.box === null) problems.push(`root ${root} not found`);
  else if (width === 390) {
    if (m.box.left < GUTTER_PX - 0.5)
      problems.push(`left gutter ${Math.round(m.box.left)}px < ${GUTTER_PX}px`);
    if (m.innerWidth - m.box.right < GUTTER_PX - 0.5)
      problems.push(`right gutter ${Math.round(m.innerWidth - m.box.right)}px < ${GUTTER_PX}px`);
  }
  problems.push(...m.clipped.map((c) => `clipped text: ${c}`));
  problems.push(...m.outside.map((c) => `element beyond viewport: ${c}`));
  if (width === 390) {
    const small = await page.evaluate(
      ({ min, rootSel }) => {
        const rootEl = document.querySelector(rootSel);
        const out: string[] = [];
        if (!rootEl) return out;
        const targets = rootEl.querySelectorAll(
          'a[href], button, [role="button"], [role="tab"], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        for (const el of Array.from(targets)) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (el.tagName === "A" && getComputedStyle(el).display === "inline") continue;
          if (r.width < min || r.height < min) {
            const label =
              el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 30);
            out.push(
              `${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`,
            );
          }
        }
        return out;
      },
      { min: MIN_TAP_TARGET_PX, rootSel: root },
    );
    problems.push(...small.map((s) => `tap target < ${MIN_TAP_TARGET_PX}px: ${s}`));
    // The shared helper (whole page) is also run; its findings outside the page root are reported
    // separately by the evidence file, not counted here.
    void smallTapTargets;
  }
  const audit = await page.evaluate(atlasTokenAudit, [...AUDITED_PROPERTIES]);
  if (audit.tokens === 0) problems.push("no Atlas tokens found");
  for (const v of audit.violations.slice(0, 10))
    problems.push(`non-token ${v.property}=${v.value} on ${v.selector}`);
  if (audit.violations.length > 10)
    problems.push(`... ${audit.violations.length - 10} more non-token values`);
  return problems;
}

async function shot(
  page: Page,
  state: string,
  bp: { name: string; width: number },
  scope: "A-14-responsive" | "A-14-responsive-mcp" = "A-14-responsive",
) {
  mkdirSync(IMG_DIR, { recursive: true });
  const file =
    scope === "A-14-responsive"
      ? `A-14-responsive-${state}-${bp.width}.png`
      : `A-14-responsive-mcp-${state}-${bp.width}.png`;
  await page.screenshot({ path: resolve(IMG_DIR, file), fullPage: true });
}

const panelOf = (page: Page) => page.locator('[data-panel="ai"]');

async function openAi(page: Page): Promise<void> {
  await page.goto(`${RUNTIME}${ROUTES.explore}?mode=ai`);
  await expect(panelOf(page)).toBeVisible({ timeout: 60_000 });
  await expect(panelOf(page)).toHaveAttribute("data-ai-state", "idle");
}
async function ask(page: Page): Promise<void> {
  await page.locator("#ai-question").fill("Which properties near Pflugerville have old roofs?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
}

const AI_STATES = [
  "working",
  "answered",
  "no_results",
  "throttled",
  "paused",
  "timed_out",
  "limit",
] as const;

for (const bp of WIDTHS) {
  test.describe(`A-14 responsive ${bp.width}`, () => {
    test.use({ viewport: { width: bp.width, height: bp.height } });

    for (const state of AI_STATES) {
      test(`[stubbed-response] Explore AI ${state} at ${bp.width}`, async ({ page }) => {
        const key = `ai:${state}:${bp.width}`;
        let release: (() => void) | undefined;
        let askCalls = 0;
        await page.route("**/api/agent/ask", async (route: Route) => {
          askCalls += 1;
          if (state === "working") {
            await new Promise<void>((r) => (release = r));
            await route.abort().catch(() => undefined);
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(envelope(RESPONSES[state])),
          });
        });
        if (state === "limit") {
          await page.addInitScript(
            ([k, v]) => window.sessionStorage.setItem(k as string, v as string),
            [SESSION_KEY, String(AI_TEXTS.sessionLimit)],
          );
        }
        const problems: string[] = [];
        try {
          await openAi(page);
          if (state === "limit") {
            await expect(
              page.getByText(AI_TEXTS.limitReached(AI_TEXTS.sessionLimit)),
            ).toBeVisible();
            await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeDisabled();
          } else {
            await ask(page);
            if (state === "working") {
              await expect(panelOf(page)).toHaveAttribute("data-ai-state", "working");
              await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
              await expect(page.getByText(/^Working… \d+ s$/)).toBeVisible();
            } else {
              const want = state === "answered" || state === "no_results" ? state : state;
              await expect(panelOf(page)).toHaveAttribute("data-ai-state", want);
            }
          }
          if (state === "throttled") await expect(page.getByText(AI_TEXTS.throttled)).toBeVisible();
          if (state === "paused")
            await expect(page.getByText(/AI answers are paused for today/)).toBeVisible();
          if (state === "timed_out") await expect(page.getByText(/Took too long/)).toBeVisible();
          if (state === "no_results")
            await expect(page.getByText(AI_TEXTS.noResults)).toBeVisible();
          problems.push(...(await designChecks(page, '[data-panel="ai"]', bp.width)));

          if (state === "answered") {
            // Citations and links reachable: a [n] jumps to its row, which ends up inside the viewport.
            for (const n of [1, 3]) {
              await panelOf(page).locator(`[data-cite="${n}"]`).first().click();
              const row = page.locator(`#ai-match-${n}`);
              const inView = await row.evaluate((el) => {
                const r = el.getBoundingClientRect();
                return (
                  r.top >= 0 &&
                  r.bottom <= window.innerHeight + 1 &&
                  r.left >= 0 &&
                  r.right <= window.innerWidth + 1
                );
              });
              if (!inView)
                problems.push(`citation [${n}] row not fully inside the viewport after jump`);
            }
            const link = panelOf(page).locator("#ai-match-1 a[href^='http']").first();
            if ((await link.count()) === 0) problems.push("row 1 has no reachable source link");
            else {
              await link.scrollIntoViewIfNeeded();
              const b = await link.boundingBox();
              if (!b || b.x < 0 || b.x + b.width > bp.width + 1)
                problems.push("source link outside the viewport");
            }
            // Layout: the matches beside the answer (wide) or under it, and one-line number badges.
            const answerBox = await panelOf(page).locator("[data-answer]").boundingBox();
            const sourcesBox = await panelOf(page)
              .getByRole("region", { name: AI_TEXTS.sourcesTitle })
              .boundingBox();
            if (!answerBox || !sourcesBox) problems.push("answer or sources not laid out");
            else if (bp.sourcesBeside && sourcesBox.x < answerBox.x + answerBox.width)
              problems.push(`sources start at ${Math.round(sourcesBox.x)}, inside the answer`);
            else if (!bp.sourcesBeside && sourcesBox.y < answerBox.y + answerBox.height)
              problems.push(`sources at y ${Math.round(sourcesBox.y)} are not under the answer`);
            const badgeLines = await panelOf(page)
              .locator("[data-match] > span:first-child")
              .evaluateAll((els) =>
                els.map((el) => {
                  const range = document.createRange();
                  range.selectNodeContents(el);
                  return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
                }),
              );
            for (const lines of badgeLines)
              if (lines > 1) problems.push(`match number wraps onto ${lines} lines`);
            const chip = panelOf(page).locator('[data-chip="radius_mi"] input');
            const cb = await chip.boundingBox();
            if (!cb || cb.height < MIN_TAP_TARGET_PX - 0.5)
              problems.push(`chip input height ${cb ? Math.round(cb.height) : "?"}px`);
          }
          if (state !== "limit" && state !== "working" && askCalls !== 1)
            problems.push(`expected 1 stubbed call, saw ${askCalls}`);
          await shot(page, state, bp);
        } finally {
          release?.();
          record(key, problems);
        }
        expect(problems, key).toEqual([]);
      });
    }

    const MCP_STATES = ["idle", "running", "result", "error"] as const;
    for (const state of MCP_STATES) {
      test(`[stubbed-response] Help MCP try-a-tool ${state} at ${bp.width}`, async ({ page }) => {
        const key = `mcp:${state}:${bp.width}`;
        let release: (() => void) | undefined;
        await page.route("**/api/trpc/mcpProxy.callTool*", async (route: Route) => {
          if (state === "running") {
            await new Promise<void>((r) => (release = r));
            await route.abort().catch(() => undefined);
            return;
          }
          if (state === "error") {
            await route.fulfill({
              status: 400,
              contentType: "application/json",
              body: JSON.stringify({
                error: {
                  message: "The arguments are not valid for get_property: property_cid is required",
                  data: { httpStatus: 400 },
                },
              }),
            });
            return;
          }
          const rows = Array.from({ length: 7 }, (_, i) => ({
            property_cid: CID,
            roof_age_years: 15 + i,
            provenance: {
              source_url: "https://example.org/stubbed-source-row",
              table_cid: CID,
              run_id: "stub-run",
            },
          }));
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(
              envelope({
                tool: "search_properties",
                maxRows: 1000,
                result: {
                  run: { run_id: "stub-run", as_of: "2026-10-20", manifest_cid: CID },
                  rows,
                  returned: 7,
                  total: 40,
                  truncated: true,
                },
              }),
            ),
          });
        });
        const problems: string[] = [];
        try {
          await page.goto(`${RUNTIME}${ROUTES.helpMcp}`);
          const section = page.locator('[data-route="help-mcp"]');
          await expect(section).toBeVisible({ timeout: 60_000 });
          const trigger = page.getByRole("button", { name: "Try a tool" });
          if (state === "error") {
            await page.locator("#mcp-try-tool").selectOption("get_property");
          }
          if (state !== "idle") await trigger.click();
          await expect(page.locator("[data-try-state]")).toHaveAttribute(
            "data-try-state",
            state === "result"
              ? "done"
              : state === "running"
                ? "running"
                : state === "error"
                  ? "error"
                  : "idle",
          );
          if (state === "running")
            await expect(page.getByText(MCP_TRY_TEXTS.running)).toBeVisible();
          if (state === "result") {
            await expect(page.locator("[data-try-result]")).toBeVisible();
            await expect(page.locator("[data-try-count]")).toBeVisible();
          }
          if (state === "error") await expect(page.locator("[data-try-error]")).toBeVisible();
          await trigger.scrollIntoViewIfNeeded();
          // The pointer stays over the button it just clicked; Atlas draws its hover state layer there.
          // Audit the resting state, not the hover state.
          await page.mouse.move(0, 0);
          problems.push(...(await designChecks(page, '[data-route="help-mcp"]', bp.width)));
          if (state === "result") {
            // The JSON block may scroll inside itself (reachable), but must not widen the page.
            const pre = page.locator("[data-try-json]");
            const pb = await pre.boundingBox();
            if (!pb || pb.x < 0 || pb.x + pb.width > bp.width + 1)
              problems.push("result JSON block outside the viewport");
            const prov = page.locator("[data-try-provenance]");
            if (!(await prov.isVisible())) problems.push("run provenance line not visible");
          }
          await shot(page, state, bp, "A-14-responsive-mcp");
        } finally {
          release?.();
          record(key, problems);
        }
        expect(problems, key).toEqual([]);
      });
    }
  });
}
