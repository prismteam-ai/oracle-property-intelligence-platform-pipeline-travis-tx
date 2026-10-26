// A-13 web vitals (T043; testplans/A-13-test-cases.md § 8): TC-058 (Runs · Log LCP) and TC-081 (LCP, CLS and
// INP on mobile 4G for the eight content pages). Lighthouse itself is not installed in this repo; the cases use
// the plan's Lighthouse mobile profile through CDP (150 ms RTT, 1.6 Mbps, 4x CPU, 390 px; lib/a13-vitals.ts)
// with PerformanceObservers, median of five loads per page. Every run is saved to docs/evidence/A-13-pages.md.
// TC-082 (initial JS size) lives in A-13-perf.spec.ts.
import { ROUTES } from "@countylens/shared";
import { writeEvidenceSection } from "./lib/a13-evidence.js";
import { PARKED_GAPS, expect, noteBranch, parkGap, test } from "./lib/a13-fixtures.js";
import { median } from "./lib/a13-routes.js";
import { scenario } from "./lib/a13-ui.js";
import {
  LIMITS_VITALS,
  MOBILE_PROFILE,
  RUNS_PER_PAGE,
  mainControlReason,
  measureInp,
  measurePage,
} from "./lib/a13-vitals.js";
import { runtimeUrl } from "./lib/runtime.js";

const absolute = (path: string): string => `${runtimeUrl()}${path}`;
const profile = `Lighthouse mobile profile: ${MOBILE_PROFILE.rttMs} ms RTT, 1.6 Mbps, ${MOBILE_PROFILE.cpuSlowdown}x CPU, ${MOBILE_PROFILE.viewport.width} px, median of ${RUNS_PER_PAGE}`;

test.describe("A-13 vitals", { tag: "@a13-vitals" }, () => {
  test.describe.configure({ mode: "serial" });

  test(scenario("058"), async ({ browser, oracle }) => {
    test.setTimeout(15 * 60_000);
    noteBranch(oracle, `${oracle.runs.length} run(s); provisional below 3`);
    // 1. Lighthouse-profile loads of /runs/log (five, at least three required).
    const result = await measurePage(browser, absolute(ROUTES.runsLog));
    writeEvidenceSection(
      "A-13-TC-058",
      [
        `## TC-058 Runs · Log on mobile 4G (${profile}; ${oracle.runs.length} published run(s)${oracle.runs.length < 3 ? ", provisional until A-11" : ""})`,
        "",
        "| run | LCP ms | CLS |",
        "| --- | --- | --- |",
        ...result.runs.map((r, i) => `| ${i + 1} | ${r.lcpMs} | ${r.cls.toFixed(3)} |`),
        `| median | ${result.medianLcpMs} | ${result.medianCls.toFixed(3)} |`,
      ].join("\n"),
    );
    expect(result.runs.length).toBeGreaterThanOrEqual(3);
    expect(result.medianLcpMs, "median LCP").toBeLessThan(LIMITS_VITALS.lcpMs);
    expect(result.medianCls, "median CLS").toBeLessThan(LIMITS_VITALS.cls);
  });

  test(scenario("081"), async ({ browser }) => {
    parkGap(PARKED_GAPS.runsLogLcp);
    test.setTimeout(60 * 60_000);
    const pages = [
      ROUTES.hub,
      ROUTES.dataCatalog,
      ROUTES.runsLog,
      ROUTES.legalData,
      ROUTES.runs,
      ROUTES.coverage,
      ROUTES.dataManifest,
      ROUTES.explore,
    ];
    const lines: string[] = [];
    const problems: string[] = [];
    for (const path of pages) {
      // 1. Median LCP and CLS of five Lighthouse-profile loads.
      const vitals = await measurePage(browser, absolute(path));
      // 2. INP: click the page's main control five times under the same throttling.
      const inp = await measureInp(browser, absolute(path), path);
      const inpMedian = inp === null ? null : median(inp);
      lines.push(
        `| ${path} | ${vitals.runs.map((r) => r.lcpMs).join(", ")} | ${vitals.medianLcpMs} | ${vitals.runs.map((r) => r.cls.toFixed(3)).join(", ")} | ${vitals.medianCls.toFixed(3)} | ${inp === null ? `n/a (${mainControlReason(path)})` : inp.join(", ")} | ${inpMedian ?? "n/a"} |`,
      );
      if (vitals.medianLcpMs >= LIMITS_VITALS.lcpMs)
        problems.push(`${path}: median LCP ${vitals.medianLcpMs} ms`);
      if (vitals.medianCls >= LIMITS_VITALS.cls)
        problems.push(`${path}: median CLS ${vitals.medianCls.toFixed(3)}`);
      if (inpMedian !== null && inpMedian >= LIMITS_VITALS.inpMs)
        problems.push(`${path}: median INP ${inpMedian} ms`);
    }
    writeEvidenceSection(
      "A-13-TC-081",
      [
        `## TC-081 LCP, CLS, INP on mobile 4G (${profile})`,
        "",
        "| page | LCP ms (runs) | median LCP | CLS (runs) | median CLS | INP ms (clicks) | median INP |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        ...lines,
      ].join("\n"),
    );
    expect(problems, "LCP < 2,500 ms, CLS < 0.1, INP < 200 ms on every page").toEqual([]);
  });
});
