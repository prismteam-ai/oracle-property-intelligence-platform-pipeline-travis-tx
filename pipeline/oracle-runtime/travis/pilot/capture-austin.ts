// T045: the fixed Austin pilot slice (PO decision D-3) and one GET per permit
// (county-permit-adapter source rules, oracle § A.1 step 1 and § B).
//
// Slices, all carrying the profile's include predicate (toSoqlInclude(), passed in; no
// classification term is written in this file):
//   september   issued 2026-09-01 … 2026-09-30                                    (42)
//   expired     status_current='Expired' AND permittype='BP' AND tcad_id IS NOT NULL,
//               ORDER BY issue_date DESC, permit_number LIMIT 5                    (5)
//   older_final the same rule on status_current='Final', issued before 2025-10-20,
//               LIMIT 3                                                            (3)
// A slice count that differs from D-3 stops the run before any permit is captured.
//
// Source rules: every request goes through travis/lib/source-client.ts (identified
// User-Agent, backoff only on 429/5xx, StopOnBlocked) with no Socrata app token, and a
// pacer keeps at most one request per second to the host, retries included. A 403 or a
// challenge writes a `blocked` receipt and stops; no other identity is ever tried.
//
// Files under outDir: <safe permit>.json (the exact response body), receipts.jsonl (one
// receipt per permit GET), slice-receipts.jsonl (the three slice queries) and slice.json.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  createSourceClient,
  type CaptureReceipt,
  type FetchLike,
  type SourceClientOptions,
} from "../lib/source-client.js";

export const AUSTIN_DATASET_URL = "https://data.austintexas.gov/resource/3syk-w9eu.json";

/** Minimum gap between two requests to the Austin host (≤ 1 request/s). */
export const MIN_REQUEST_GAP_MS = 1_000;

export type SliceName = "september" | "expired" | "older_final";

export const D3_EXPECTED_COUNTS: Readonly<Record<SliceName, number>> = Object.freeze({
  september: 42,
  expired: 5,
  older_final: 3,
});

export interface SliceQuery {
  slice: SliceName;
  params: { $where: string; $order: string; $limit: string };
}

/** The three D-3 slice queries, in order. `include` is the profile's toSoqlInclude(). */
export function buildSliceQueries(input: { include: string }): SliceQuery[] {
  const inc = input.include;
  const bpRule = (status: string): string =>
    `${inc} AND status_current='${status}' AND permittype='BP' AND tcad_id IS NOT NULL`;
  return [
    {
      slice: "september",
      params: {
        $where: `${inc} AND issue_date >= '2026-09-01T00:00:00' AND issue_date < '2026-10-01T00:00:00'`,
        $order: "permit_number",
        // Larger than the expected 42 so a drifted count is seen, not truncated.
        $limit: "1000",
      },
    },
    {
      slice: "expired",
      params: { $where: bpRule("Expired"), $order: "issue_date DESC, permit_number", $limit: "5" },
    },
    {
      slice: "older_final",
      params: {
        $where: `${bpRule("Final")} AND issue_date < '2025-10-20T00:00:00'`,
        $order: "issue_date DESC, permit_number",
        $limit: "3",
      },
    },
  ];
}

/** The slice query URL. It selects only the key and the Socrata row watermark. */
export function sliceUrl(q: SliceQuery): string {
  const search = new URLSearchParams({ $select: "permit_number, :updated_at", ...q.params });
  return `${AUSTIN_DATASET_URL}?${search.toString()}`;
}

export function permitUrl(permitNumber: string): string {
  return `${AUSTIN_DATASET_URL}?permit_number=${encodeURIComponent(permitNumber)}`;
}

/** File-name-safe form of a permit number (`2026-034767 BP` → `2026-034767_BP`). */
export function safePermitName(permitNumber: string): string {
  return permitNumber.replace(/[^A-Za-z0-9_-]/g, "_");
}

const Row = z
  .object({ permit_number: z.string().min(1), ":updated_at": z.string().optional() })
  .loose();
const Rows = z.array(Row);

export interface PermitReceipt {
  permit_number: string;
  slice: SliceName;
  url: string;
  method: "GET";
  multiValueQueryString: { permit_number: [string] };
  status: number | null;
  bytes: number;
  sha256: string;
  captured_at: string;
  outcome: CaptureReceipt["outcome"];
  user_agent: string;
  attempts: number;
  app_token_used: boolean;
  blocked_reason: CaptureReceipt["blocked_reason"];
  /** The body file, relative to outDir (ok receipts only). */
  file?: string;
  error?: string;
}

export interface CaptureAustinOptions {
  include: string;
  outDir: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: SourceClientOptions["log"];
  expectedCounts?: Readonly<Record<SliceName, number>>;
}

export interface CaptureAustinResult {
  status: "ok" | "blocked" | "failed";
  reason?: string;
  slices: Record<SliceName, string[]>;
  /** Every permit number in capture order (september, expired, older_final). */
  permits: string[];
  receipts: PermitReceipt[];
}

