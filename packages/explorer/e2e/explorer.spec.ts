import { expect, type Page, test } from "@playwright/test";

const SCREENSHOTS = "test-results/screenshots";

async function open(page: Page, hash: string) {
  await page.goto(`/#/${hash}`);
  await expect(page.getByText(/^Dataset \d{8}T\d{6}Z$/)).toBeVisible();
}

test("shows the pipeline run summary, records by kind and documented source limitations", async ({
  page,
}) => {
  await open(page, "overview");

  await expect(page.getByRole("heading", { name: "Pipeline run summary" })).toBeVisible();
  const properties = page
    .locator(".stat")
    .filter({ has: page.getByText("Properties", { exact: true }) });
  await expect(properties).toContainText(/\d{3},\d{3}/);
  await expect(page.getByRole("heading", { name: "Records by kind" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Business \(sales tax outlet\)/ })).toContainText(
    /linked to a TCAD property/,
  );
  await expect(page.getByRole("heading", { name: "Run history" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Infrastructure and cost" })).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOTS}/overview.png`, fullPage: true });
});

test("verifies the manifest by CID on two independent public gateways", async ({ page }) => {
  await open(page, "publication");

  await page.locator(".facts dd").first().getByRole("button", { name: "verify" }).click();

  const checks = page.locator(".facts dd").first().locator(".badge");
  await expect(checks.filter({ hasText: "ipfs.orbitor.dev: verified" })).toBeVisible();
  await expect(checks.filter({ hasText: "gw.ipfs-lens.dev: verified" })).toBeVisible();
  await expect(page.getByText(/\d+ of \d+ gateway checks passed when CI published/)).toBeVisible();
  await expect(page.getByRole("link", { name: "record committed to git" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Publication history" })).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOTS}/publication.png`, fullPage: true });
});

test("finds aged roofs and long-open roofing permits within a radius", async ({ page }) => {
  await open(page, "leads");

  const results = page.locator(".card").filter({ hasText: "matches within" });
  await expect(results).toContainText(/[\d,]+ matches within 5 miles of Austin/);
  await expect(results.locator("tbody tr").first()).toContainText(/completed replacement.*high/);

  await page.getByRole("tab", { name: "Open roofing permits" }).click();
  await expect(results).toContainText(/[\d,]+ matches within 5 miles of Austin/);
  await expect(results.locator("thead")).toContainText("contractor_name");
  await results.locator("tbody tr").first().click();
  await expect(page.getByText(/permit .* open \d+ years/)).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOTS}/leads.png`, fullPage: true });
});

test("finds roofs that took reported hail after they went on", async ({ page }) => {
  await open(page, "leads");

  await page.getByRole("tab", { name: "Hail on current roof" }).click();

  const results = page.locator(".card").filter({ hasText: "matches within" });
  await expect(results).toContainText(/[\d,]+ matches within 5 miles of Austin/);
  await expect(results.locator("thead")).toContainText("max_hail_inches");
});

test("runs SQL in DuckDB-WASM over the published Parquet tables", async ({ page }) => {
  await open(page, "sql");

  await page.getByRole("button", { name: "Run query" }).click();

  await expect(page.locator(".data-table tbody tr")).toHaveCount(7);
  await expect(page.locator(".data-table")).toContainText("hail events");

  await page.getByRole("button", { name: "Roofing contractors in the Texas registry" }).click();
  await expect(page.locator(".data-table thead")).toContainText("registry_name");
  await expect(page.locator(".data-table tbody tr").first()).toContainText(/LLC|INC/);
  await page.screenshot({ path: `${SCREENSHOTS}/sql.png`, fullPage: true });
});

test("runs the agent's tool loop in the browser and shows the evidence", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/agent", async (route) => {
    calls += 1;
    const message =
      calls === 1
        ? {
            content: "",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "find_aged_roofs",
                  arguments: JSON.stringify({
                    place: "Rollingwood",
                    radius_miles: 5,
                    min_roof_age_years: 15,
                  }),
                },
              },
            ],
          }
        : { content: "**Scripted answer** from the evidence above.", tool_calls: [] };
    await route.fulfill({
      json: {
        message,
        neurons: 0,
        cached: true,
        budget: { used: 0, limit: 4500 },
        model: "scripted",
      },
    });
  });
  await open(page, "agent");

  await page.getByRole("button", { name: /Rollingwood have roofs older than 15 years/ }).click();

  await expect(page.locator(".evidence")).toContainText(/[\d,]+ matches around Rollingwood/);
  await expect(page.locator(".bubble.agent")).toContainText("Scripted answer");
  expect(calls).toBe(2);
  await page.screenshot({ path: `${SCREENSHOTS}/agent.png`, fullPage: true });
});

test("speaks MCP: lists the server's tools over tools/list and calls one over tools/call", async ({
  page,
}) => {
  await open(page, "mcp");

  await expect(page.locator(".facts")).toContainText("travis-oracle");
  await page.getByRole("button", { name: /locate_place/ }).click();
  await page.getByRole("button", { name: "Call tool" }).click();

  await expect(page.locator(".data-table")).toContainText("Bee Cave");
  const log = page.locator(".rpc-log");
  await expect(log).toContainText("initialize");
  await expect(log).toContainText("tools/list");
  await expect(log).toContainText("tools/call locate_place");
  await page.screenshot({ path: `${SCREENSHOTS}/mcp.png`, fullPage: true });
});
