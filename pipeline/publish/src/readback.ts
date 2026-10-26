// Readback of one group's two uploads (research R-06, data-model ReadbackResult, FR-001): the
// summaries `elephant-cli upload --output-json` wrote must carry the hash and export roots
// (compared by digest with sameDigest, since a summary may print another codec), the part count
// must agree between the local part files, the export summary and the upload summary, and every
// part is fetched from FILEBASE_GATEWAY_HOST with a plain GET (no Range) and compared on size and
// SHA-256 with the local file. With `approved` (upload.ts always passes the D-8 listing), each
// part and each carCid file is compared with its APPROVED size, SHA-256 and CID instead
// (CR-A-03 F-5): a file changed on disk after verifyApprovedBuild fails even when the gateway
// serves the changed bytes. Any mismatch fails the group, and upload.ts then writes no
// manifest. At most two parts are in flight; 404/429/5xx and network errors are retried with
// full-jitter backoff that honours Retry-After, a few attempts, then the part fails.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";
import { cidOfFile, sameDigest } from "./cid.js";
import type { PublicFile } from "./approval.js";
import type { FetchLike } from "./kubo-add.js";
import { sha256File, type DataGroup, type GroupResult } from "./sequence.js";
import { FILEBASE_GATEWAY_HOST } from "./verify.js";

export type { FetchLike } from "./kubo-add.js";
/** The gateway the readback uses (plan § "Fixed texts and config keys"); defined once in verify.ts. */
export { FILEBASE_GATEWAY_HOST } from "./verify.js";

export const READBACK_TIMEOUT_MS = 120_000;
export const READBACK_ATTEMPTS = 5;
export const READBACK_CONCURRENCY = 2;

/** `FILEBASE_GATEWAY_HOST` from the env, else the fixed default. */
export function filebaseGatewayHost(env: NodeJS.ProcessEnv): string {
  const host = env.FILEBASE_GATEWAY_HOST?.trim();
  return host === undefined || host === "" ? FILEBASE_GATEWAY_HOST : host;
}

/** `upload <car> --output-json` (elephant-cli 44bb182 CarImportResult). */
export const CarUploadSummary = z.object({
  api: z.string(),
  root: z.string().min(1),
  blocks: z.number().int().nonnegative(),
  gatewayUrl: z.string(),
  uploadedAt: z.string(),
});
export type CarUploadSummary = z.infer<typeof CarUploadSummary>;

/** `upload <tables dir> --output-json` (elephant-cli 44bb182 TablesImportResult). */
export const TablesUploadSummary = z.object({
  api: z.string(),
  root: z.string().min(1),
  countyRoot: z.string().min(1),
  parts: z.number().int().nonnegative(),
  gatewayUrl: z.string(),
  uploadedAt: z.string(),
});
export type TablesUploadSummary = z.infer<typeof TablesUploadSummary>;

const ExportSummaryParts = z
  .object({ tables: z.record(z.string(), z.object({ parts: z.number().int() }).loose()) })
  .loose();

