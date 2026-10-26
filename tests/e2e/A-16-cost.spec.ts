// A-16 Part 1 on the hosted Coverage page (testplans/A-16-test-cases.md TC-001, 002, 005, 006,
// 007, 008, 009, NF-01; AC-1, AC-3, AC-4, AC-5): the "Cost" and "Source speed and constraints"
// sections equal docs/cost.md and docs/source-limits.md, carry "as of" and the source, show gross
// apart from credits, keep a partial day apart, and say "not available · reason" instead of a
// zero. The docs are parsed here with the same parsers the build uses (scripts/
// build-cost-limits.mjs), so the page is compared with the docs, not with its own data file.
// Run: RUNTIME_URL=https://… pnpm exec playwright test --project=a16-cost
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { ROUTES } from "@countylens/shared";
import { COST_DOC, LIMITS_DOC, parseCost, parseLimits } from "../../scripts/build-cost-limits.mjs";
import { checkpoint } from "./lib/auth.js";

interface CostDoc {
  asOf: string;
  source: string;
  fixedPerMonth: string;
  gross: { usd: number | null };
  credits: { usd: number | null };
  partialDay: { day: string; grossUsd: number } | null;
  budget: { text: string | null };
  rows: {
    component: string;
    idle: string | null;
    whoPays: string | null;
    missingReason: string | null;
  }[];
}
interface LimitsDoc {
  asOf: string;
  rows: {
    source: string;
    throughput: string | null;
    status: "measured" | "not_measured" | "blocked";
    blockedDates: string[];
    missingReason: string | null;
  }[];
}

const cost = parseCost(readFileSync(COST_DOC, "utf8")) as CostDoc;
const limits = parseLimits(readFileSync(LIMITS_DOC, "utf8")) as LimitsDoc;

// The page shows the doc's Cost Explorer figures in cents; under a cent (non-zero) reads "< $0.01".
const money = (n: number): string => {
  const abs = Math.abs(n);
  return `${n < 0 ? "-" : ""}${abs > 0 && abs < 0.005 ? "< $0.01" : `$${abs.toFixed(2)}`}`;
};
const cents = (text: string): string =>
  text.replace(/\$(\d+\.\d{3,})/g, (_, amount: string) => money(Number(amount)));

async function openCoverage(page: Page): Promise<void> {
  await page.goto(ROUTES.coverage);
  await expect(page.locator('[data-section="cost"]')).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
}

const costSection = (page: Page) => page.locator('[data-section="cost"]');
const limitsSection = (page: Page) => page.locator('[data-section="source-limits"]');

