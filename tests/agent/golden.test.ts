// T020 (A-14, agent-design.md § 6.2-6.3, ../../../assessment-guide/reference/checks.md § 7.1-7.2):
// the Vitest driver for golden.json, run against the deployed `agent.ask` HTTP contract.
//
// This is written against `agent.ask` *before it exists* (ash's apps/api/src/agent/ask.ts is
// built concurrently this wave, in a different builder group — see tasks.md T022). That is
// expected TDD red state, not a bug: with AGENT_URL unset, every case here is skipped with a
// clear, explicit report instead of silently passing or erroring the whole suite, so
// `pnpm test` stays green for wave 2's checkpoint while still documenting exactly what will run
// once the endpoint is deployed (constitution I: localhost/unset is never evidence, so this file
// refuses to default AGENT_URL to a local address).
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import {
  bindManifest,
  listPermits,
  rawCid,
  type BoundRun,
  type ListPermitsInput,
  type QueryEngine,
  type Row,
} from "@countylens/query-core";
import { openDuckDb } from "../../packages/query-core/scripts/duckdb-engine.js";
import {
  checkBudget,
  checkCorrectness,
  checkGroundedness,
  checkHonesty,
  isEmptyReasonInconclusive,
  checkOutOfScope,
  checkRecall,
  isVacuous,
  runOracle,
  type AgentAskResponse,
  type OracleCall,
} from "./grader.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(HERE, "golden.json");

interface GoldenExpect {
  must_mention?: string[];
  must_flag_missing?: string[];
  empty_reason?: string | null;
  matches_length?: number;
  must_not_contain_cid?: boolean;
  oracle: OracleCall;
}

interface GoldenCase {
  id: string;
  turns: Array<{ prompt: string }>;
  expect: GoldenExpect;
}

interface GoldenFile {
  cases: GoldenCase[];
}

function loadGolden(): GoldenFile {
  return JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenFile;
}

/** The hosted agent.ask base URL, e.g. https://countylens.<domain>/api. Must be a real hosted
 *  endpoint, never localhost (constitution I) — a loopback value is treated the same as unset. */
function agentUrl(): string | null {
  const value = process.env.AGENT_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return null;
  } catch {
    return null;
  }
  return value.replace(/\/+$/, "");
}

const DEFAULT_MANIFEST_CID = "bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i";
/** The run every request is pinned to and the oracle is bound over (small published permits run). */
const MANIFEST_CID = process.env.GOLDEN_MANIFEST_CID?.trim() || DEFAULT_MANIFEST_CID;
const CID_COPY_HOST = (
  process.env.GOLDEN_CID_HOST?.trim() || "https://d2xsqoqv09bd0q.cloudfront.net"
).replace(/\/+$/, "");
const SPACING_MS = Number(process.env.GOLDEN_SPACING_MS ?? 20_000);
const REQUEST_TIMEOUT_MS = 60_000;
const RESULTS_PATH =
  process.env.GOLDEN_RESULTS_PATH?.trim() ||
  join(HERE, "../../docs/evidence/A-14-golden-results.json");

interface AskMeta {
  durationMs: number;
  requestId: string | null;
}

