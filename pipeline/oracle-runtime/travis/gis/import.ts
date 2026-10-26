// A-04 T043 (AC-11, contracts/gis-runner.md): read the US-runner artifact on the laptop,
// offline. Validates every file with Zod, checks each page's bytes against its receipt sha256,
// requires `egress.txt` = `loc=US`, and decides the import status:
//
// - `complete` only when complete.json is present (every page completed on the runner);
// - otherwise `blocked`, with the limitation exactly `gis: blocked at {ts}; coverage not
//   complete` (ts = blocked.json blocked_at, else failed.json failed_at, else the last receipt).
//   No coverage figure is ever reported complete from such an artifact.
//
// Features become one row each (IDs, area, one point by points.ts). No network, no Query DB:
// the Loader `gis` track writes the rows (pipeline/local-stack/services/tracks/gis.ts).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { z } from "zod";
import { featurePoint, type PointMethod } from "./points.js";

export const GIS_SOURCE_KEY = "tcad_gis";

export const gisBlockedLimitation = (ts: string): string =>
  `gis: blocked at ${ts}; coverage not complete`;

const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

const Receipt = z
  .object({
    url: z.string().url(),
    http_status: z.number().int().nullable(),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    captured_at: z.string(),
    outcome: z.enum(["ok", "blocked", "error", "skipped_checkpoint"]),
    attempts: z.number().int().nonnegative(),
    ua: z.string().min(1),
    page_key: z.string().nullable(),
    kind: z.enum(["meta", "count", "ids", "page", "other"]),
    method: z.enum(["GET", "POST"]).optional(),
    blocked_at: z.string().optional(),
    content_type: z.string().nullable().optional(),
    excerpt: z.string().max(300).optional(),
  })
  .strict()
  .refine((r) => r.outcome !== "blocked" || r.blocked_at !== undefined, {
    message: "a blocked receipt needs blocked_at",
  });

const Complete = z
  .object({
    mode: z.enum(["pilot", "full"]),
    pages: z.number().int().nonnegative(),
    features: z.number().int().nonnegative(),
    started_at: z.string(),
    finished_at: z.string(),
    duration_s: z.number().nonnegative(),
    features_per_s: z.number().nonnegative(),
    snapshot_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    source_count: z.number().int().nonnegative(),
    page_size: z.number().int().positive(),
    concurrency: z.number().int().positive(),
    object_id_field: z.string(),
    layer_last_edit_date: z.string().nullable(),
  })
  .strict();
export type CompleteJson = z.infer<typeof Complete>;
export type ArtifactReceipt = z.infer<typeof Receipt>;

const Blocked = z.object({ outcome: z.literal("blocked"), blocked_at: z.string() }).loose();
const Failed = z
  .object({ outcome: z.literal("failed"), code: z.string(), failed_at: z.string() })
  .loose();
const Pilot = z.object({ mode: z.literal("pilot"), finished_at: z.string() }).loose();
const Count = z.object({ count: z.number().int().nonnegative() }).loose();
const Ids = z.object({ objectIds: z.array(z.number().int()) }).loose();
const Meta = z.object({ fields: z.array(z.object({ name: z.string() }).loose()) }).loose();
const Config = z
  .object({
    mode: z.enum(["pilot", "full"]),
    layerUrl: z.string().url(),
    pidField: z.string().nullable(),
    geoidField: z.string().nullable(),
    objectIdField: z.string(),
    layerLastEditDate: z.string().nullable(),
  })
  .loose();
const Page = z.object({
  features: z.array(
    z
      .object({
        attributes: z.record(z.string(), z.unknown()),
        geometry: z.unknown().optional(),
      })
      .loose(),
  ),
});

export interface PageRef {
  pageKey: string;
  url: string;
  sha256: string;
  capturedAt: string;
  file: string;
  outcome: "ok" | "skipped_checkpoint";
}

export type ImportDetail = "complete" | "blocked" | "failed" | "pilot" | "partial";

export interface ArtifactSummary {
  root: string;
  artifactRunId: string;
  /** Digest of every file (sorted `path<TAB>sha256` lines): the Loader idempotency key. */
  artifactSha256: string;
  status: "complete" | "blocked";
  detail: ImportDetail;
  blockedAt: string | null;
  limitation: string | null;
  egressLoc: string;
  layerUrl: string;
  objectIdField: string;
  pidField: string | null;
  geoidField: string | null;
  layerLastEditDate: string | null;
  sourceCount: number | null;
  pages: PageRef[];
  receipts: ArtifactReceipt[];
  complete: CompleteJson | null;
}

export interface GisFeatureRow {
  object_id: number;
  page_key: string;
  pid_value: string | null;
  geoid_value: string | null;
  area: number | null;
  point_lat: number | null;
  point_lon: number | null;
  point_method: PointMethod | null;
  null_geometry: boolean;
}

function readJson<T>(root: string, rel: string, schema: z.ZodType<T>): T | null {
  const path = join(root, rel);
  if (!existsSync(path)) return null;
  const parsed = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`gis artifact: ${rel} is not valid: ${parsed.error.issues[0]?.message ?? ""}`);
  }
  return parsed.data;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** The folder that holds the artifact files: `dir` itself or its only child (gh run download). */
