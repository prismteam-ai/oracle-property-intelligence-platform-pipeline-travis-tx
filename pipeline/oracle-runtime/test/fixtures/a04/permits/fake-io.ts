// SYNTHETIC TEST INPUT (test-only). A journaling stand-in for the Restate workflow context
// and an in-memory stand-in for the Loader `permits` track. The fake Loader applies the same
// pure planner (keyset-diff.ts) the real track uses, so the workflow can be exercised end to
// end without Restate or the Query DB.
import { contentDigest } from "../../../../travis/permits/content-digest.js";
import {
  diffKeySets,
  planPageMerge,
  type CurrentRow,
  type KeyRow,
} from "../../../../travis/permits/keyset-diff.js";
import { readKeys, type PermitsIO } from "../../../../travis/permits/workflow.js";
import { PermitsMergeInput, type MergeReply } from "../../../../travis/permits/merge-input.js";
import { AUSTIN_PAGES } from "../../../../travis/adapters/socrata/austin-3syk-w9eu.js";
import { readPage } from "../../../../travis/adapters/socrata/socrata-pages.js";

class Terminal extends Error {
  override name = "TerminalError";
}

type Entry = { ok: true; value: unknown } | { ok: false; message: string };

export interface FakeIO extends PermitsIO {
  journal: Map<string, Entry>;
  /** Every completed `run` step value in order (first execution only). */
  steps: { name: string; value: unknown }[];
  merges: { name: string; input: unknown }[];
  /** Every durable sleep requested (never actually waited). */
  sleeps: number[];
}

export function fakeIO(
  loader: FakeLoader,
  opts: { start?: string; kill?: (name: string) => boolean; journal?: Map<string, Entry> } = {},
): FakeIO {
  const journal = opts.journal ?? new Map<string, Entry>();
  let t = Date.parse(opts.start ?? "2026-10-22T03:00:00.000Z");
  const steps: FakeIO["steps"] = [];
  const merges: FakeIO["merges"] = [];
  const sleeps: number[] = [];
  const replay = (name: string): unknown => {
    const e = journal.get(name);
    if (e === undefined) return undefined;
    if (!e.ok) throw new Terminal(e.message);
    return structuredClone(e.value);
  };
  return {
    journal,
    steps,
    merges,
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    now: async () => {
      const key = `now#${[...journal.keys()].filter((k) => k.startsWith("now#")).length}`;
      if (journal.has(key)) return new Date(replay(key) as string);
      t += 1_000;
      const iso = new Date(t).toISOString();
      journal.set(key, { ok: true, value: iso });
      return new Date(iso);
    },
    async run<T>(name: string, fn: () => Promise<T>): Promise<T> {
      if (journal.has(name)) return replay(name) as T;
      let value: T;
      try {
        value = await fn();
      } catch (error) {
        if (error instanceof Terminal) {
          journal.set(name, { ok: false, message: error.message });
        }
        throw error;
      }
      if (opts.kill?.(name)) throw new Error(`synthetic kill during ${name}`);
      const stored = JSON.parse(JSON.stringify(value)) as T;
      journal.set(name, { ok: true, value: stored });
      steps.push({ name, value: stored });
      return stored;
    },
    async merge(name, input) {
      const key = `merge:${name}`;
      if (journal.has(key)) return replay(key) as MergeReply;
      merges.push({ name, input });
      const reply = loader.merge(input);
      journal.set(key, { ok: true, value: reply });
      return reply;
    },
    fail: (message) => new Terminal(message),
  };
}

export interface StoredCurrent extends CurrentRow {
  previousContentSha256: string | null;
  updatedInJob: string;
  tombstoned: boolean;
}

/** In-memory Loader `permits` track (synthetic stand-in for Postgres). */
export class FakeLoader {
  readonly merged = new Set<string>();
  readonly sourceRows = new Map<string, KeyRow & { contentSha256: string; jobId: string }>();
  readonly current = new Map<string, StoredCurrent>();
  readonly tombstones: { rowKey: string; permitNumber: string; reason: string; jobId: string }[] =
    [];
  readonly limitations: { jobId: string; code: string; text: string }[] = [];
  readonly runs = new Map<string, { status: string; mode: string }>();
  watermark: Record<string, unknown> | null = null;
  pageWrites: { pageIndex: number; written: number }[] = [];

  merge(raw: unknown): MergeReply {
    const input = PermitsMergeInput.parse(raw);
    const reply = (rowsWritten: number, tombstones = 0, skipped = false): MergeReply => ({
      track: "permits",
      artifactSha256: input.artifactSha256,
      skipped,
      rowsWritten,
      tombstones,
    });
    if (this.merged.has(input.artifactSha256)) return reply(0, 0, true);
    this.merged.add(input.artifactSha256);
    switch (input.kind) {
      case "run_start":
        this.runs.set(input.jobId, { status: "running", mode: input.mode });
        return reply(1);
      case "page": {
        const rows = readPage(input.artifactPath, input.artifactSha256);
        const incoming = rows.map((r) => ({
          rowId: r[":id"],
          permitNumber: r.permit_number,
          contentSha256: contentDigest(r, AUSTIN_PAGES.volatileFields),
          updatedAt: typeof r[":updated_at"] === "string" ? (r[":updated_at"] as string) : null,
          payload: r as Record<string, unknown>,
        }));
        const plan = planPageMerge(this.current, incoming);
        for (const r of incoming) {
          this.sourceRows.set(r.rowId, {
            rowId: r.rowId,
            permitNumber: r.permitNumber,
            contentSha256: r.contentSha256,
            jobId: input.jobId,
          });
        }
        for (const u of plan.upserts) {
          this.current.set(u.row.permitNumber, {
            permitNumber: u.row.permitNumber,
            rowId: u.row.rowId,
            contentSha256: u.row.contentSha256,
            payload: u.row.payload,
            previousContentSha256: u.previousContentSha256,
            updatedInJob: input.jobId,
            tombstoned: false,
          });
        }
        this.pageWrites.push({ pageIndex: input.pageIndex, written: plan.upserts.length });
        return reply(plan.upserts.length);
      }
      case "finalize": {
        let tombstones = 0;
        if (input.keys !== null) {
          const seen = readKeys(input.keys.path, input.keys.sha256);
          const diff = diffKeySets([...this.sourceRows.values()], seen);
          for (const r of diff.removed) {
            this.tombstones.push({
              rowKey: r.rowId,
              permitNumber: r.permitNumber,
              reason: "source_removed",
              jobId: input.jobId,
            });
            const cur = this.current.get(r.permitNumber);
            if (cur) cur.tombstoned = true;
            tombstones += 1;
          }
        }
        for (const l of input.limitations) {
          this.limitations.push({ jobId: input.jobId, code: l.code, text: l.text });
        }
        if (input.watermark !== null) this.watermark = input.watermark;
        this.runs.set(input.jobId, { status: "complete", mode: input.mode });
        return reply(0, tombstones);
      }
      case "stop":
        this.runs.set(input.jobId, { status: input.status, mode: input.mode });
        return reply(0);
      case "link":
        return reply(0);
    }
  }
}
