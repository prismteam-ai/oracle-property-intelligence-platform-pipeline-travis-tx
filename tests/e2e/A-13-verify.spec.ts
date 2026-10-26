// A-13 Part 1 Verify cases (T032; testplans/A-13-test-cases.md § 8 "Data · Manifest and Verify"):
// TC-006, TC-018 … TC-024. They hit the public gateways (Pinata, orbitor, Filebase), which rate-limit,
// so they run serially on one worker: `test.describe.configure({ mode: "serial" })` plus the tag
// `@a13-verify`, so CI runs them with `--grep @a13-verify --workers=1`. Faults (429, unreadable
// responses, flipped bytes, CID copy down) are injected with page.route() in this browser only;
// nothing on the server or IPFS changes. Expected values come from the `oracle` fixture.
import type { Page, Request, Route } from "@playwright/test";
import { ROUTES, VERIFY_TEXTS, verifyPath } from "@countylens/shared";
import {
  checkpoint,
  expect,
  noteBranch,
  ready,
  recordRequests,
  settled,
  test,
  type A13Oracle,
} from "./lib/a13-fixtures.js";
import {
  SEL,
  directoryArtifact,
  fallbackText,
  flipLastByte,
  oversizedFiles,
  scenario,
  verifyFileArtifact,
} from "./lib/a13-ui.js";
import { harnessConfig, runtimeUrl, sha256Hex } from "./lib/runtime.js";

const PINATA = (): string => harnessConfig().PINATA_GATEWAY_HOST;
const FILEBASE = (): string => harnessConfig().FILEBASE_GATEWAY_HOST;
const ORBITOR = (): string => harnessConfig().ORBITOR_GATEWAY_HOST;
const FORBIDDEN_HOSTS = ["ipfs.io", "dweb.link", "w3s.link"];
/** All lanes, with retries (2 + 4 + 8 s) and 30 s per try. */
const LANES_DONE_MS = 150_000;

