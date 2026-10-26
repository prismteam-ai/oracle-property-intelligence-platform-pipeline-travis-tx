// A-13 scan cases (T043; testplans/A-13-test-cases.md § 8): TC-073 (no-sample-data scan over every route),
// TC-074 (no "not wired" toast and no ProtoBar on any control) and TC-083 (WCAG 2.2 AA on every route).
// The route set is read from apps/web/src/routes/route-list.ts at run time (lib/a13-routes.ts), so a route
// added to the app is scanned without editing this file. The allowed CID set is every CID of every manifest
// reachable from runs/index.json (lib/a13.ts buildCidAllowlist); the denylist is
// fixtures/prototype-placeholders.json plus every CID-shaped token in design/prototype/**.
// The record CIDs shown on Explore (property and permit rows) are real published CIDs of the run's tables,
// not in any manifest; so the allowed set is also extended with every CID in the `explore.search` tRPC
// responses the page itself received during the same visit (lib/a13.ts mergeResponseCids). The denylist
// and the prototype-CID check are unchanged, so a prototype CID that no response carried still fails.
import type { Page } from "@playwright/test";
import { ROUTES } from "@countylens/shared";
import {
  buildCidAllowlist,
  cidTokens,
  denylistHits,
  disallowedCidTokens,
  fetchAllManifests,
  mergeResponseCids,
  loadPlaceholderDenylist,
  prototypeCidTokens,
  publishedTexts,
  withoutPublished,
} from "./lib/a13.js";
import { checkpoint, expect, parkedRoute, test } from "./lib/a13-fixtures.js";
import { writeEvidenceSection } from "./lib/a13-evidence.js";
import {
  AXE_VERSION,
  openMore,
  openSettled,
  routeSettled,
  runAxe,
  tabThrough,
} from "./lib/a13-pages.js";
import { routeTargets, type RouteTarget } from "./lib/a13-routes.js";
import { runBudgeted } from "./lib/step-budget.js";
import { SEL, exploreUrl, scenario } from "./lib/a13-ui.js";

const EXPLORE = ROUTES.explore;
/** TC-073: one route at one width gets this long, in total, to settle and open its tabs, sheets and drawer. */
const STEP_BUDGET_MS = 60_000;
/** Of which the page itself gets this long to leave `data-state="loading"`. */
const SETTLE_MS = 40_000;
/** Any single click or query inside a step; a missing control fails fast instead of waiting for the test timeout. */
const ACTION_MS = 5_000;
const WIDE = { at: "30.2672,-97.7431", r: 25, roof: 0, view: "list" } as const;

/** The routes of TC-086 plus the pages the scan must also open drawers and another county on. */
function scanTargets(manifestCid: string): RouteTarget[] {
  return [
    ...routeTargets(manifestCid),
    { key: "explore-wide", path: exploreUrl(EXPLORE, WIDE) },
    { key: "other-county", path: "/tx/harris/explore" },
  ];
}

/** Text, `data-cid`, `href`, `title`, `aria-label` and `data-value` of the whole page as one string. */
async function pageStrings(page: Page): Promise<string> {
  return page.evaluate(() => {
    const attrs = ["data-cid", "href", "title", "aria-label", "data-value"];
    const values = Array.from(document.querySelectorAll(attrs.map((a) => `[${a}]`).join(",")))
      .flatMap((el) => attrs.map((a) => el.getAttribute(a) ?? ""))
      .filter((v) => v !== "");
    return `${document.body.innerText}\n${values.join("\n")}`;
  });
}

/** Waits until Explore stops changing: ready, no progress bar, header text unchanged for 500 ms. */
async function exploreSettled(page: Page): Promise<void> {
  const section = page.locator('section[data-route="explore"]');
  if ((await section.count()) === 0) return;
  await expect(section).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(page.locator('[role="progressbar"]')).toHaveCount(0, { timeout: 30_000 });
  const header = page.locator(
    'section[data-route="explore"] h2, section[data-route="explore"] header',
  );
  let last = "";
  let since = Date.now();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const now = (
      await header
        .first()
        .innerText()
        .catch(() => "")
    ).trim();
    if (now !== last) {
      last = now;
      since = Date.now();
    } else if (Date.now() - since >= 500) return;
    await page.waitForTimeout(100);
  }
}