export function readUploadSummary<T>(path: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export interface TablePart {
  table: string;
  position: number;
  path: string;
  /** `<table>/part-<nnnnn>.parquet`, relative to the tables directory. */
  name: string;
}

const PART_FILE = /^part-(\d{5})\.parquet$/;

/** The part files under a tables directory, in table (code-unit) then position order. */
export function listTableParts(tablesDir: string): TablePart[] {
  const parts: TablePart[] = [];
  for (const entry of readdirSync(tablesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const table = entry.name;
    for (const file of readdirSync(join(tablesDir, table))) {
      const m = PART_FILE.exec(file);
      if (!m) continue;
      parts.push({
        table,
        position: Number(m[1]),
        path: join(tablesDir, table, file),
        name: `${table}/${file}`,
      });
    }
  }
  return parts.sort((a, b) =>
    a.table < b.table ? -1 : a.table > b.table ? 1 : a.position - b.position,
  );
}

/** The part count the export summary declares (the sum over its tables). */
export function exportedPartCount(tablesExportJson: string): number {
  const summary = ExportSummaryParts.parse(JSON.parse(readFileSync(tablesExportJson, "utf8")));
  return Object.values(summary.tables).reduce((n, t) => n + t.parts, 0);
}

export interface RootCheck {
  expected: string;
  uploaded: string;
  ok: boolean;
}

export interface PartReadback {
  table: string;
  position: number;
  name: string;
  cid: string;
  /** Size and SHA-256 of the local part: what the gateway must serve. */
  size: number;
  sha256: string;
  ok: boolean;
  reason?: string;
}

export interface ReadbackResult {
  group: DataGroup;
  ok: boolean;
  archiveRoot: RootCheck;
  tablesRoot: RootCheck;
  rootMatches: boolean;
  partCount: number;
  uploadedParts: number;
  partCountMatches: boolean;
  parts: PartReadback[];
  problems: string[];
}

export interface ReadbackOptions {
  /** Read for FILEBASE_GATEWAY_HOST only; no credential is needed for a gateway GET. */
  env: NodeJS.ProcessEnv;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Jitter source in [0, 1) (default Math.random). */
  random?: () => number;
  attempts?: number;
  concurrency?: number;
  timeoutMs?: number;
  /**
   * The D-8 approved public files (reports/public-files.json, paths relative to `runDir`). When
   * set, served bytes are compared with the approved size and SHA-256 (fetched by the approved
   * CID), and a local file that differs from its approval, or is not in it, fails (F-5).
   */
  approved?: { runDir: string; files: readonly PublicFile[] };
}

/** What a file must be: its approved digests when an approval is given, else the local file. */
async function expectedFor(
  path: string,
  options: ReadbackOptions,
): Promise<{ size: number; sha256: string; cid: string } | { problem: string }> {
  const size = statSync(path).size;
  const sha256 = await sha256File(path);
  if (options.approved === undefined) return { size, sha256, cid: await cidOfFile(path) };
  const rel = relative(options.approved.runDir, path);
  const approved = options.approved.files.find((f) => f.path === rel);
  if (approved === undefined) return { problem: `${rel} is not in the approved public files` };
  if (approved.size !== size || approved.sha256 !== sha256)
    return {
      problem: `local ${rel} (${size} B, sha256 ${sha256}) differs from the approved ${approved.size} B, sha256 ${approved.sha256}`,
    };
  return { size: approved.size, sha256: approved.sha256, cid: approved.cid };
}

type Fetched = { ok: true; size: number; sha256: string } | { ok: false; reason: string };

const RETRYABLE = new Set([404, 408, 425, 429, 500, 502, 503, 504]);
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 60_000;

/** Streams a body into SHA-256, stopping once more than `cap` bytes arrived. */
async function digestBody(
  response: Response,
  cap: number,
): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  const body = response.body;
  if (body !== null) {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      hash.update(value);
      if (size > cap) {
        await reader.cancel();
        break;
      }
    }
  }
  return { size, sha256: hash.digest("hex") };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A plain GET with retries on 404/429/5xx and network errors; the body is digested, not kept. */
async function getDigest(url: string, cap: number, options: ReadbackOptions): Promise<Fetched> {
  const fetchImpl = options.fetch ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const attempts = options.attempts ?? READBACK_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? READBACK_TIMEOUT_MS;
  let last = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let retryAfter: number | undefined;
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return { ok: true, ...(await digestBody(response, cap)) };
      await response.body?.cancel();
      last = `HTTP ${response.status}`;
      if (!RETRYABLE.has(response.status)) return { ok: false, reason: last };
      const header = Number(response.headers.get("retry-after"));
      if (Number.isFinite(header) && header > 0) retryAfter = header;
    } catch (error) {
      last = `network error: ${message(error)}`;
    }
    if (attempt === attempts) break;
    const ms =
      retryAfter === undefined
        ? Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1)) * random()
        : Math.min(BACKOFF_CAP_MS, retryAfter * 1000);
    await sleep(ms);
  }
  return { ok: false, reason: `${last} after ${attempts} attempts` };
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep the input order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function checkPart(
  part: TablePart,
  host: string,
  options: ReadbackOptions,
): Promise<PartReadback> {
  const expected = await expectedFor(part.path, options);
  const label = options.approved === undefined ? "local" : "approved";
  if ("problem" in expected) {
    const size = statSync(part.path).size;
    const sha256 = await sha256File(part.path);
    const cid = await cidOfFile(part.path);
    const base = { table: part.table, position: part.position, name: part.name, cid, size, sha256 };
    return { ...base, ok: false, reason: expected.problem };
  }
  const { size, sha256, cid } = expected;
  const base = { table: part.table, position: part.position, name: part.name, cid, size, sha256 };
  const url = `https://${host}/ipfs/${cid}`;
  const fetched = await getDigest(url, size + 1, options);
  if (!fetched.ok) return { ...base, ok: false, reason: `GET ${url}: ${fetched.reason}` };
  if (fetched.size !== size)
    return { ...base, ok: false, reason: `size ${fetched.size} served, ${size} ${label}` };
  if (fetched.sha256 !== sha256)
    return {
      ...base,
      ok: false,
      reason: `sha256 differs: ${fetched.sha256} served, ${sha256} ${label}`,
    };
  return { ...base, ok: true };
}

