import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Locator, type Page } from "@playwright/test";
import { Narrator } from "./narration.js";
import { stdioSession } from "./stdio-session.js";

const EXPLORER_URL =
  process.env.EXPLORER_URL ?? "https://travis-oracle-explorer.curiousily.workers.dev";
const OUTPUT_DIR = process.env.DEMO_DIR ?? "demo/output";
const NARRATION_CACHE_DIR = "demo/narration-cache";
const VIDEO_FILE = "explorer-demo.mp4";
const TERMINAL_URL = "https://terminal.demo/";
const VIEWPORT = { width: 1440, height: 900 };
const PAUSE_AFTER_LINE_MS = 700;
const SETTLE_MS = 1_100;
const DATA_TIMEOUT_MS = 120_000;
const AGENT_TIMEOUT_MS = 180_000;
const TERMINAL_LINE_DELAY_MS = 250;
const PLACE = "Rollingwood";
const AGENT_PLACE = "West Lake Hills";
const AGENT_QUESTION = `Which properties in Travis County within five miles of ${AGENT_PLACE} have roofs older than 15 years?`;
const FOLLOW_UP =
  "Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?";
const THOUSAND = 1_000;
const MILLION = 1_000_000;
const EXACT_BELOW = 10_000;
const PERCENT = 100;

type Counts = Record<string, Record<string, number>>;

async function liveCounts(): Promise<Counts> {
  const publications = (await (await fetch(`${EXPLORER_URL}/api/publications`)).json()) as {
    buildId: string;
    rootCid: string;
  }[];
  const latest = [...publications].sort((a, b) => a.buildId.localeCompare(b.buildId)).at(-1);
  if (!latest) throw new Error("There is no publication to demo.");
  const coverage = await fetch(`${EXPLORER_URL}/ipfs/${latest.rootCid}/coverage.json`);
  return (await coverage.json()) as Counts;
}

function about(value: number): string {
  if (value < EXACT_BELOW) return value.toLocaleString("en-US");
  if (value < MILLION) return `about ${Math.round(value / THOUSAND)} thousand`;
  return `about ${(value / MILLION).toFixed(1)} million`;
}