/** Opens every tab, the More sheet, the filter sheet (390) and the first property drawer. */
async function openEverything(
  page: Page,
  width: number,
  note: (text: string) => void,
): Promise<string[]> {
  note("read the page");
  const seen: string[] = [await pageStrings(page)];
  // The drawer comes first: clicking the AI tab unmounts the result rows (mode=ai), so a row
  // found afterwards can vanish between the count and the click.
  const row = page.locator(SEL.resultRow).first();
  if ((await row.count()) > 0) {
    note("open the first property drawer");
    await exploreSettled(page);
    await row.click({ timeout: 15_000 });
    if (await page.getByRole("dialog").first().isVisible()) seen.push(await pageStrings(page));
    await page.keyboard.press("Escape");
  }
  note("list the tabs");
  for (const tab of await page.getByRole("tab").all()) {
    const name = (await tab.innerText().catch(() => "")).trim();
    note(`click tab "${name}"`);
    if (await tab.isEnabled()) {
      await tab.click();
      seen.push(await pageStrings(page));
    }
  }
  if (width < 840) {
    note("open the filter sheet");
    await exploreSettled(page);
    const toggle = page.getByRole("button", { name: "Filters", exact: true });
    if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "false")
      await toggle.click({ timeout: 15_000 });
    seen.push(await pageStrings(page));
  }
  note("open the More sheet");
  await openMore(page);
  seen.push(await pageStrings(page));
  return seen;
}