export function resolveArtifactRoot(dir: string): string {
  const has = (d: string): boolean =>
    existsSync(join(d, "receipts.jsonl")) || existsSync(join(d, "meta.json"));
  if (has(dir)) return dir;
  const children = readdirSync(dir)
    .map((n) => join(dir, n))
    .filter((p) => statSync(p).isDirectory() && has(p));
  if (children.length === 1 && children[0] !== undefined) return children[0];
  throw new Error(`gis artifact: no runner artifact under ${basename(dir)}`);
}

const nullableString = (v: unknown): string | null =>
  v === null || v === undefined || String(v).trim() === "" ? null : String(v);

export function inspectArtifact(dir: string): ArtifactSummary {
  const root = resolveArtifactRoot(dir);
  const egressPath = join(root, "egress.txt");
  const egress = existsSync(egressPath) ? readFileSync(egressPath, "utf8").trim() : "";
  if (egress !== "loc=US") {
    throw new Error(`gis artifact: egress.txt must be "loc=US", got "${egress.slice(0, 20)}"`);
  }
  const config = readJson(root, "config.json", Config);
  if (config === null) throw new Error("gis artifact: config.json is missing");
  readJson(root, "meta.json", Meta);
  const count = readJson(root, "count.json", Count);
  readJson(root, "ids.json", Ids);
  const receiptsPath = join(root, "receipts.jsonl");
  const lines = existsSync(receiptsPath)
    ? readFileSync(receiptsPath, "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "")
    : [];
  const receipts = lines.map((line, i) => {
    const parsed = Receipt.safeParse(JSON.parse(line));
    if (!parsed.success) throw new Error(`gis artifact: receipts.jsonl line ${i + 1} is not valid`);
    return parsed.data;
  });
  const byKey = new Map<string, PageRef>();
  for (const r of receipts) {
    if (r.kind !== "page" || r.page_key === null) continue;
    if (r.outcome !== "ok" && r.outcome !== "skipped_checkpoint") continue;
    const file = `pages/${r.page_key}.json`;
    const path = join(root, file);
    if (!existsSync(path))
      throw new Error(`gis artifact: page ${r.page_key} has a receipt but no file`);
    if (sha256(readFileSync(path)) !== r.sha256) {
      throw new Error(`gis artifact: page ${r.page_key} bytes do not match its receipt sha256`);
    }
    byKey.set(r.page_key, {
      pageKey: r.page_key,
      url: r.url,
      sha256: r.sha256,
      capturedAt: r.captured_at,
      file,
      outcome: r.outcome,
    });
  }
  const complete = readJson(root, "complete.json", Complete);
  const blocked = readJson(root, "blocked.json", Blocked);
  const failed = readJson(root, "failed.json", Failed);
  const pilot = readJson(root, "pilot.json", Pilot);
  const ok = complete !== null && blocked === null && failed === null;
  if (ok && complete.pages !== byKey.size) {
    throw new Error(
      `gis artifact: complete.json counts ${complete.pages} pages, receipts hold ${byKey.size}`,
    );
  }
  const detail: ImportDetail = ok
    ? "complete"
    : blocked !== null
      ? "blocked"
      : failed !== null
        ? "failed"
        : pilot !== null
          ? "pilot"
          : "partial";
  const blockedAt = ok
    ? null
    : (blocked?.blocked_at ??
      failed?.failed_at ??
      pilot?.finished_at ??
      receipts.at(-1)?.captured_at ??
      "unknown");
  const files = walk(root)
    .map((p) => `${relative(root, p)}\t${sha256(readFileSync(p))}`)
    .sort();
  const runId = /us-runner-([0-9]+)/.exec(root)?.[1] ?? basename(root);
  return {
    root,
    artifactRunId: runId,
    artifactSha256: sha256(files.join("\n")),
    status: ok ? "complete" : "blocked",
    detail,
    blockedAt,
    limitation: blockedAt === null ? null : gisBlockedLimitation(blockedAt),
    egressLoc: "US",
    layerUrl: config.layerUrl,
    objectIdField: config.objectIdField,
    pidField: config.pidField,
    geoidField: config.geoidField,
    layerLastEditDate: config.layerLastEditDate,
    sourceCount: count?.count ?? null,
    pages: [...byKey.values()],
    receipts,
    complete: ok ? complete : null,
  };
}

/** One row per feature (first occurrence of an object id wins; the kit allows no duplicate). */
export function* readFeatures(summary: ArtifactSummary): Generator<GisFeatureRow> {
  const seen = new Set<number>();
  for (const page of summary.pages) {
    const body = Page.parse(JSON.parse(readFileSync(join(summary.root, page.file), "utf8")));
    for (const f of body.features) {
      const id = Number(f.attributes[summary.objectIdField]);
      if (!Number.isInteger(id) || seen.has(id)) continue;
      seen.add(id);
      const point = featurePoint(f.geometry ?? null);
      yield {
        object_id: id,
        page_key: page.pageKey,
        pid_value:
          summary.pidField === null ? null : nullableString(f.attributes[summary.pidField]),
        geoid_value:
          summary.geoidField === null ? null : nullableString(f.attributes[summary.geoidField]),
        area: point?.area ?? null,
        point_lat: point?.lat ?? null,
        point_lon: point?.lon ?? null,
        point_method: point?.method ?? null,
        null_geometry: point === null,
      };
    }
  }
}