test.describe("A-16 Cost and Limits on Coverage", () => {
  test("A-16-TC-001 idle cost table", async ({ page }) => {
    await openCoverage(page);
    const section = costSection(page);
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByText(`${cost.fixedPerMonth} fixed per month`)).toBeVisible();
    await expect(section.locator("[data-as-of]").first()).toHaveAttribute("data-as-of", cost.asOf);
    for (const name of [
      "Amplify",
      "Lambda",
      "API Gateway",
      "S3 + CloudFront",
      "DynamoDB",
      "SSM",
      "CloudWatch",
      "Scheduler",
      "Cognito",
      "SQS",
      "SNS",
    ]) {
      const row = section.locator("[data-cost-row]", { hasText: name }).first();
      await expect(row, name).toBeVisible();
      await expect(row.locator('[data-label="Fixed (idle) per month"]'), name).not.toBeEmpty();
      await expect(row.locator('[data-label="Who pays per use"]'), name).not.toBeEmpty();
    }
    await checkpoint(page, "TC-001", "idle-cost-table");
  });

  test("A-16-TC-002 gross vs credits vs per-use", async ({ page }) => {
    await openCoverage(page);
    const section = costSection(page);
    expect(cost.gross.usd).not.toBeNull();
    await expect(section.locator('[data-tile="gross"]')).toContainText(money(cost.gross.usd ?? 0));
    await expect(section.locator('[data-tile="credits"]')).toContainText(
      money(cost.credits.usd ?? 0),
    );
    // Gross and credits are two tiles; the net is never presented as the cost.
    await expect(section.locator('[data-tile="gross"]')).not.toContainText("fixed per month");
    // Part 2 resources are listed as per-use lines.
    for (const name of ["Cognito", "SQS", "SNS"]) {
      const row = section.locator("[data-cost-row]", { hasText: name }).first();
      await expect(row.locator('[data-label="Per use"]')).not.toBeEmpty();
    }
    await checkpoint(page, "TC-002", "gross-credits");
  });

  test("A-16-TC-005 limits table complete", async ({ page }) => {
    await openCoverage(page);
    const section = limitsSection(page);
    await section.scrollIntoViewIfNeeded();
    for (const row of limits.rows) {
      const tr = section.locator("[data-limit-source]").filter({ hasText: row.source }).first();
      await expect(tr, row.source).toBeVisible();
      await expect(tr.locator('[data-label="Throughput"]'), row.source).not.toBeEmpty();
      await expect(tr.locator('[data-label="Rate limit"]'), row.source).not.toBeEmpty();
      await expect(tr.locator('[data-label="Full capture"]'), row.source).not.toBeEmpty();
      await expect(tr, row.source).toHaveAttribute("data-status", row.status);
    }
    await checkpoint(page, "TC-005", "limits-table");
  });

  test("A-16-TC-006 blocked source shows dates, not a throughput", async ({ page }) => {
    await openCoverage(page);
    const blocked = limits.rows.filter((r) => r.status === "blocked");
    expect(blocked.length).toBeGreaterThan(0);
    for (const row of blocked) {
      const tr = limitsSection(page)
        .locator("[data-limit-source]")
        .filter({ hasText: row.source })
        .first();
      const cell = tr.locator('[data-label="Throughput"]');
      await expect(cell).toContainText("Blocked");
      await expect(cell.locator("[data-blocked-dates]")).toHaveAttribute(
        "data-blocked-dates",
        row.blockedDates.join(","),
      );
      for (const day of row.blockedDates) await expect(cell).toContainText(day);
    }
    await checkpoint(page, "TC-006", "blocked-dates");
  });

  test("A-16-TC-007 page equals docs", async ({ page }) => {
    await openCoverage(page);
    // Cost: every doc row's idle cell, and the headline figures.
    for (const row of cost.rows) {
      const tr = costSection(page).locator(
        `[data-cost-row="${row.component.replace(/"/g, '\\"')}"]`,
      );
      await expect(tr, row.component).toHaveCount(1);
      if (row.idle !== null) {
        await expect(tr.locator('[data-label="Fixed (idle) per month"]')).toHaveText(
          cents(row.idle),
        );
      }
      if (row.whoPays !== null) {
        await expect(tr.locator('[data-label="Who pays per use"]')).toHaveText(row.whoPays);
      }
    }
    // Limits: every measured throughput cell equals the doc.
    for (const row of limits.rows.filter((r) => r.status === "measured")) {
      const tr = limitsSection(page)
        .locator("[data-limit-source]")
        .filter({ hasText: row.source })
        .first();
      await expect(tr.locator('[data-label="Throughput"]')).toHaveText(row.throughput ?? "");
    }
    // Both sections carry "as of {date}" and a source.
    await expect(costSection(page).locator("[data-as-of]").first()).toContainText(
      `as of ${cost.asOf}`,
    );
    await expect(costSection(page).locator("[data-as-of]").first()).toContainText(cost.source);
    await expect(limitsSection(page).locator("[data-as-of]").first()).toContainText(
      `as of ${limits.asOf}`,
    );
    await expect(limitsSection(page).locator("[data-as-of]").first()).toContainText(
      "docs/source-limits.md",
    );
    await checkpoint(page, "TC-007", "page-equals-docs");
  });

  test("A-16-TC-008 cost lag as-of", async ({ page }) => {
    await openCoverage(page);
    const section = costSection(page);
    await expect(section.locator("[data-as-of]").first()).toContainText(`as of ${cost.asOf}`);
    if (cost.partialDay === null) {
      await expect(section.locator("[data-partial-day]")).toHaveCount(0);
    } else {
      // The newer day is shown apart and named partial; it is not a row or a total.
      const notice = section.locator("[data-partial-day]");
      await expect(notice).toContainText(`Partial (as of ${cost.asOf})`);
      await expect(notice).toContainText(cost.partialDay.day);
      await expect(section.locator('[data-tile="gross"]')).not.toContainText(cost.partialDay.day);
    }
    // No zero is filled in for a day the bill has not reached.
    await expect(
      section.locator("[data-cost-row]", { hasText: cost.partialDay?.day ?? "never" }),
    ).toHaveCount(0);
    await checkpoint(page, "TC-008", "cost-lag");
  });

  test("A-16-TC-009 filebase usage unavailable", async ({ page }) => {
    await openCoverage(page);
    const filebase = cost.rows.find((r) => r.component.startsWith("Filebase"));
    expect(filebase?.missingReason).toBeTruthy();
    const cell = costSection(page)
      .locator('[data-cost-row^="Filebase"]')
      .locator('[data-label="Fixed (idle) per month"]');
    await expect(cell).toHaveText(
      `Filebase usage: not available · ${filebase?.missingReason ?? ""}`,
    );
    await expect(cell).not.toContainText("$0");
    await checkpoint(page, "TC-009", "filebase-not-available");
  });

  test("A-16-TC-NF-01 zero idle", async ({ page }) => {
    await openCoverage(page);
    const section = costSection(page);
    await expect(section.getByText(`${cost.fixedPerMonth} fixed per month`)).toBeVisible();
    // The budget alert tile shows the doc's CDK-owned budget, or why it is missing.
    const budget = section.locator('[data-tile="budget"]');
    await (cost.budget.text === null
      ? expect(budget).toContainText("Not available · ")
      : expect(budget).toContainText(cost.budget.text));
  });
});

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const) {
  test.describe(`A-16 Cost and Limits layout at ${viewport.width} px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test(`A-16-TC-NF-02 no horizontal page scroll, sections stacked or tabular (${viewport.name})`, async ({
      page,
    }) => {
      await openCoverage(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
      await expect(costSection(page)).toBeVisible();
      await expect(limitsSection(page)).toBeVisible();
      // Below 840 px the tables stack as labelled blocks (no table header row).
      // The header is visually hidden (1 px, clipped) but kept for screen readers, so measure it.
      const headerBox = await limitsSection(page).locator("thead").first().boundingBox();
      const headerShown = headerBox !== null && headerBox.width > 1 && headerBox.height > 1;
      expect(headerShown).toBe(viewport.width >= 840);
      await checkpoint(page, "TC-NF-02", `coverage-${viewport.width}`);
    });
  });
}