function linesFor(counts: Counts) {
  const count = (group: string, key: string) => Number(counts[group]?.[key] ?? 0);
  const properties = count("properties", "rows");
  const located = Math.round((count("properties", "with_coordinates") / properties) * PERCENT);
  return {
    intro:
      "So, this is the Travis County Oracle. A daily pipeline pulls in Travis County property, permit, ownership and contractor data, resolves contractors against the Texas business registries, and every week publishes a snapshot to IPFS. That snapshot is what this explorer, an AI agent and MCP clients all read.",
    summary: `The latest build holds ${about(properties)} properties, ${about(count("permits", "rows"))} City of Austin permits, ${about(count("roofing_permits", "rows"))} roofing permits and ${about(count("contractors", "rows"))} contractors, and ${located} percent of properties have coordinates.`,
    kinds: `Each kind of record shows its source and when it was collected. ${capitalized(about(count("contractors", "with_registry_match")))} contractors are resolved to a Texas Comptroller taxpayer, and ${about(count("businesses", "rows"))} sales tax outlets are linked to the properties at their addresses.`,
    sources:
      "Every source comes with its publisher, how it's refreshed, and its known limitations. That list ships inside each published snapshot, too.",
    runs: "Here's the run history: every ingest, every build with its row deltas, and every publication, newest first. When a source hasn't changed, the run detects it and skips the download.",
    cost: "And it all runs on GitHub Actions, Cloudflare's free plan, DuckDB in the browser and free IPFS pinning, so there's nothing to pay for.",
    sql: "The SQL console runs DuckDB right in the browser. It reads the published Parquet files with HTTP range requests, so there's no database server at all.",
    tableCounts: "These row counts come straight from the published files.",
    registry:
      "And here are the busiest roofing contractors with their Texas registry record: the legal name, the type of organization, whether it's active, and how each match was made.",
    manifest:
      "The publication page lists every published file with its content ID, size and SHA-256 hash, and how CI verified each one on public gateways when it published. That record is committed to git, too.",
    gateways:
      "Here, the coverage file is fetched by its content ID from two independent public gateways, and its size and hash match the manifest.",
    ipns: "The IPNS name resolves live to the newest manifest. Think of IPNS as the pointer, and the content ID as the snapshot itself.",
    history:
      "Every publication keeps its own content IDs. Earlier roots still resolve on public gateways, and each manifest links back to the one before it.",
    agedRoofs: `On the leads map, these are roofs older than fifteen years within five miles of ${PLACE}. The best evidence comes first: a completed reroof permit, then a new-construction permit, then the year built.`,
    openPermits:
      "Switching to open roofing permits shows permits still open five years or more, longest open first, with the contractor and its BBB grade.",
    neverFinished:
      "If I add permits that expired without a final inspection, and keep only the ones that list a contractor, archived BBB grades start showing up.",
    permitDetail:
      "Each permit shows its status, how long it's been open, and the contractor's BBB grade, dated by the archived snapshot it came from.",
    hail: "Next, roofs that took reported hail. Each of these properties had a NOAA hail report of an inch or more within two miles in the last three years, after its roof went on, linked to the NOAA record.",
    topLeads:
      "And top leads puts it all into one transparent score: points for roof age, for a permit left unfinished, and for recent hail, so the strongest leads come first.",
    agent:
      "The agent answers the same questions in plain English. A Workers AI model picks the query tools, the tools run right here in the browser, and every answer shows its evidence.",
    agentAnswer:
      "The answer lists the matching properties with how each roof age was estimated and how confident it is, and it spells out its assumptions and gaps.",
    followUp:
      "Now a follow-up about the same area: which roofing permits have been open for years, and who's the contractor?",
    followUpAnswer:
      "It reuses the same area, keeps permits open five years or more that list a contractor, and notes what the matches are missing.",
    mcpSession:
      "Finally, the system is MCP-ready. This page is itself an MCP client: it connects to the same MCP server that npm run mcp starts, here running in the browser, and gets its read-only tools from tools list.",
    mcpCall:
      "Calling a tool sends a tools call request. The server answers with the same rows the explorer and the agent use, plus the SQL behind them and the dataset's content IDs.",
    mcpMessage: "Here's that request as raw JSON-RPC, with the tool name and its arguments.",
    mcpConnect:
      "To connect your own client, add the server with one command, or paste this configuration. The roofing CRM's assistant calls these very same tools, so the data model never changes.",
    mcpStdio: `And this is a real session over standard input and output: a plain MCP client starts npm run mcp, lists the tools, and finds aged roofs near ${PLACE} in the published dataset.`,
  };
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function terminalPage(transcript: readonly string[]): string {
  const escaped = (line: string) =>
    line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const lines = transcript
    .map(
      (line, index) =>
        `<div style="animation-delay:${index * TERMINAL_LINE_DELAY_MS}ms">${escaped(line)}</div>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>MCP client over stdio</title><style>
    body{margin:0;background:#0f1216;color:#d7dde4;font:15px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
    header{padding:14px 24px;background:#1a1f26;color:#9aa5b1;font-family:Inter,system-ui,sans-serif}
    main{padding:20px 24px;white-space:pre-wrap;word-break:break-word}
    main div{opacity:0;animation:show .2s forwards}
    @keyframes show{to{opacity:1}}
  </style></head><body><header>Terminal · a plain MCP client (MCP TypeScript SDK) driving <b>npm run mcp</b> over stdio · live session, ${new Date().toISOString().slice(0, 10)}</header><main>${lines}</main></body></html>`;
}

async function show(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate((element) =>
    element.scrollIntoView({ behavior: "smooth", block: "start" }),
  );
  await locator.page().waitForTimeout(SETTLE_MS);
}

async function open(page: Page, hash: string) {
  await page.goto(`${EXPLORER_URL}/#/${hash}`);
  await page.getByText(/^Dataset \d{8}T\d{6}Z$/).waitFor({ timeout: DATA_TIMEOUT_MS });
}

async function record() {
  const lines = linesFor(await liveCounts());
  const transcript = await stdioSession();
  const narrator = await Narrator.prepare(Object.values(lines), NARRATION_CACHE_DIR);
  const narrate = async (page: Page, line: string) =>
    page.waitForTimeout(narrator.say(line) + PAUSE_AFTER_LINE_MS);
  const quickly = <T>(wait: () => Promise<T>) => narrator.cutWaiting(wait);

  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: OUTPUT_DIR, size: VIEWPORT },
  });
  const page = await context.newPage();
  await page.route(TERMINAL_URL, (route) =>
    route.fulfill({ contentType: "text/html", body: terminalPage(transcript) }),
  );
  narrator.startRecording();

  await quickly(() => open(page, "overview"));
  await narrate(page, lines.intro);
  await narrate(page, lines.summary);
  await show(page.getByRole("heading", { name: "Records by kind" }));
  await narrate(page, lines.kinds);
  await show(page.getByRole("heading", { name: "Sources" }));
  await narrate(page, lines.sources);
  await show(page.getByRole("heading", { name: "Run history" }));
  await narrate(page, lines.runs);
  await show(page.getByRole("heading", { name: "Infrastructure and cost" }));
  await narrate(page, lines.cost);

  await quickly(() => open(page, "sql"));
  await narrate(page, lines.sql);
  await quickly(async () => {
    await page.getByRole("button", { name: "Run query" }).click();
    await page.locator(".data-table tbody tr").first().waitFor({ timeout: DATA_TIMEOUT_MS });
  });
  await narrate(page, lines.tableCounts);
  await quickly(async () => {
    await page.getByRole("button", { name: "Roofing contractors in the Texas registry" }).click();
    await page
      .locator(".data-table thead")
      .getByText("registry_name")
      .waitFor({ timeout: DATA_TIMEOUT_MS });
  });
  await narrate(page, lines.registry);

  await quickly(() => open(page, "publication"));
  await narrate(page, lines.manifest);
  await show(page.getByRole("heading", { name: "Objects" }));
  const coverage = page.locator("tr").filter({ hasText: "coverage.json" });
  await quickly(async () => {
    await coverage.getByRole("button", { name: /verify/ }).click();
    await coverage.getByText("gw.ipfs-lens.dev: verified").waitFor({ timeout: DATA_TIMEOUT_MS });
  });
  await narrate(page, lines.gateways);
  await show(page.getByRole("heading", { name: "Artifact manifest" }));
  await quickly(async () => {
    await page.getByRole("button", { name: /Resolve now/ }).click();
    await page.getByText(/resolves to/).waitFor({ timeout: DATA_TIMEOUT_MS });
  });
  await narrate(page, lines.ipns);
  const history = page.locator(".card").filter({ hasText: "Publication history" });
  await show(history);
  await quickly(async () => {
    const publications = history.locator("tbody tr");
    for (let row = 0; row < (await publications.count()); row += 1) {
      const check = publications.nth(row).getByRole("button", { name: "check root" });
      if ((await check.count()) > 0) await check.click();
    }
    await page.waitForFunction(() => !document.body.textContent?.includes("checking…"), undefined, {
      timeout: DATA_TIMEOUT_MS,
    });
  });
  await narrate(page, lines.history);

  await quickly(() => open(page, "leads"));
  const results = page.locator(".card").filter({ hasText: "matches within" });
  await quickly(async () => {
    await page.getByLabel("Center on a place").selectOption(PLACE);
    await results.locator("tbody tr").first().waitFor({ timeout: DATA_TIMEOUT_MS });
  });
  await narrate(page, lines.agedRoofs);
  await show(results);
  await show(page.getByRole("tab", { name: "Aged roofs" }));
  await quickly(async () => {
    await page.getByRole("tab", { name: "Open roofing permits" }).click();
    await results.locator("tbody tr").first().waitFor({ timeout: DATA_TIMEOUT_MS });
  });
  await narrate(page, lines.openPermits);
  await quickly(async () => {
    await page.getByLabel(/Also permits that expired/).check();
    await page.getByLabel(/Only permits that list a contractor/).check();
    await results.locator("tbody tr").first().waitFor({ timeout: DATA_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);
  });
  await show(results);
  await narrate(page, lines.neverFinished);
  await results
    .locator("tbody tr")
    .filter({ hasText: /\bA\+|\bA-|\bB\+/ })
    .first()
    .click();
  await page.waitForTimeout(SETTLE_MS);
  await narrate(page, lines.permitDetail);
  await quickly(async () => {
    await page.getByRole("tab", { name: "Hail on current roof" }).click();
    await results
      .locator("thead")
      .getByText("max_hail_inches")
      .waitFor({ timeout: DATA_TIMEOUT_MS });
  });
  await show(results);
  await narrate(page, lines.hail);
  await quickly(async () => {
    await page.getByRole("tab", { name: "Top leads" }).click();
    await results.locator("thead").getByText("lead_score").waitFor({ timeout: DATA_TIMEOUT_MS });
  });
  await narrate(page, lines.topLeads);

  await quickly(() => open(page, "agent"));
  await narrate(page, lines.agent);
  await page.getByLabel("Question").fill(AGENT_QUESTION);
  await quickly(async () => {
    await page.getByRole("button", { name: "Ask" }).click();
    await page.locator(".bubble.agent").first().waitFor({ timeout: AGENT_TIMEOUT_MS });
  });
  await show(page.locator(".evidence").first());
  await show(page.locator(".bubble.agent").first());
  await narrate(page, lines.agentAnswer);
  await narrate(page, lines.followUp);
  await page.getByLabel("Question").fill(FOLLOW_UP);
  await quickly(async () => {
    await page.getByRole("button", { name: "Ask" }).click();
    await page.locator(".bubble.agent").nth(1).waitFor({ timeout: AGENT_TIMEOUT_MS });
  });
  await show(page.locator(".turn").nth(1));
  await show(page.locator(".bubble.agent").nth(1));
  await narrate(page, lines.followUpAnswer);

  await quickly(async () => {
    await open(page, "mcp");
    await page.locator(".facts").getByText("travis-oracle").waitFor({ timeout: DATA_TIMEOUT_MS });
  });
  await narrate(page, lines.mcpSession);
  await page.getByRole("button", { name: /find_open_roofing_permits/ }).click();
  await quickly(async () => {
    await page.getByRole("button", { name: "Call tool" }).click();
    await page.locator(".data-table tbody tr").first().waitFor({ timeout: DATA_TIMEOUT_MS });
  });
  await narrate(page, lines.mcpCall);
  const request = page.locator(".rpc-log li").filter({ hasText: "tools/call" }).last();
  await request.getByText("message").click();
  await show(page.getByRole("heading", { name: "JSON-RPC messages" }));
  await narrate(page, lines.mcpMessage);
  await show(page.getByRole("heading", { name: "Connect an MCP client" }));
  await page.getByText("Client configuration (mcpServers)").click();
  await narrate(page, lines.mcpConnect);
  await page.goto(TERMINAL_URL);
  await page.waitForTimeout(transcript.length * TERMINAL_LINE_DELAY_MS);
  await narrate(page, lines.mcpStdio);

  const video = page.video();
  await context.close();
  await browser.close();
  const recorded = await video?.path();
  if (!recorded) throw new Error("Playwright did not record a video.");
  await narrator.mixInto(recorded, join(OUTPUT_DIR, VIDEO_FILE));
  await rm(recorded);
  console.log(await readdir(OUTPUT_DIR));
}

await record();