/** A fetch that waits until MIN_REQUEST_GAP_MS has passed since the previous call. */
function pacedFetch(
  inner: FetchLike,
  now: () => Date,
  sleep: (ms: number) => Promise<void>,
): FetchLike {
  let last: number | null = null;
  return async (url, init) => {
    if (last !== null) {
      const wait = last + MIN_REQUEST_GAP_MS - now().getTime();
      if (wait > 0) await sleep(wait);
    }
    last = now().getTime();
    return inner(url, init);
  };
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function captureAustin(options: CaptureAustinOptions): Promise<CaptureAustinResult> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? realSleep;
  const inner: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const expected = options.expectedCounts ?? D3_EXPECTED_COUNTS;
  const client = createSourceClient({
    fetch: pacedFetch(inner, now, sleep),
    sleep,
    now,
    // No Socrata app token, whatever the environment holds.
    appToken: "",
    ...(options.log ? { log: options.log } : {}),
  });
  mkdirSync(options.outDir, { recursive: true });
  const receiptsPath = join(options.outDir, "receipts.jsonl");
  const sliceReceiptsPath = join(options.outDir, "slice-receipts.jsonl");
  writeFileSync(receiptsPath, "");
  writeFileSync(sliceReceiptsPath, "");

  const slices: Record<SliceName, string[]> = { september: [], expired: [], older_final: [] };
  const receipts: PermitReceipt[] = [];
  const queries = buildSliceQueries({ include: options.include });
  const sliceRecords: Array<{
    slice: SliceName;
    url: string;
    params: SliceQuery["params"];
    expected: number;
    count: number | null;
    /** Max Socrata `:updated_at` of the slice rows (the source watermark). */
    max_updated_at: string | null;
    sha256: string;
    captured_at: string;
    outcome: string;
  }> = [];
  const writeSliceJson = (status: CaptureAustinResult["status"], reason?: string): void => {
    writeFileSync(
      join(options.outDir, "slice.json"),
      `${JSON.stringify({ dataset: AUSTIN_DATASET_URL, status, reason: reason ?? null, slices: sliceRecords, permits: slices }, null, 2)}\n`,
    );
  };
  const finish = (status: CaptureAustinResult["status"], reason?: string): CaptureAustinResult => {
    writeSliceJson(status, reason);
    const permits = [...slices.september, ...slices.expired, ...slices.older_final];
    return { status, ...(reason !== undefined ? { reason } : {}), slices, permits, receipts };
  };

  for (const q of queries) {
    const url = sliceUrl(q);
    const { receipt, data } = await client.capture({
      url,
      schema: Rows,
      accept: "application/json",
    });
    appendFileSync(sliceReceiptsPath, `${JSON.stringify({ slice: q.slice, ...receipt })}\n`);
    const count = data?.length ?? null;
    const stamps = (data ?? []).map((r) => r[":updated_at"]).filter((v): v is string => !!v);
    sliceRecords.push({
      slice: q.slice,
      url,
      params: q.params,
      expected: expected[q.slice],
      count,
      max_updated_at: stamps.length > 0 ? (stamps.sort().at(-1) as string) : null,
      sha256: receipt.sha256,
      captured_at: receipt.captured_at,
      outcome: receipt.outcome,
    });
    if (receipt.outcome === "blocked") {
      return finish(
        "blocked",
        `${q.slice} slice query blocked (${receipt.blocked_reason}, status ${receipt.status ?? "none"})`,
      );
    }
    if (data === null) {
      return finish("failed", `${q.slice} slice query failed (status ${receipt.status ?? "none"})`);
    }
    if (data.length !== expected[q.slice]) {
      return finish(
        "failed",
        `${q.slice} slice has ${data.length} permits; D-3 expects ${expected[q.slice]}`,
      );
    }
    slices[q.slice] = data.map((r) => r.permit_number);
  }

  const all = [...slices.september, ...slices.expired, ...slices.older_final];
  if (new Set(all).size !== all.length) return finish("failed", "a permit appears in two slices");

  for (const slice of ["september", "expired", "older_final"] as const) {
    for (const n of slices[slice]) {
      const url = permitUrl(n);
      const One = Rows.refine(
        (rows) => rows.length === 1 && rows[0]?.permit_number === n,
        "expected exactly the requested permit",
      );
      const { receipt, body } = await client.capture({
        url,
        schema: One,
        accept: "application/json",
      });
      const r: PermitReceipt = {
        permit_number: n,
        slice,
        url,
        method: "GET",
        multiValueQueryString: { permit_number: [n] },
        status: receipt.status,
        bytes: receipt.bytes,
        sha256: receipt.sha256,
        captured_at: receipt.captured_at,
        outcome: receipt.outcome,
        user_agent: receipt.user_agent,
        attempts: receipt.attempts,
        app_token_used: receipt.app_token_used,
        blocked_reason: receipt.blocked_reason,
      };
      if (receipt.error !== undefined) r.error = receipt.error;
      const ok = receipt.outcome === "ok" || receipt.outcome === "throttled-then-ok";
      if (ok) {
        const file = `${safePermitName(n)}.json`;
        writeFileSync(join(options.outDir, file), body);
        r.file = file;
      }
      receipts.push(r);
      appendFileSync(receiptsPath, `${JSON.stringify(r)}\n`);
      if (receipt.outcome === "blocked") {
        return finish(
          "blocked",
          `permit ${n} blocked (${receipt.blocked_reason}, status ${receipt.status ?? "none"})`,
        );
      }
      if (!ok)
        return finish("failed", `permit ${n} capture failed (status ${receipt.status ?? "none"})`);
    }
  }
  return finish("ok");
}
