// A-03-TC-NF-03: Runs and Permits at 390 / 768 / 1440 with Atlas tokens only (T068; AC-2,
// AC-3, NFR-003; smeargle `responsive-design-tests`, real-URL browser lane: the hosted pages,
// no mocks). Light theme only (dark is A-13). Expectations live in the breakpoint table below;
// the body is generic. Per width and page:
//   - no horizontal page scroll (`scrollWidth ≤ innerWidth`);
//   - at 390, every tap target ≥ 48 px (lib/atlas-tokens.ts `smallTapTargets`);
//   - computed colour, font family, font size, spacing and border radius only from Atlas tokens
//     (lib/atlas-tokens.ts `atlasTokenAudit`, the plan's token-check method), violations listed;
//   - one full-page checkpoint screenshot per page and width
//     (docs/evidence/img/A-03-TC-NF-03-{page}-{width}.png, also attached);
//   - Permits: cards below 600 px, the data table from 600 px; at 390 the first provenance line
//     (the first `[data-cid]`) is inside the first viewport; the list is paged (200 rows a time),
//     so the audit covers one page and the pager (`Showing 1–200 of N`, Previous, Next) shows.
import type { Page } from "@playwright/test";
import { AUDITED_PROPERTIES, atlasTokenAudit, smallTapTargets } from "./lib/atlas-tokens.js";
import { PERMITS_TEXTS } from "@countylens/shared";
import { checkpoint } from "./lib/evidence.js";
import { expect, test } from "./lib/fixtures.js";
import { PERMITS_LOAD_WAIT_MS, SELECTORS } from "./lib/perf.js";
import {
  PAGE_SIZE,
  nextButton,
  pagerNav,
  permitsTotal,
  previousButton,
} from "./lib/permits-pages.js";
import { runtimeUrl } from "./lib/runtime.js";

const MIN_TAP_TARGET_PX = 48;

const breakpoints = [
  {
    name: "phone",
    viewport: { width: 390, height: 844 },
    permitsLayout: "cards",
    checkTapTargets: true,
    provenanceAboveFold: true,
  },
  {
    name: "tablet",
    viewport: { width: 768, height: 1024 },
    permitsLayout: "table",
    checkTapTargets: false,
    provenanceAboveFold: false,
  },
  {
    name: "desktop",
    viewport: { width: 1440, height: 900 },
    permitsLayout: "table",
    checkTapTargets: false,
    provenanceAboveFold: false,
  },
] as const;

const pages = [
  { name: "runs", path: "/runs", ready: `${SELECTORS.runsPage} ${SELECTORS.cid}` },
  { name: "permits", path: "/permits", ready: SELECTORS.permitsReady },
] as const;

/** How long a page may take to become ready: the full-county Permits list loads ~95 MB first. */
const READY_TIMEOUT_MS = { runs: 60_000, permits: PERMITS_LOAD_WAIT_MS } as const;