export interface FileReadback {
  /** Size and SHA-256 of the local file: what the gateway must serve for its CID. */
  size: number;
  sha256: string;
  ok: boolean;
  reason?: string;
}

/**
 * Reads one plain file back by its CID from FILEBASE_GATEWAY_HOST (a plain GET, the same retry
 * policy as the parts) and compares size and SHA-256 with the local file. upload.ts runs it on
 * every carCid add before the manifest is built (OR-4).
 */
export async function readbackFile(
  cid: string,
  path: string,
  options: ReadbackOptions,
): Promise<FileReadback> {
  const expected = await expectedFor(path, options);
  if ("problem" in expected) {
    const size = statSync(path).size;
    return { size, sha256: await sha256File(path), ok: false, reason: expected.problem };
  }
  const { size, sha256 } = expected;
  const label = options.approved === undefined ? "local" : "approved";
  if (options.approved !== undefined && expected.cid !== cid)
    return { size, sha256, ok: false, reason: `added as ${cid}, approved as ${expected.cid}` };
  const url = `https://${filebaseGatewayHost(options.env)}/ipfs/${cid}`;
  const fetched = await getDigest(url, size + 1, options);
  if (!fetched.ok) return { size, sha256, ok: false, reason: `GET ${url}: ${fetched.reason}` };
  if (fetched.size !== size)
    return { size, sha256, ok: false, reason: `size ${fetched.size} served, ${size} ${label}` };
  if (fetched.sha256 !== sha256)
    return {
      size,
      sha256,
      ok: false,
      reason: `sha256 differs: ${fetched.sha256} served, ${sha256} ${label}`,
    };
  return { size, sha256, ok: true };
}

/**
 * Reads one group's uploads back: roots by digest, part counts, then every part from the
 * gateway. Parts are fetched only when the roots and counts agree (a wrong root means the wrong
 * DAG was pinned; hashing its parts proves nothing).
 */
export async function readbackGroup(
  group: GroupResult,
  options: ReadbackOptions,
): Promise<ReadbackResult> {
  if (!group.uploads)
    throw new Error(`${group.group}: no upload summaries; the publish phase did not run`);
  const archive = readUploadSummary(group.uploads.archiveJson, CarUploadSummary);
  const tables = readUploadSummary(group.uploads.tablesJson, TablesUploadSummary);
  const problems: string[] = [];
  const archiveRoot: RootCheck = {
    expected: group.carRoot,
    uploaded: archive.root,
    ok: sameDigest(archive.root, group.carRoot),
  };
  if (!archiveRoot.ok)
    problems.push(`archive root ${archive.root} uploaded, hash root ${group.carRoot} expected`);
  const tablesRoot: RootCheck = {
    expected: group.tablesRoot,
    uploaded: tables.root,
    ok: sameDigest(tables.root, group.tablesRoot),
  };
  if (!tablesRoot.ok)
    problems.push(`tables root ${tables.root} uploaded, export root ${group.tablesRoot} expected`);
  if (!sameDigest(tables.countyRoot, group.carRoot))
    problems.push(`tables countyRoot ${tables.countyRoot} is not the hash root ${group.carRoot}`);
  const rootMatches = archiveRoot.ok && tablesRoot.ok;

  const local = listTableParts(group.tablesDir);
  const exported = exportedPartCount(group.tablesExportJson);
  if (local.length !== exported)
    problems.push(`${local.length} local parts, ${exported} in the export summary`);
  if (local.length !== tables.parts)
    problems.push(`${local.length} local parts, ${tables.parts} in the upload summary`);
  const partCountMatches = local.length === exported && local.length === tables.parts;

  let parts: PartReadback[] = [];
  if (rootMatches && partCountMatches && problems.length === 0) {
    const host = filebaseGatewayHost(options.env);
    const limit = options.concurrency ?? READBACK_CONCURRENCY;
    parts = await mapLimit(local, limit, (part) => checkPart(part, host, options));
    for (const p of parts) if (!p.ok) problems.push(`${p.name}: ${p.reason ?? "mismatch"}`);
  }
  return {
    group: group.group,
    ok: problems.length === 0,
    archiveRoot,
    tablesRoot,
    rootMatches,
    partCount: local.length,
    uploadedParts: tables.parts,
    partCountMatches,
    parts,
    problems,
  };
}