let lastRequestAt = 0;
async function spacedWait(): Promise<void> {
  const wait = lastRequestAt + SPACING_MS - Date.now();
  if (lastRequestAt > 0 && wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/** One `agent.ask` call: POST {baseUrl}/agent/ask (tRPC wire format: result.data, or error). */
async function askOnce(
  baseUrl: string,
  prompt: string,
  turns: Array<{ prompt: string; outcome: string }>,
): Promise<{ response: AgentAskResponse; meta: AskMeta }> {
  await spacedWait();
  const started = Date.now();
  const res = await fetch(`${baseUrl}/agent/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt,
      ...(turns.length > 0 ? { turns } : {}),
      manifest_cid: MANIFEST_CID,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const durationMs = Date.now() - started;
  lastRequestAt = Date.now();
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `agent.ask returned ${res.status} after ${durationMs} ms for "${prompt}": ${text.slice(0, 400)}`,
    );
  }
  const body = JSON.parse(text) as {
    result?: { data?: AgentAskResponse & { json?: AgentAskResponse } };
    error?: unknown;
  };
  const data = body.result?.data;
  if (!data) throw new Error(`agent.ask returned no result.data: ${text.slice(0, 400)}`);
  const response = (data.json ?? data) as AgentAskResponse;
  const requestId =
    res.headers.get("x-amzn-requestid") ??
    res.headers.get("x-amz-cf-id") ??
    res.headers.get("x-amzn-trace-id");
  return { response, meta: { durationMs, requestId } };
}

async function askAgent(
  baseUrl: string,
  turns: Array<{ prompt: string }>,
): Promise<{ response: AgentAskResponse; meta: AskMeta }> {
  let last: { response: AgentAskResponse; meta: AskMeta } | null = null;
  const history: Array<{ prompt: string; outcome: string }> = [];
  for (const turn of turns) {
    last = await askOnce(baseUrl, turn.prompt, history);
    history.push({ prompt: turn.prompt, outcome: last.response.outcome });
  }
  if (!last) throw new Error("golden case has no turns");
  return last;
}

/** GET `<host>/ipfs/<cid>` with a few retries (public gateways rate-limit); bytes are verified
 *  against their raw-leaves CIDv1 before use. */
async function fetchVerified(cid: string): Promise<Uint8Array> {
  let lastError = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${CID_COPY_HOST}/ipfs/${cid}`, {
      signal: AbortSignal.timeout(30_000),
    }).catch((e: unknown) => String(e));
    if (typeof res !== "string" && res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if ((await rawCid(bytes)) === cid) return bytes;
      lastError = "CID mismatch";
    } else {
      lastError = typeof res === "string" ? res : `HTTP ${res.status}`;
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`fetch ${cid} from ${CID_COPY_HOST} failed: ${lastError}`);
}

/** Downloads the pinned run's manifest and table parts (CID-verified, a few KB each) into a temp
 *  directory and binds them in a local DuckDB: the oracle's engine, never the hosted agent. */
async function bindPinnedRun(): Promise<{
  engine: QueryEngine & { close(): void };
  bound: BoundRun;
}> {
  const manifestBytes = await fetchVerified(MANIFEST_CID);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
    artifacts: Array<{ kind: string; name: string; cid: string }>;
  };
  const dir = mkdtempSync(join(tmpdir(), "golden-run-"));
  const local = new Map<string, string>();
  for (const artifact of manifest.artifacts.filter((a) => a.kind === "table")) {
    const file = join(dir, artifact.cid);
    writeFileSync(file, await fetchVerified(artifact.cid));
    local.set(artifact.cid, file);
  }
  const engine = await openDuckDb();
  const bound = await bindManifest(manifestBytes, dir, engine, {
    partUrl: ({ cid }) => local.get(cid) ?? join(dir, cid),
  });
  if (bound.manifestCid !== MANIFEST_CID)
    throw new Error(`bound ${bound.manifestCid}, expected ${MANIFEST_CID}`);
  return { engine, bound };
}

const escapeRe = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PERMIT_PLACEHOLDER = "{real permit number}";
const substitute = <T>(value: T, permit: string, asRegex: boolean): T =>
  JSON.parse(
    JSON.stringify(value)
      .split(PERMIT_PLACEHOLDER)
      .join(asRegex ? escapeRe(permit).replace(/\\/g, "\\\\") : permit),
  ) as T;

const baseUrl = agentUrl();
const golden = loadGolden();
const collected: Array<Record<string, unknown>> = [];

describe("agent.ask golden queries (T020, checks.md § 7.1, agent-design.md § 6.2)", () => {
  if (!baseUrl) {
    it.skip(
      "SKIPPED: AGENT_URL is not set to a hosted address. Set AGENT_URL=https://<host>/api " +
        "(the hosted base; the test posts to <AGENT_URL>/agent/ask) to run G1-G6.",
      () => {},
    );
    return;
  }

  let ctx: { engine: QueryEngine & { close(): void }; bound: BoundRun };
  let permitNumber = "";

  beforeAll(async () => {
    console.log(
      `golden: manifest_cid=${MANIFEST_CID} agent=${baseUrl}/agent/ask cid_host=${CID_COPY_HOST}`,
    );
    ctx = await bindPinnedRun();
    const envelope = await listPermits(ctx.engine, ctx.bound, { limit: 1 } as ListPermitsInput);
    const row = envelope.rows[0] as Row | undefined;
    permitNumber = typeof row?.permit_number === "string" ? row.permit_number : "NO-PERMIT-IN-RUN";
    console.log(`golden: G5 permit number from the bound run = ${permitNumber}`);
  }, 180_000);

  afterAll(() => {
    ctx?.engine.close();
    writeFileSync(
      RESULTS_PATH,
      JSON.stringify({ manifest_cid: MANIFEST_CID, cases: collected }, null, 2),
    );
  });

  async function exists(cid: string): Promise<boolean> {
    const rows = await ctx.engine.all(
      `SELECT cid FROM v_property WHERE cid = '${cid}' UNION ALL SELECT cid FROM v_roofing_permit WHERE cid = '${cid}'`,
    );
    return rows.length > 0;
  }

  for (const rawCase of golden.cases) {
    const lastPrompt = rawCase.turns[rawCase.turns.length - 1]?.prompt;
    it(`${rawCase.id}: ${lastPrompt}`, async () => {
      const goldenCase = substitute(rawCase, permitNumber, false);
      const expectation = substitute(rawCase.expect, permitNumber, true);
      expectation.oracle = substitute(rawCase.expect.oracle, permitNumber, false);
      const { response, meta } = await askAgent(baseUrl, goldenCase.turns);

      let oracle = await runOracle(expectation.oracle, ctx);
      const fallback = (expectation.oracle as OracleCall & { fallback?: OracleCall }).fallback;
      if (fallback && "total" in oracle && oracle.total === 0)
        oracle = await runOracle(fallback, ctx);

      const budget = checkBudget(response);
      const oracleRowCount = "rows" in oracle ? oracle.rows.length : null;
      const oracleEmptyReason =
        "empty_reason" in oracle ? (oracle.empty_reason as string | null) : null;
      const honesty = checkHonesty(response, expectation, oracleEmptyReason, oracleRowCount);
      const correctness = checkCorrectness(response, oracle);
      const recall = checkRecall(response, oracle);
      const groundedness = await checkGroundedness(response, exists);
      const outOfScope = rawCase.id === "G6" ? checkOutOfScope(response) : null;
      const matchesLengthOk =
        expectation.matches_length === undefined ||
        response.matches.length === expectation.matches_length;
      collected.push({
        id: rawCase.id,
        prompt: lastPrompt,
        ...meta,
        response,
        oracleTotal: "total" in oracle ? oracle.total : null,
        oracleRowCount,
        oracleEmptyReason,
        emptyReasonInconclusive: isEmptyReasonInconclusive(
          expectation.empty_reason,
          oracleRowCount,
          oracleEmptyReason,
        ),
        // true = the oracle found nothing, so recall/precision/groundedness pass trivially.
        vacuous: isVacuous(oracleRowCount),
        budget,
        honesty,
        correctness,
        recall,
        groundedness,
        outOfScope,
        matchesLengthOk,
      });

      expect(response.outcome, `outcome (answer: ${response.answer})`).toBe("answered");
      expect(budget.pass, `budget: ${JSON.stringify(budget)}`).toBe(true);
      if (outOfScope)
        expect(outOfScope.pass, `G6 out-of-scope: ${JSON.stringify(outOfScope)}`).toBe(true);
      expect(matchesLengthOk, `matches_length ${response.matches.length}`).toBe(true);
      expect(honesty.pass, `honesty: ${JSON.stringify(honesty)}`).toBe(true);
      expect(correctness.pass, `correctness: ${JSON.stringify(correctness)}`).toBe(true);
      expect(recall.pass, `recall: ${JSON.stringify(recall)}`).toBe(true);
      expect(groundedness.pass, `groundedness: ${JSON.stringify(groundedness)}`).toBe(true);
    }, 240_000);
  }
});
