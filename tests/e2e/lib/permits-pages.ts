// Paging helpers for the hosted Permits page (A-11: the full-county list is paged, 20 rows per
// page, because one page of ~15,000 rows built ~950,000 DOM elements and froze slower browsers).
//
// DOM contract these helpers read (apps/web/src/routes/Permits.page.tsx):
// - `<nav aria-label="Permits pages">` holds `<p data-testid="permits-range" data-first data-last
//   data-total>` with the text `Showing 1–20 of 15,025` and the buttons `Previous page` /
//   `Next page` (disabled at the ends).
// - `table tbody tr` (from 600 px) or the cards list (below 600 px) renders only the current
//   page's rows: min(PERMITS_PAGE_SIZE, rows left).
// - The total is the manifest's `permits_emitted`; the whole list is validated in memory.
// Texts come from @countylens/shared, never retyped here.
import type { Locator, Page } from "@playwright/test";
import { PERMITS_PAGE_SIZE, PERMITS_TEXTS } from "@countylens/shared";
import { expect } from "./fixtures.js";
import { PERMITS_LOAD_WAIT_MS } from "./perf.js";

export const PAGE_SIZE: number = PERMITS_PAGE_SIZE;

/** A data-table body row (the desktop layout every list case runs at). */
export const ROW = "table tbody tr";

/** The range line `Showing a–b of N`; its `data-first`, `data-last` and `data-total` hold the numbers. */
export const RANGE = '[data-testid="permits-range"]';

export interface PermitsRange {
  first: number;
  last: number;
  total: number;
  text: string;
}

export function pagerNav(page: Page): Locator {
  return page.getByRole("navigation", { name: PERMITS_TEXTS.pagesLabel });
}

export function previousButton(page: Page): Locator {
  return pagerNav(page).getByRole("button", { name: PERMITS_TEXTS.previousPage });
}

export function nextButton(page: Page): Locator {
  return pagerNav(page).getByRole("button", { name: PERMITS_TEXTS.nextPage });
}

/** How many pages `total` rows make. */
export function pageCountOf(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

/** How many rows page `pageIndex` (0-based) shows out of `total`. */
export function rowsOnPageOf(total: number, pageIndex: number): number {
  return Math.max(0, Math.min(PAGE_SIZE, total - pageIndex * PAGE_SIZE));
}

/** The range line's numbers and text, read in one round trip. */
export async function readRange(page: Page): Promise<PermitsRange> {
  return page.locator(RANGE).evaluate((element) => ({
    first: Number(element.getAttribute("data-first")),
    last: Number(element.getAttribute("data-last")),
    total: Number(element.getAttribute("data-total")),
    text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
  }));
}

/** The total the page reports (the manifest's `permits_emitted`). */
export async function permitsTotal(page: Page): Promise<number> {
  return (await readRange(page)).total;
}

/**
 * Waits until the list rendered its first page and the range line, or fails naming the error
 * banner or the empty state the page showed instead. Returns the rows locator (one page of rows).
 */
export async function waitForPermitRows(
  page: Page,
  timeoutMs = PERMITS_LOAD_WAIT_MS,
): Promise<Locator> {
  const rows = page.locator(ROW);
  const alert = page.getByRole("alert");
  const empty = page.getByText(PERMITS_TEXTS.empty, { exact: true });
  // A-16 A11-11: the first page paints early (data-state="first-page", Next disabled); the full
  // list and its count check follow. Callers page through every row, so wait for the full list.
  const firstPage = page.locator('section[data-route="permits"][data-state="first-page"]');
  await expect
    .poll(
      async () => {
        if ((await firstPage.count()) > 0) return "pending";
        if ((await rows.count()) > 0) return "rows";
        if ((await alert.count()) > 0) return "alert";
        if ((await empty.count()) > 0) return "empty";
        return "pending";
      },
      { timeout: timeoutMs, message: "the Permits list, an error banner or the empty state" },
    )
    .not.toBe("pending");
  if ((await alert.count()) > 0) {
    throw new Error(`the Permits page shows an error banner: ${await alert.first().innerText()}`);
  }
  if ((await empty.count()) > 0) {
    throw new Error(`the Permits page shows the empty state: ${PERMITS_TEXTS.empty}`);
  }
  await expect(page.locator(RANGE), "the range line shows with the first page").toBeVisible();
  return rows;
}

/**
 * Page 1 of a list of `total` rows: the total the page reports, the range line text, one page of
 * rows, Previous disabled, and Next disabled only when everything fits on one page.
 */
export async function expectFirstPage(page: Page, total: number): Promise<void> {
  const range = await readRange(page);
  expect(range.total, "the page reports permits_emitted as its total").toBe(total);
  expect(range.first, "page 1 starts at row 1").toBe(1);
  expect(range.last, "page 1 ends at min(page size, total)").toBe(Math.min(PAGE_SIZE, total));
  expect(range.text, "the range line").toBe(
    PERMITS_TEXTS.showing(1, Math.min(PAGE_SIZE, total), total),
  );
  await expect(page.locator(ROW), "rows on page 1").toHaveCount(rowsOnPageOf(total, 0));
  await expect(previousButton(page), "Previous is disabled on page 1").toBeDisabled();
  if (pageCountOf(total) === 1) {
    await expect(
      nextButton(page),
      "Next is disabled when one page holds everything",
    ).toBeDisabled();
  } else {
    await expect(nextButton(page), "Next is enabled on page 1").toBeEnabled();
  }
}

export interface WalkedPage {
  /** 0-based page number. */
  pageIndex: number;
  /** Global index of this page's first row (0-based). */
  offset: number;
  rows: Locator;
}

/**
 * Visits every page from the current one (page 1) to the last by clicking Next. For each page it
 * checks the range line (first, last, total, text) and the number of rows, then calls `visit`.
 * At the end it checks the last page holds the remainder, Next is disabled and Previous is not
 * (unless there is one page).
 */
export async function walkAllPages(
  page: Page,
  total: number,
  visit: (walked: WalkedPage) => Promise<void>,
): Promise<number> {
  const pages = pageCountOf(total);
  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const offset = pageIndex * PAGE_SIZE;
    const expectedRows = rowsOnPageOf(total, pageIndex);
    const first = offset + 1;
    const last = offset + expectedRows;
    if (pageIndex > 0) {
      await nextButton(page).click();
      await expect(page.locator(RANGE), `page ${pageIndex + 1} is shown`).toHaveAttribute(
        "data-first",
        String(first),
      );
    }
    const range = await readRange(page);
    expect(range, `page ${pageIndex + 1} range`).toEqual({
      first,
      last,
      total,
      text: PERMITS_TEXTS.showing(first, last, total),
    });
    const rows = page.locator(ROW);
    expect(await rows.count(), `rows on page ${pageIndex + 1}`).toBe(expectedRows);
    await visit({ pageIndex, offset, rows });
  }
  await expect(nextButton(page), "Next is disabled on the last page").toBeDisabled();
  if (pages > 1) {
    await expect(previousButton(page), "Previous is enabled on the last page").toBeEnabled();
  }
  return pages;
}
