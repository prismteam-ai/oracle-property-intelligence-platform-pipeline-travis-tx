// A-03-TC-NF-05: radius and roof-age p95 < 3 s via the Lambda DuckDB fallback over a private
// full-size copy (T061; AC-4, FR-004, FR-012, NFR-001; ADR-0001 "Lambda proof", PO decision D-4
// "Private prefix + direct invoke").
//
// 0. Step 0 (fixture `run`): open {RUNTIME_URL}/runs, read the manifest CID and runId.
// 1. Upload every part of the full Austin table split with `--part-size 48m`
//    (AUSTIN_PARQUET_DIR, default pipeline/data/raw/austin-parquet/v48m; gitignored, never
//    committed) to `{READPATH_PRIVATE_PREFIX}{TC_NF_05_BENCH_NAME}/` of the CID-copy bucket,
//    profile `assess`, region from the profile configuration.
// 2. Not public: `https://{CID_COPY_HOST}/{private key}` → 403 or 404; the public API given the
//    key → a 4xx with no data.
// 3. Direct invocations only (`aws lambda invoke` through scripts/bench-lambda.ts, never the
//    public API): one untimed warm-up, then 20 timed runs each of radius and roof-age with the
//    TC_NF_05 preset (plus the full-size COUNT, recorded), and once more with ADR_0001; timings
//    are each response's `queryDurationMs` (engine init excluded). The COUNT equals the capture
//    receipt's row count (AUSTIN_CAPTURE_SUMMARY), never a hard-coded figure.
// 4. p50 and p95 per query; radius and roof-age p95 < 3,000 ms (the hard AC-4 assertion). The
//    untimed warm-up (`warmupMs`, the first query in a fresh sandbox) is recorded beside them for
//    every query × preset: in the text summary attachment, a test annotation and a soft check
//    that it was measured. It is reported against the 3,000 ms reference, never hidden.
// 5. Delete every private object; `head-object` → 404, recorded.
// Cleanup runs even when an assertion fails, so the private copy never outlives the case.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { expect, test } from "./lib/fixtures.js";
import { cidCopyBucket, listKeys } from "./lib/aws.js";
import { NEEDS_AWS_TAG } from "./lib/needs-aws.js";
import { deleteKey, headStatus, invokeJson, putFile } from "./lib/ops.js";
import { BenchReport, CaptureSummary, LIMITS, TIMED_RUNS, nfrConfig } from "./lib/perf.js";
import { harnessConfig, repoRoot, requireCidCopyHost, runtimeUrl } from "./lib/runtime.js";
import { childEnv, run as spawnRun } from "./lib/spawn.js";

const PARQUET_CONTENT_TYPE = "application/vnd.apache.parquet";
const FIRST_QUERY_LABEL = "first query in a fresh sandbox";

interface BenchSummaryRow {
  query: string;
  preset: string;
  runs: number;
  p50Ms: number;
  p95Ms: number;
  /** The untimed warm-up invocation: the first query in a fresh sandbox. */
  firstQueryMs: number | null;
}

function summaryRows(reports: readonly BenchReport[]): BenchSummaryRow[] {
  return reports.flatMap((report) =>
    report.results.map((r) => ({
      query: r.query,
      preset: r.preset,
      runs: r.timingsMs.length,
      p50Ms: r.p50Ms,
      p95Ms: r.p95Ms,
      firstQueryMs: r.warmupMs[0] ?? null,
    })),
  );
}

function summaryText(rows: readonly BenchSummaryRow[]): string {
  const lines = rows.map(
    (r) =>
      `${r.query} ${r.preset}: p50 ${r.p50Ms} ms, p95 ${r.p95Ms} ms (${r.runs} warm runs); ${FIRST_QUERY_LABEL} ${r.firstQueryMs ?? "not measured"} ms`,
  );
  return [
    `TC-NF-05 Lambda DuckDB fallback (queryDurationMs; limit p95 < ${LIMITS.queryP95Ms} ms)`,
    ...lines,
  ].join("\n");
}

