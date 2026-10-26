// Page-level helpers of the A-13 Part 2 specs (T043: A-13-pages, A-13-scan, A-13-vitals).
//
// DOM contract G3 must provide (the specs read only these hooks beyond role and label queries;
// every hook is listed in the G4 report):
// - Every page: one `main section[data-route="{name}"]`; `data-state` may be `loading` | `ready` | `error`
//   (absent = ready); a level-2 heading inside it; no console error.
// - Hub (as G3 built it): `article`s headed "CountyLens" and "Roofing CRM"; the chip is the text
//   PAGE_TEXTS.hubChip; the CRM control is the card's first button or link (disabled, no href, until
//   `crmUrl` is a valid https URL); "Watch demo" and "PR" links only when configured.
// - Catalog: `[data-catalog-row="{artifact name}"]` per published table holding `a[data-cid]` (href
//   `/data/verify/{cid}`), `[data-size]` (`data-value` bytes), `[data-rows]` (`data-value`), one
//   `[data-column]` per column (`data-name`, `data-type`), and `[data-published-rows]`
//   (`data-coverage-key`, `data-value`) where a coverage key maps. `[data-export-notice]` shows
//   PAGE_TEXTS.tableExportMissing; an unreachable list renders `role="alert"` text and a link to /data/manifest.
// - Legal · Data (as G3 built it): `ul[aria-label="Data sources"] > li[data-source]` with an https terms link;
//   `ul[aria-label="Access rules"]` with one item per rule.
// - Runs · Log (as G3 built it): `li[data-event="started|captured|finished"]` with `data-time` (ISO) and
//   `data-run-id`; a finish event lists its limitations as text.
// - Coming soon: the in-context control that opens an item carries `[data-coming-soon-entry="{id}"]`;
//   the item (in context or at `/soon/{id}`) renders `[data-coming-soon-item="{id}"]` holding the label
//   PAGE_TEXTS.comingSoon, `[data-coming-soon-sentence]` and `[data-skeleton]` (`aria-hidden="true"`).
// - County: the picker control is `[data-county-picker]` (a `select` or a button opening `role="option"`s);
//   the Travis-only message is `[data-county-message]`.
// - Each page may mark its main interactive control `[data-main-control]` (INP, TC-081).
import type { Locator, Page } from "@playwright/test";
import { expect } from "./a13-fixtures.js";

// ---------------------------------------------------------------------------------------
// Settling, console and headings
// ---------------------------------------------------------------------------------------

export interface ConsoleWatch {
  readonly errors: string[];
}

/** Collects `console.error` and uncaught page errors (a favicon miss is not an app error). */
export function watchConsole(page: Page): ConsoleWatch {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon/i.test(`${msg.text()} ${msg.location().url}`)) {
      errors.push(`${msg.text()} (${msg.location().url})`);
    }
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return { errors };
}

/** The page's own section has left `loading` (a page without `data-state` counts as settled). */
export async function routeSettled(page: Page, timeout = 60_000): Promise<Locator> {
  const section = page.locator("main section[data-route]").first();
  await expect(section).toBeVisible({ timeout });
  await expect
    .poll(async () => await section.getAttribute("data-state"), { timeout })
    .not.toBe("loading");
  return section;
}

/** Opens `path` and waits until the page has settled; network idle is best effort. */
export async function openSettled(page: Page, path: string): Promise<Locator> {
  await page.goto(path);
  const section = await routeSettled(page);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  return section;
}

/** The page heading: the first level-2 heading in the main region. */
export function pageHeading(page: Page): Locator {
  return page.locator("main").getByRole("heading", { level: 2 }).first();
}

/** The sheet's name: "More" below 600 px, "Coming soon" from 600 px (PO 2026-10-26). */
const SHEET_NAME = /^(More|Coming soon)$/;

/** Opens the More / Coming soon sheet at any width and returns the dialog. */
export async function openMore(page: Page): Promise<Locator> {
  const more = page.getByRole("button", { name: SHEET_NAME });
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
  const sheet = page.getByRole("dialog", { name: SHEET_NAME });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Same-origin in-site hrefs (path + query) of every link on the current page, including the shell. */
export async function inSiteHrefs(page: Page): Promise<string[]> {
  const origin = new URL(page.url()).origin;
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href),
  );
  return [
    ...new Set(
      hrefs
        .map((h) => new URL(h))
        .filter((u) => u.origin === origin)
        .map((u) => `${u.pathname}${u.search}`),
    ),
  ];
}