test.describe("A-13 scan", { tag: "@a13-scan" }, () => {
  test(scenario("073"), async ({ browser, oracle }) => {
    test.setTimeout(30 * 60_000);
    // 1. The allowed CID set: every CID of every manifest of runs/index.json.
    const manifests = await fetchAllManifests(oracle.index);
    const published = publishedTexts(manifests);
    const allow = buildCidAllowlist(manifests);
    const denylist = loadPlaceholderDenylist();
    const prototypeCids = prototypeCidTokens();
    const rows: string[] = [];
    const failures: string[] = [];
    // 2. Open each route at 1440 and 390; open every drawer, sheet and tab. Each route at each width is
    //    its own step with its own budget, so a stuck one fails by name and the others still run.
    for (const target of scanTargets(oracle.manifestCid)) {
      for (const width of [1440, 390] as const) {
        const label = `${target.key} @ ${width}`;
        const context = await browser.newContext({
          viewport: { width, height: width === 1440 ? 900 : 844 },
          colorScheme: "light",
        });
        try {
          await test.step(label, async () => {
            const page = await context.newPage();
            const reads: Promise<string>[] = [];
            page.on("response", (response) => {
              if (response.url().includes("explore.search"))
                reads.push(response.text().catch(() => ""));
            });
            page.setDefaultTimeout(ACTION_MS);
            page.setDefaultNavigationTimeout(SETTLE_MS);
            const texts = await runBudgeted(label, STEP_BUDGET_MS, async (note) => {
              note(`open ${target.path} and wait for data-state loading to end`);
              await page.goto(target.path);
              await routeSettled(page, SETTLE_MS);
              return openEverything(page, width, note);
            });
            // 3. Scan text and attributes.
            const all = withoutPublished(texts.join("\n"), published);
            const phrases = denylistHits(all, denylist, { runCount: oracle.numbered.length });
            const protoCids = cidTokens(all).filter((t) => prototypeCids.includes(t));
            const foreign = disallowedCidTokens(
              all,
              mergeResponseCids(allow, await Promise.all(reads)),
            );
            let selectors = 0;
            for (const selector of denylist.selectors)
              selectors += await page.locator(selector).count();
            rows.push(
              `| ${label} | ${phrases.length} | ${protoCids.length} | ${foreign.length} | ${selectors} |`,
            );
            if (phrases.length + protoCids.length + foreign.length + selectors > 0) {
              failures.push(
                `${label}: phrases=${JSON.stringify(phrases)} prototype CIDs=${JSON.stringify(protoCids)} CIDs not in any manifest=${JSON.stringify(foreign)} selectors=${selectors}`,
              );
            }
            if (width === 1440) await checkpoint(page, "073", target.key);
          });
        } catch (error) {
          // A stuck or broken step is a failure of the case, named; the remaining routes still run.
          const message = error instanceof Error ? error.message : String(error);
          rows.push(`| ${label} | step failed | step failed | step failed | step failed |`);
          failures.push(`${label}: STEP FAILED: ${message}`);
        } finally {
          await context.close().catch(() => undefined);
        }
      }
    }
    const saved = writeEvidenceSection(
      "A-13-TC-073",
      [
        `## TC-073 no-sample-data scan (${oracle.runs.length} run(s), ${allow.size} allowed CIDs, ${prototypeCids.length} prototype CIDs denied)`,
        "",
        "| route @ width | denylist phrases | prototype CIDs | CIDs not in a manifest | ProtoBar selectors |",
        "| --- | --- | --- | --- | --- |",
        ...rows,
        "",
        failures.length === 0
          ? "Result: 0 hits."
          : `Result: FAIL\n\n${failures.map((f) => `- ${f}`).join("\n")}`,
      ].join("\n"),
    );
    test.info().annotations.push({ type: "evidence", description: saved });
    expect(failures, "no sample data on any route").toEqual([]);
  });

  test(scenario("074"), async ({ page, oracle }) => {
    test.setTimeout(45 * 60_000);
    const MAX_CLICKS = 40;
    const ENABLED = [
      'main button:not([disabled]):not([aria-disabled="true"])',
      'main a[href^="/"]:not([aria-disabled="true"])',
      'nav button:not([disabled]):not([aria-disabled="true"])',
      'nav a[href^="/"]',
    ].join(", ");
    const SKIP = /delete|remove|clear all|sign out|log out/i;
    const published = publishedTexts(await fetchAllManifests(oracle.index));
    const bad: string[] = [];
    page.on("dialog", (d) => void d.dismiss());
    // 1. Open each route.
    for (const target of routeTargets(oracle.manifestCid)) {
      await openSettled(page, target.path);
      const count = Math.min(await page.locator(ENABLED).count(), MAX_CLICKS);
      // 2. Click every enabled in-site button and link; 3. watch for toasts.
      for (let i = 0; i < count; i += 1) {
        const control = page.locator(ENABLED).nth(i);
        if (!(await control.isVisible())) continue;
        const name = (
          (await control.getAttribute("aria-label")) ??
          (await control.innerText()) ??
          ""
        ).trim();
        if (SKIP.test(name) || (await control.getAttribute("target")) === "_blank") continue;
        await control.click({ timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(250);
        const live = (
          await page
            .locator('[role="status"], [role="alert"], [aria-live], [data-toast]')
            .allInnerTexts()
        ).join("\n");
        const body = await page.locator("body").innerText();
        if (/not wired|prototype/i.test(withoutPublished(`${live}\n${body}`, published)))
          bad.push(`${target.path}: "${name}" → not wired / prototype text`);
        if ((await page.locator("[data-protobar]").count()) > 0 || /ProtoBar/i.test(body)) {
          bad.push(`${target.path}: "${name}" → ProtoBar`);
        }
        await page.keyboard.press("Escape");
        const here = `${new URL(page.url()).pathname}${new URL(page.url()).search}`;
        if (here !== target.path) await openSettled(page, target.path);
      }
      await checkpoint(page, "074", target.key);
    }
    expect(bad, "no toast, ProtoBar or prototype text after any click").toEqual([]);
  });

  test(scenario("083"), async ({ browser, oracle }) => {
    test.setTimeout(30 * 60_000);
    const lines: string[] = [];
    const problems: string[] = [];
    for (const target of routeTargets(oracle.manifestCid)) {
      if (parkedRoute(target.key)) {
        lines.push(`| ${target.key} | parked (A-16 item 18) | | | | |`);
        continue;
      }
      // 1. Open the route in a private window; run axe-core (wcag2a, wcag2aa, wcag21aa, wcag22aa).
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: "light",
      });
      try {
        const page = await context.newPage();
        await openSettled(page, target.path);
        const violations = await runAxe(page);
        const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        // 2. Tab through the page: a visible focus indicator, in document order.
        const stops = await tabThrough(page);
        const hidden = stops.filter((s) => !s.visible).map((s) => s.label);
        const outOfOrder = stops.some((s, i) => i > 0 && s.index < (stops[i - 1]?.index ?? 0));
        const positive = stops.some((s) => s.positiveTabindex);
        lines.push(
          `| ${target.key} | ${violations.length} | ${serious.length} | ${stops.length} | ${hidden.length} | ${outOfOrder || positive ? "no" : "yes"} |`,
        );
        if (serious.length > 0) {
          problems.push(
            `${target.path}: ${serious.map((v) => `${v.id} (${v.impact}, ${v.nodes}) ${v.targets.join(" | ")}`).join("; ")}`,
          );
        }
        if (stops.length === 0) problems.push(`${target.path}: nothing focusable`);
        if (hidden.length > 0)
          problems.push(`${target.path}: no visible focus on ${hidden.join(", ")}`);
        if (outOfOrder || positive)
          problems.push(`${target.path}: focus order is not document order`);
        await checkpoint(page, "083", target.key);
      } finally {
        await context.close();
      }
    }
    writeEvidenceSection(
      "A-13-TC-083",
      [
        `## TC-083 WCAG 2.2 AA (axe-core ${AXE_VERSION}, tags wcag2a wcag2aa wcag21aa wcag22aa)`,
        "",
        "| route | violations | serious or critical | tab stops | stops without focus ring | document order |",
        "| --- | --- | --- | --- | --- | --- |",
        ...lines,
      ].join("\n"),
    );
    expect(problems, "0 serious or critical violations; focus visible on every control").toEqual(
      [],
    );
  });
});