test.describe("A-13 verify", { tag: "@a13-verify" }, () => {
  test.describe.configure({ mode: "serial" });

  type Gw = "pinata" | "orbitor" | "filebase";
  const GW_HOST: Readonly<Record<Gw, () => string>> = {
    pinata: PINATA,
    orbitor: ORBITOR,
    filebase: FILEBASE,
  };
  const laneUrl = (gw: Gw, cid: string): string => `https://${GW_HOST[gw]()}/ipfs/${cid}`;

  /** Every lane ends `verified` with size and SHA-256 equal to the expected values; the ✓ shows
   * only on the counted lanes (Pinata, orbitor), the Filebase lane is `data-independent="false"`
   * with no ✓, and the page result reads verified on Pinata and orbitor (AM-10). */
  async function expectVerified(
    page: Page,
    cid: string,
    size: number,
    sha256: string,
  ): Promise<void> {
    for (const [gw, operator] of [
      ["pinata", "Pinata"],
      ["orbitor", "orbitor"],
      ["filebase", "Filebase"],
    ] as const) {
      const lane = page.locator(SEL.lane(gw));
      await expect(lane).toHaveAttribute("data-state", "verified", { timeout: LANES_DONE_MS });
      await expect(lane).toContainText(laneUrl(gw, cid));
      await expect(lane).toContainText(operator);
      await expect(lane.locator("[data-got-size]")).toHaveAttribute("data-value", String(size));
      await expect(lane.locator("[data-got-sha256]")).toHaveAttribute("data-value", sha256);
      await expect(lane.locator("[data-expected-size]")).toHaveAttribute(
        "data-value",
        String(size),
      );
      await expect(lane.locator("[data-expected-sha256]")).toHaveAttribute("data-value", sha256);
      if (gw === "filebase") {
        await expect(lane).toHaveAttribute("data-independent", "false");
        await expect(lane.getByText("✓")).toHaveCount(0);
        await expect(lane.locator('[aria-label="verified"]')).toHaveCount(0);
      } else {
        await expect(lane).toHaveAttribute("data-independent", "true");
        await expect(lane.getByText("✓")).toBeVisible();
      }
    }
    await expect(page.locator(SEL.verifyResult)).toHaveAttribute("data-verify-result", "verified");
    await expect(page.locator(SEL.verifyResult)).toContainText(VERIFY_TEXTS.independentVerified);
  }

  /** Request times of the page's requests to `url` (prefix match). */
  function requestTimes(page: Page, url: string): number[] {
    const times: number[] = [];
    page.on("request", (r: Request) => {
      if (r.url().startsWith(url)) times.push(Date.now());
    });
    return times;
  }

  function gaps(times: readonly number[]): number[] {
    return times.slice(1).map((t, i) => t - (times[i] ?? t));
  }

  /** The CID copy host: CID_COPY_HOST, else any host serving a published CID that is not a gateway or the site. */
  function isCidCopy(url: URL, oracle: A13Oracle, siteHost: string): boolean {
    const configured = harnessConfig().CID_COPY_HOST;
    if (configured !== undefined) return url.host === configured;
    if ([PINATA(), ORBITOR(), FILEBASE(), siteHost].includes(url.host)) return false;
    if (url.href.includes(oracle.manifestCid)) return true;
    return oracle.M.artifacts.some(
      (a) => url.href.includes(a.cid) || (a.carCid !== undefined && url.href.includes(a.carCid)),
    );
  }

  test(scenario("006"), async ({ page, oracle }) => {
    const artifact = verifyFileArtifact(oracle.M);
    // 1. Data · Manifest.
    await page.goto(ROUTES.dataManifest);
    const section = await ready(page, "data-manifest");
    // 2. Verify on the test-data row → /data/verify/{cid}: two independent lanes + the Filebase fallback.
    await section
      .locator(SEL.artifactRow(artifact.name))
      .getByRole("link", { name: "Verify", exact: true })
      .click();
    await expect(page).toHaveURL((u) => u.pathname === verifyPath(artifact.cid));
    await ready(page, "data-verify");
    await expect(page.locator("[data-lane]")).toHaveCount(3);
    await checkpoint(page, "006", 2);
    // 3–5. Every lane finishes ✓ with the manifest's size and digest.
    await expectVerified(page, artifact.cid, artifact.size, artifact.sha256);
    await checkpoint(page, "006", 5, { fullPage: true });
  });

  test(scenario("018"), async ({ page, oracle }) => {
    const dir = directoryArtifact(oracle.M);
    const net = recordRequests(page);
    // 1–2. The directory row.
    await page.goto(ROUTES.dataManifest);
    const section = await ready(page, "data-manifest");
    const row = section.locator(SEL.artifactRow(dir.name));
    // 3. "Verify via CAR" links to its carCid; no gateway fetch of the directory CID.
    const link = row.getByRole("link", { name: VERIFY_TEXTS.viaCar, exact: true });
    await expect(link).toBeVisible();
    expect((await link.getAttribute("href")) ?? "").toContain(dir.carCid ?? "<no carCid>");
    await expect(row.getByRole("link", { name: "Verify", exact: true })).toHaveCount(0);
    const fetched = net.requests.filter(
      (r) =>
        [PINATA(), ORBITOR(), FILEBASE()].includes(r.url.host) && r.url.pathname.includes(dir.cid),
    );
    expect(fetched.map((r) => r.url.href)).toEqual([]);
    await checkpoint(page, "018", 3);
  });

  test(scenario("019"), async ({ page, oracle }) => {
    noteBranch(oracle);
    const big = oversizedFiles(oracle.M);
    const net = recordRequests(page);
    // 1. Data · Manifest.
    await page.goto(ROUTES.dataManifest);
    const section = await ready(page, "data-manifest");
    if (big.length === 0) {
      test
        .info()
        .annotations.push({ type: "today", description: "no > 50 MB artifact in this run" });
    }
    // 2–3. Every > 50 MB file shows "Verify via CAR" and is not downloaded; every other file "Verify".
    for (const a of oracle.M.artifacts.filter((x) => x.kind !== "directory")) {
      const row = section.locator(SEL.artifactRow(a.name));
      const name = big.includes(a) ? VERIFY_TEXTS.viaCar : "Verify";
      await expect(row.getByRole("link", { name, exact: true })).toBeVisible();
    }
    for (const a of big) {
      expect(net.requests.filter((r) => r.url.href.includes(a.cid)).map((r) => r.url.href)).toEqual(
        [],
      );
    }
    await checkpoint(page, "019", 3, { fullPage: true });
  });

  test(scenario("020"), async ({ page, browser, oracle }) => {
    test.setTimeout(420_000);
    const artifact = verifyFileArtifact(oracle.M);
    const pinataUrl = laneUrl("pinata", artifact.cid);
    // 1. Pinata answers a readable 429 (CORS, no Retry-After) twice, then passes through.
    let pinataTries = 0;
    const pinataTimes = requestTimes(page, pinataUrl);
    await page.route(`${pinataUrl}*`, async (route: Route) => {
      pinataTries += 1;
      if (pinataTries <= 2) {
        await route.fulfill({
          status: 429,
          headers: { "access-control-allow-origin": "*" },
          body: "",
        });
      } else await route.fallback();
    });
    // 2. Verify the file artifact.
    await page.goto(verifyPath(artifact.cid));
    await settled(page, "data-verify");
    // 3. "rate-limited, retrying" and no ✓ while it retries.
    const pinata = page.locator(SEL.lane("pinata"));
    await expect(pinata).toContainText(VERIFY_TEXTS.rateLimited, { timeout: 30_000 });
    await expect(pinata.getByText("✓")).toHaveCount(0);
    await checkpoint(page, "020", 3);
    // 5. ✓ with the manifest digest.
    await expect(pinata).toHaveAttribute("data-state", "verified", { timeout: LANES_DONE_MS });
    await expect(pinata.locator("[data-got-sha256]")).toHaveAttribute(
      "data-value",
      artifact.sha256,
    );
    // 4. Waits about 2 s then 4 s (±0.5 s).
    const [g1, g2] = gaps(pinataTimes);
    expect(g1 ?? 0).toBeGreaterThanOrEqual(1_500);
    expect(g1 ?? 0).toBeLessThanOrEqual(2_500);
    expect(g2 ?? 0).toBeGreaterThanOrEqual(3_500);
    expect(g2 ?? 0).toBeLessThanOrEqual(4_500);
    await checkpoint(page, "020", 5);

    // 6. Filebase aborted (unreadable) for the first 2 tries → the other retry text, then ✓.
    const filebaseUrl = laneUrl("filebase", artifact.cid);
    const page2 = await (await browser.newContext()).newPage();
    let filebaseTries = 0;
    await page2.route(`${filebaseUrl}*`, async (route: Route) => {
      filebaseTries += 1;
      if (filebaseTries <= 2) await route.abort("failed");
      else await route.fallback();
    });
    await page2.goto(verifyPath(artifact.cid));
    const filebase = page2.locator(SEL.lane("filebase"));
    await expect(filebase).toContainText(VERIFY_TEXTS.noReadableResponse, { timeout: 30_000 });
    await expect(filebase.getByText("✓")).toHaveCount(0);
    await checkpoint(page2, "020", 6);
    await expect(filebase).toHaveAttribute("data-state", "verified", { timeout: LANES_DONE_MS });
    await page2.context().close();

    // 7. Pinata 429 every time → stops failed after its tries, no ✓, no digest, the reason line;
    //    Filebase matches but is not counted, so the page result is not_verified.
    const page3 = await (await browser.newContext()).newPage();
    let alwaysTries = 0;
    await page3.route(`${pinataUrl}*`, async (route: Route) => {
      alwaysTries += 1;
      await route.fulfill({
        status: 429,
        headers: { "access-control-allow-origin": "*" },
        body: "",
      });
    });
    await page3.goto(verifyPath(artifact.cid));
    const failed = page3.locator(SEL.lane("pinata"));
    await expect(failed).toHaveAttribute("data-state", "failed", { timeout: LANES_DONE_MS });
    await expect(failed.getByText("✓")).toHaveCount(0);
    await expect(failed.locator("[data-got-sha256]")).toHaveCount(0);
    expect(alwaysTries).toBeGreaterThanOrEqual(3);
    expect(alwaysTries).toBeLessThanOrEqual(4);
    await expect(failed.locator("[data-lane-reason]")).toHaveText(
      `${VERIFY_TEXTS.laneGaveUp} · ${VERIFY_TEXTS.pinataGaveUp}`,
    );
    await expect(page3.locator(SEL.lane("filebase"))).toHaveAttribute("data-state", "verified", {
      timeout: LANES_DONE_MS,
    });
    await expect(page3.locator(SEL.verifyResult)).toHaveAttribute(
      "data-verify-result",
      "not_verified",
      { timeout: LANES_DONE_MS },
    );
    await checkpoint(page3, "020", 7);
    await page3.context().close();
  });

  test(scenario("021"), async ({ page, oracle }) => {
    const artifact = verifyFileArtifact(oracle.M);
    let flippedSha = "";
    // 1. Filebase returns the real bytes with the last byte flipped.
    await page.route(`${laneUrl("filebase", artifact.cid)}*`, async (route: Route) => {
      const res = await route.fetch();
      const flipped = flipLastByte(new Uint8Array(await res.body()));
      flippedSha = sha256Hex(flipped);
      await route.fulfill({ response: res, body: Buffer.from(flipped) });
    });
    // 2. Verify.
    await page.goto(verifyPath(artifact.cid));
    await settled(page, "data-verify");
    // 3. Filebase lane: mismatch with both digests; Pinata and orbitor ✓, so the page result
    //    stays verified (Filebase is not counted).
    const lane = page.locator(SEL.lane("filebase"));
    await expect(lane).toHaveAttribute("data-state", "mismatch", { timeout: LANES_DONE_MS });
    await expect(lane.getByText("✓")).toHaveCount(0);
    await expect(lane.locator("[data-got-sha256]")).toHaveAttribute("data-value", flippedSha);
    await expect(lane.locator("[data-expected-sha256]")).toHaveAttribute(
      "data-value",
      artifact.sha256,
    );
    expect(flippedSha).not.toBe(artifact.sha256);
    await expect(lane).toContainText(
      VERIFY_TEXTS.mismatch(
        { size: artifact.size, sha256: flippedSha },
        { size: artifact.size, sha256: artifact.sha256 },
      ),
    );
    for (const gw of ["pinata", "orbitor"] as const) {
      await expect(page.locator(SEL.lane(gw))).toHaveAttribute("data-state", "verified", {
        timeout: LANES_DONE_MS,
      });
    }
    await expect(page.locator(SEL.verifyResult)).toHaveAttribute("data-verify-result", "verified");
    await checkpoint(page, "021", 3);
  });

  test(scenario("022"), async ({ page, oracle }) => {
    const artifact = verifyFileArtifact(oracle.M);
    // 1. Record every request of the page context.
    const seen: Request[] = [];
    page.on("request", (r) => {
      if (r.url().includes(artifact.cid)) seen.push(r);
    });
    // 2. Verify; wait for every lane.
    await page.goto(verifyPath(artifact.cid));
    await settled(page, "data-verify");
    for (const gw of ["pinata", "orbitor", "filebase"] as const) {
      await expect(page.locator(SEL.lane(gw))).not.toHaveAttribute(
        "data-state",
        /idle|fetching|retrying/,
        {
          timeout: LANES_DONE_MS,
        },
      );
    }
    await checkpoint(page, "022", 2);
    // 3. Only Pinata, orbitor and Filebase; plain GET, no Range, no custom header, no cookie, no preflight.
    const site = new URL(page.url()).host;
    const gatewayRequests = seen.filter((r) => new URL(r.url()).host !== site);
    expect(gatewayRequests.length).toBeGreaterThan(0);
    const copyHost = harnessConfig().CID_COPY_HOST;
    for (const r of gatewayRequests) {
      const host = new URL(r.url()).host;
      expect([PINATA(), ORBITOR(), FILEBASE()], r.url()).toContain(host);
      expect(FORBIDDEN_HOSTS).not.toContain(host);
      if (copyHost !== undefined) expect(host).not.toBe(copyHost);
      expect(r.method(), r.url()).toBe("GET");
      const headers = await r.allHeaders();
      const names = Object.keys(headers).map((h) => h.toLowerCase());
      expect(names).not.toContain("range");
      expect(names).not.toContain("cookie");
      expect(names).not.toContain("authorization");
      expect(names.filter((h) => h.startsWith("x-"))).toEqual([]);
    }
    expect(seen.filter((r) => r.method() === "OPTIONS").map((r) => r.url())).toEqual([]);
  });

  test(scenario("023"), async ({ page, oracle }) => {
    const artifact = verifyFileArtifact(oracle.M);
    const aborted = new Map<string, number>();
    // "No request reached the aborted host again after the first failure per file" holds within
    // one page load (each navigation starts the app afresh, so a file read by three pages is
    // legitimately tried once per page): check and reset the counters after every page.
    const assertOncePerFile = (pageName: string): void => {
      for (const [path, count] of aborted)
        expect(count, `${pageName}: copy requests for ${path}`).toBeLessThanOrEqual(1);
      aborted.clear();
    };
    // 1. Every request to the CID copy aborts.
    await page.route(
      (url) => isCidCopy(url, oracle, new URL(runtimeUrl()).host),
      async (route: Route) => {
        const key = new URL(route.request().url()).pathname;
        aborted.set(key, (aborted.get(key) ?? 0) + 1);
        await route.abort("failed");
      },
    );
    // 2–3. Runs renders with the fallback label.
    await page.goto(ROUTES.runs);
    await ready(page, "runs");
    await expect(page.getByRole("heading", { level: 2, name: oracle.M.runId })).toBeVisible();
    await expect(page.getByText(fallbackText(FILEBASE()), { exact: true }).first()).toBeVisible();
    await checkpoint(page, "023", 3);
    assertOncePerFile("Runs");
    // 4. (The SQL count step was removed with the Explore SQL tab, PO decision 2026-10-26.)
    // 5. Verify unchanged: two ✓ lanes.
    await page.goto(verifyPath(artifact.cid));
    await expectVerified(page, artifact.cid, artifact.size, artifact.sha256);
    await checkpoint(page, "023", 5);
    assertOncePerFile("Verify");
  });

  test(scenario("024"), async ({ page, oracle }) => {
    // 1. Data · Manifest (clipboard permission is granted by the config).
    await page.goto(ROUTES.dataManifest);
    const section = await ready(page, "data-manifest");
    const latest = section.locator(SEL.chainEntry).first();
    await expect(latest).toHaveAttribute("data-cid", oracle.manifestCid);
    await latest.getByRole("button", { name: "Copy CID", exact: true }).first().click(); // the entry's own CID; the second button copies its previous manifest
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(oracle.manifestCid);
    await checkpoint(page, "024", 3);
    // 4. Verify → the lanes for the manifest file.
    await latest.getByRole("link", { name: "Verify", exact: true }).click();
    await expect(page).toHaveURL((u) => u.pathname === verifyPath(oracle.manifestCid));
    await expectVerified(
      page,
      oracle.manifestCid,
      oracle.manifestBytes.byteLength,
      sha256Hex(oracle.manifestBytes),
    );
    await checkpoint(page, "024", 4);
  });
});