async function benchLambda(args: string[], jsonPath: string): Promise<BenchReport> {
  const testInfo = test.info();
  const config = nfrConfig();
  const result = await spawnRun(
    "npx",
    [
      "tsx",
      "scripts/bench-lambda.ts",
      "--function-name",
      config.API_FUNCTION_NAME,
      "--prefix",
      config.benchPrefix,
      "--private-prefix",
      harnessConfig().READPATH_PRIVATE_PREFIX,
      "--profile",
      "assess",
      "--runs",
      String(TIMED_RUNS),
      "--warmup",
      "1",
      "--json",
      jsonPath,
      ...args,
    ],
    { cwd: repoRoot, env: childEnv(), timeoutMs: 20 * 60_000 },
  );
  await testInfo.attach(`bench-lambda ${args.join(" ")}.log`, {
    body: `$ ${result.command}\nexit ${result.code} after ${result.durationMs} ms\n\n${result.output}`,
    contentType: "text/plain",
  });
  expect(result.code, `bench-lambda exited ${result.code}\n${result.output.slice(-2000)}`).toBe(0);
  return BenchReport.parse(JSON.parse(await readFile(jsonPath, "utf8")));
}

test.describe("A-03-TC-NF-05 radius and roof-age p95 < 3 s via Lambda DuckDB on a private full-size copy", () => {
  test.describe.configure({ timeout: 45 * 60_000 });

  test(`@scenario:A-03-TC-NF-05 ${NEEDS_AWS_TAG}`, async ({ run }, testInfo) => {
    // Step 0 is the `run` fixture; record what it read.
    await testInfo.attach("step-0.json", {
      body: JSON.stringify(
        { runtimeUrl: runtimeUrl(), runId: run.runId, manifestCid: run.manifestCid },
        null,
        2,
      ),
      contentType: "application/json",
    });

    const config = nfrConfig();
    const host = requireCidCopyHost();
    expect(
      existsSync(config.austinParquetDir),
      `full-size Parquet directory ${config.austinParquetDir} exists (set AUSTIN_PARQUET_DIR)`,
    ).toBe(true);
    expect(
      existsSync(config.austinCaptureSummary),
      `capture receipt ${config.austinCaptureSummary} exists (set AUSTIN_CAPTURE_SUMMARY)`,
    ).toBe(true);
    const receipt = CaptureSummary.parse(
      JSON.parse(readFileSync(config.austinCaptureSummary, "utf8")),
    );
    expect(receipt.total, "the capture receipt is complete (total = expected)").toBe(
      receipt.expected,
    );
    const parts = readdirSync(config.austinParquetDir)
      .filter((name) => name.endsWith(".parquet"))
      .sort();
    expect(parts.length, "the 48m split has parts").toBeGreaterThan(0);

    const bucket = await cidCopyBucket();
    const keys = parts.map((name) => `${config.benchPrefix}${name}`);
    const evidence: Record<string, unknown> = {
      source: relative(repoRoot, config.austinParquetDir),
      receipt: { total: receipt.total, expected: receipt.expected, pages: receipt.pages },
      bucket,
      prefix: config.benchPrefix,
      parts: parts.length,
    };

    try {
      // Step 1: upload.
      let bytes = 0;
      for (const [i, name] of parts.entries()) {
        const body = new Uint8Array(readFileSync(join(config.austinParquetDir, name)));
        bytes += body.length;
        await putFile(bucket, keys[i] as string, body, PARQUET_CONTENT_TYPE);
      }
      const listed = await listKeys(bucket, config.benchPrefix);
      evidence.uploaded = { keys: listed.length, bytes };
      expect(listed.sort(), "every part is under the private prefix").toEqual([...keys].sort());

      // Step 2: not public.
      const publicChecks: { url: string; status: number; bytes: number; parquet: boolean }[] = [];
      const probe = async (url: string): Promise<void> => {
        const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
        const body = new Uint8Array(await res.arrayBuffer());
        const parquet = new TextDecoder().decode(body.slice(0, 4)) === "PAR1";
        publicChecks.push({ url, status: res.status, bytes: body.length, parquet });
      };
      for (const key of [keys[0] as string, keys.at(-1) as string]) {
        await probe(`https://${host}/${key}`);
      }
      const apiInput = encodeURIComponent(JSON.stringify({ manifestCid: keys[0] }));
      await probe(`${runtimeUrl()}/api/trpc/runs.summary?input=${apiInput}`);
      await probe(`${runtimeUrl()}/api/${keys[0] as string}`);
      evidence.publicChecks = publicChecks;
      for (const check of publicChecks.slice(0, 2)) {
        expect([403, 404], `${check.url} → 403 or 404, got ${check.status}`).toContain(
          check.status,
        );
        expect(check.parquet, `${check.url} serves no Parquet bytes`).toBe(false);
      }
      const [apiCid, apiPath] = publicChecks.slice(2);
      expect(apiCid?.status, "runs.summary given the private key → 400 (not a CID)").toBe(400);
      expect(
        apiPath?.status ?? 0,
        "the API path with the private key → a 4xx",
      ).toBeGreaterThanOrEqual(400);
      expect(apiPath?.status ?? 0, "the API path with the private key → a 4xx").toBeLessThan(500);
      for (const check of publicChecks.slice(2)) {
        expect(check.parquet, `${check.url} returns no data`).toBe(false);
      }

      // Full-size COUNT equals the capture receipt (direct invoke).
      const countResponse = (await invokeJson(config.API_FUNCTION_NAME, {
        kind: "bench",
        query: "count",
        preset: "TC_NF_05",
        prefix: config.benchPrefix,
      })) as { rows?: { n?: unknown }[] };
      const counted = Number(String(countResponse.rows?.[0]?.n ?? Number.NaN));
      evidence.count = counted;
      expect(counted, "full-size COUNT equals the capture receipt's row count").toBe(receipt.total);

      // Steps 3–4: 20 timed direct invocations per query and preset.
      const tcNf05 = await benchLambda(
        ["--query", "count", "--query", "radius", "--query", "roofAge", "--preset", "TC_NF_05"],
        testInfo.outputPath("bench-TC_NF_05.json"),
      );
      const adr = await benchLambda(
        ["--query", "radius", "--query", "roofAge", "--preset", "ADR_0001"],
        testInfo.outputPath("bench-ADR_0001.json"),
      );
      evidence.bench = { TC_NF_05: tcNf05, ADR_0001: adr };
      const rows = summaryRows([tcNf05, adr]);
      evidence.summary = rows.map((r) => ({
        query: r.query,
        preset: r.preset,
        runs: r.runs,
        p50Ms: r.p50Ms,
        p95Ms: r.p95Ms,
        [FIRST_QUERY_LABEL]: r.firstQueryMs,
      }));
      await testInfo.attach("tc-nf-05-summary.txt", {
        body: summaryText(rows),
        contentType: "text/plain",
      });
      for (const r of rows) {
        const first = r.firstQueryMs;
        testInfo.annotations.push({
          type: `${r.query} ${r.preset}: ${FIRST_QUERY_LABEL}`,
          description:
            first === null
              ? "not measured"
              : `${first} ms (${first < LIMITS.queryP95Ms ? "under" : "AT OR ABOVE"} the ${LIMITS.queryP95Ms} ms reference); warm p50 ${r.p50Ms} ms, p95 ${r.p95Ms} ms`,
        });
        expect
          .soft(
            first,
            `${r.query} ${r.preset}: ${FIRST_QUERY_LABEL} measured (${first ?? "none"} ms; warm p95 ${r.p95Ms} ms)`,
          )
          .not.toBeNull();
      }
      for (const report of [tcNf05, adr]) {
        for (const r of report.results) {
          expect(r.timingsMs, `${r.query} ${r.preset}: ${TIMED_RUNS} timed runs`).toHaveLength(
            TIMED_RUNS,
          );
          expect.soft(r.coldStarts, `${r.query} ${r.preset}: every timed run warm`).toBe(0);
          if (r.query === "count") continue; // recorded (plan § Read-path scope), not an AC-4 limit
          expect
            .soft(
              r.p95Ms,
              `${r.query} ${r.preset}: p95 < ${LIMITS.queryP95Ms} ms (p50 ${r.p50Ms} ms)`,
            )
            .toBeLessThan(LIMITS.queryP95Ms);
        }
      }
      for (const query of ["radius", "roofAge"] as const) {
        const r = tcNf05.results.find((x) => x.query === query);
        expect(r, `${query} TC_NF_05 measured`).toBeDefined();
        expect(
          r?.p95Ms ?? Number.POSITIVE_INFINITY,
          `${query} TC_NF_05 p95 < ${LIMITS.queryP95Ms} ms`,
        ).toBeLessThan(LIMITS.queryP95Ms);
      }
    } finally {
      // Step 5: delete and prove the deletion (always, whatever failed above).
      const deletion: { key: string; headStatus: number }[] = [];
      for (const key of keys) {
        await deleteKey(bucket, key);
        deletion.push({ key, headStatus: await headStatus(bucket, key) });
      }
      const left = await listKeys(bucket, config.benchPrefix);
      evidence.deletion = { at: new Date().toISOString(), headObject: deletion, keysLeft: left };
      await testInfo.attach("tc-nf-05-evidence.json", {
        body: JSON.stringify(evidence, null, 2),
        contentType: "application/json",
      });
      for (const d of deletion)
        expect(d.headStatus, `head-object ${d.key} → 404 after delete`).toBe(404);
      expect(left, "nothing left under the private prefix").toEqual([]);
    }
  });
});