// ---------------------------------------------------------------------------------------
// Coming soon skeleton (TC-060 … TC-070)
// ---------------------------------------------------------------------------------------

export interface SkeletonFacts {
  readonly ariaHidden: string | null;
  readonly textNodes: number;
  readonly animations: number;
  readonly animated: string[];
  readonly busy: number;
  readonly progress: number;
  readonly digits: boolean;
  readonly cidShaped: boolean;
  readonly dataStructures: number;
}

/** Reads the skeleton inside `item` in the page (steps 4 and 5 of TC-060 … TC-070). */
export async function skeletonFacts(item: Locator): Promise<SkeletonFacts> {
  return item
    .locator("[data-skeleton]")
    .first()
    .evaluate((el): SkeletonFacts => {
      const blocks = [el, ...Array.from(el.querySelectorAll("*"))];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let textNodes = 0;
      let text = "";
      while (walker.nextNode()) {
        const value = walker.currentNode.nodeValue ?? "";
        if (value.trim() !== "") textNodes += 1;
        text += value;
      }
      return {
        ariaHidden: el.getAttribute("aria-hidden"),
        textNodes,
        animations: el.getAnimations({ subtree: true }).length,
        animated: blocks
          .filter((b) => getComputedStyle(b).animationName !== "none")
          .map((b) => b.tagName.toLowerCase()),
        busy: blocks.filter((b) => b.getAttribute("aria-busy") === "true").length,
        progress: blocks.filter((b) => b.getAttribute("role") === "progressbar").length,
        digits: /\d/.test(`${text}${el.getAttributeNames().join("")}`),
        cidShaped: /\b(baf|bag)[a-z2-7]{20,}/.test(el.outerHTML),
        dataStructures: el.querySelectorAll(
          "table, [role='row'], ul, ol, li, [role='list'], [role='listitem']",
        ).length,
      };
    });
}

// ---------------------------------------------------------------------------------------
// axe-core (WCAG 2.2 AA, TC-083)
// ---------------------------------------------------------------------------------------

/** Pinned axe-core release (older than two weeks); loaded from jsDelivr by the harness, not the page. */
export const AXE_VERSION = "4.10.2";
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] as const;

let axeSource: string | undefined;

async function axeScript(): Promise<string> {
  if (axeSource !== undefined) return axeSource;
  const url = `https://cdn.jsdelivr.net/npm/axe-core@${AXE_VERSION}/axe.min.js`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  axeSource = await res.text();
  return axeSource;
}

export interface AxeViolation {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly nodes: number;
  readonly targets: string[];
}

/** Runs axe over the current page (evaluated through CDP, so the page's CSP does not apply). */
export async function runAxe(page: Page): Promise<AxeViolation[]> {
  await page.evaluate(await axeScript());
  return page.evaluate(
    async (tags): Promise<AxeViolation[]> => {
      const axe = (
        window as unknown as {
          axe: {
            run: (
              ctx: Document,
              opts: unknown,
            ) => Promise<{
              violations: {
                id: string;
                impact: string | null;
                help: string;
                nodes: { target: unknown[] }[];
              }[];
            }>;
          };
        }
      ).axe;
      const result = await axe.run(document, { runOnly: { type: "tag", values: tags } });
      return result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
        targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
      }));
    },
    [...AXE_TAGS],
  );
}

export interface FocusStop {
  readonly index: number;
  readonly label: string;
  readonly visible: boolean;
  readonly positiveTabindex: boolean;
}

/** Tabs through the page and records, per stop, DOM order, label and whether a focus indicator shows. */
export async function tabThrough(page: Page, max = 60): Promise<FocusStop[]> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const stops: FocusStop[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate((): FocusStop & { body: boolean } => {
      const el = document.activeElement as HTMLElement | null;
      if (el === null || el === document.body) {
        return { body: true, index: -1, label: "", visible: true, positiveTabindex: false };
      }
      const all = Array.from(document.querySelectorAll("*"));
      const style = getComputedStyle(el);
      const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
      const shadow = style.boxShadow !== "none";
      return {
        body: false,
        index: all.indexOf(el),
        label: (el.getAttribute("aria-label") ?? el.textContent ?? el.tagName).trim().slice(0, 40),
        visible: outline || shadow || el.matches(":focus-visible"),
        positiveTabindex: el.tabIndex > 0,
      };
    });
    if (stop.body || seen.has(stop.index)) break;
    seen.add(stop.index);
    stops.push({
      index: stop.index,
      label: stop.label,
      visible: stop.visible,
      positiveTabindex: stop.positiveTabindex,
    });
  }
  return stops;
}