async function open(page: Page, path: string, ready: string, timeout: number): Promise<void> {
  await page.goto(`${runtimeUrl()}${path}`, { waitUntil: "domcontentloaded" });
  // visible only: the Runs page Run menu holds hidden copies of every CID first
  await page
    .locator(ready)
    .filter({ visible: true })
    .first()
    .waitFor({ state: "visible", timeout });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

test.describe("A-03-TC-NF-03 responsive 390 / 768 / 1440, Atlas tokens only", () => {
  test.describe.configure({ timeout: 10 * 60_000 });

  test("@scenario:A-03-TC-NF-03", async ({ browser, run }, testInfo) => {
    const report: Record<string, unknown> = {
      runtimeUrl: runtimeUrl(),
      manifestCid: run.manifestCid,
    };

    for (const bp of breakpoints) {
      for (const target of pages) {
        const label = `${target.name} @ ${bp.viewport.width}`;
        await test.step(label, async () => {
          const context = await browser.newContext({ viewport: bp.viewport, colorScheme: "light" });
          try {
            const page = await context.newPage();
            await open(page, target.path, target.ready, READY_TIMEOUT_MS[target.name]);

            const overflow = await page.evaluate(() => ({
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: window.innerWidth,
            }));
            expect
              .soft(overflow.scrollWidth, `${label}: no horizontal scroll`)
              .toBeLessThanOrEqual(overflow.innerWidth);

            const smallTargets = bp.checkTapTargets
              ? await page.evaluate(smallTapTargets, MIN_TAP_TARGET_PX)
              : [];
            expect
              .soft(smallTargets, `${label}: tap targets ≥ ${MIN_TAP_TARGET_PX} px`)
              .toEqual([]);

            const audit = await page.evaluate(atlasTokenAudit, [...AUDITED_PROPERTIES]);
            expect
              .soft(audit.tokens, `${label}: tokens.css custom properties found`)
              .toBeGreaterThan(0);
            expect.soft(audit.checkedElements, `${label}: elements audited`).toBeGreaterThan(0);
            expect
              .soft(audit.violations, `${label}: computed values outside the Atlas tokens`)
              .toEqual([]);

            if (target.name === "runs") {
              await expect
                .soft(
                  page
                    .locator(`article [data-cid="${run.manifestCid}"]`)
                    .filter({ visible: true })
                    .first(),
                  `${label}: run card shows the manifest CID`,
                )
                .toBeVisible();
            } else {
              const table = page.locator(SELECTORS.permitsTable);
              const cards = page.locator(SELECTORS.permitsCards);
              if (bp.permitsLayout === "cards") {
                await expect.soft(cards, `${label}: cards below 600 px`).toBeVisible();
                await expect.soft(table, `${label}: no data table below 600 px`).toHaveCount(0);
              } else {
                await expect.soft(table, `${label}: data table from 600 px`).toBeVisible();
                await expect.soft(cards, `${label}: no cards from 600 px`).toHaveCount(0);
              }
              // The pager: range line, Previous (disabled on page 1) and Next, all on screen.
              const range = page.locator(SELECTORS.permitsRange);
              await expect.soft(pagerNav(page), `${label}: pager shown`).toBeVisible();
              await expect.soft(range, `${label}: range line shown`).toBeVisible();
              const total = await permitsTotal(page);
              await expect
                .soft(range, `${label}: page 1 range text`)
                .toHaveText(PERMITS_TEXTS.showing(1, Math.min(PAGE_SIZE, total), total));
              await expect
                .soft(previousButton(page), `${label}: Previous on page 1`)
                .toBeDisabled();
              await expect.soft(nextButton(page), `${label}: Next on page 1`).toBeEnabled();
            }

            let provenanceBottom: number | null = null;
            if (bp.provenanceAboveFold) {
              const box = await page.locator(SELECTORS.cid).first().boundingBox();
              provenanceBottom = box ? box.y + box.height : null;
              expect
                .soft(provenanceBottom, `${label}: first provenance line rendered`)
                .not.toBeNull();
              expect
                .soft(
                  provenanceBottom ?? Number.POSITIVE_INFINITY,
                  `${label}: first provenance line inside the first viewport`,
                )
                .toBeLessThanOrEqual(bp.viewport.height);
            }

            // A page of 200 cards at 390 px is tens of thousands of pixels tall, past what a
            // single full-page screenshot can hold; the Permits evidence is the viewport.
            await checkpoint(page, "NF-03", `${target.name}-${bp.viewport.width}`, {
              fullPage: target.name === "runs",
            });
            report[label] = { overflow, smallTargets, audit, provenanceBottom };
          } finally {
            await context.close();
          }
        });
      }
    }

    await testInfo.attach("tc-nf-03-report.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
    expect(Object.keys(report).length, "six page × width checks ran").toBe(
      2 + breakpoints.length * pages.length,
    );
  });
});
