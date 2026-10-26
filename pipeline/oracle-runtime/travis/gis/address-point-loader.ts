// A-11 Run 3 (ADR 0004): the polite, resumable loader for the City of Austin address-point
// layer. Public GETs only, through the repo's one HTTP boundary (travis/lib/source-client.ts):
// the project User-Agent, at most 1 request/s to services.arcgis.com (HOST_POLICY), backoff
// only on 429/5xx, one attempt and a stop on a 403 or a challenge. 2,000 records per page.
//
// Cache (gitignored, under pipeline/data/raw/austin-address-points by default):
//   pages/page-<offset>.json     one page, parsed to the fields the matcher needs (resume unit)
//   address-points.ndjson        every record, one JSON per line, ordered by OBJECTID
//   receipt.json                 layer URL, retrieved-at, record count, source count, sha256 of
//                                the ndjson file and the layer's last edit date
// A rerun skips pages already on disk. If the layer's edit date changed since the pages were
// written the pages are discarded and the capture restarts, so a cache never mixes two edits.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { stopClass, type CaptureReceipt, type SourceClient } from "../lib/source-client.js";
import { ADDRESS_LAYER_URL, type AddressPointRecord } from "./address-points.js";

export const PAGE_SIZE = 2_000;
export const DEFAULT_CACHE_DIR = "pipeline/data/raw/austin-address-points";

const OUT_FIELDS = [
  "OBJECTID",
  "PLACE_ID",
  "ADDRESS",
  "FULL_STREET_NAME",
  "ADDRESS_FRACTION",
  "ADDRESS_SUFFIX",
  "ADDRESS_TYPE",
].join(",");

const ArcgisError = z.object({
  error: z.object({ code: z.number().optional(), message: z.string().optional() }),
});

const LayerInfo = z.object({
  name: z.string(),
  maxRecordCount: z.number().optional(),
  editingInfo: z
    .object({
      dataLastEditDate: z.number().nullable().optional(),
      lastEditDate: z.number().nullable().optional(),
    })
    .optional(),
});
const CountBody = z.object({ count: z.number().int().nonnegative() });
const PageBody = z.object({
  features: z.array(
    z.object({
      attributes: z.object({
        OBJECTID: z.number().int(),
        PLACE_ID: z.number().nullable().optional(),
        ADDRESS: z.number().nullable().optional(),
        FULL_STREET_NAME: z.string().nullable().optional(),
        ADDRESS_FRACTION: z.union([z.string(), z.number()]).nullable().optional(),
        ADDRESS_SUFFIX: z.string().nullable().optional(),
        ADDRESS_TYPE: z.number().nullable().optional(),
      }),
      geometry: z.object({ x: z.number(), y: z.number() }).nullable().optional(),
    }),
  ),
  exceededTransferLimit: z.boolean().optional(),
});

/** Throws the layer's own error body (an ArcGIS error arrives with HTTP 200). */
const guard =
  <T extends z.ZodType>(schema: T) =>
  (body: unknown): z.infer<T> => {
    const err = ArcgisError.safeParse(body);
    if (err.success)
      throw new Error(`ArcGIS error ${err.data.error.code ?? ""}: ${err.data.error.message ?? ""}`);
    return schema.parse(body);
  };
// The source client takes a ZodType; wrap the guard in a transform so it plugs in unchanged.
const guarded = <T extends z.ZodType>(schema: T) =>
  z.unknown().transform((body, ctx) => {
    try {
      return guard(schema)(body);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: e instanceof Error ? e.message : String(e) });
      return z.NEVER;
    }
  });

export interface AddressLayerReceipt {
  layer_url: string;
  retrieved_at: string;
  record_count: number;
  source_count: number;
  /** sha256 of address-points.ndjson. */
  sha256: string;
  /** The layer's last data edit, ISO. */
  layer_last_edit_date: string | null;
  pages: number;
  page_size: number;
  user_agent: string;
  /** Per-request captures (status, bytes, sha256, captured_at, attempts) in request order. */
  requests: Array<
    Pick<
      CaptureReceipt,
      "url" | "status" | "bytes" | "sha256" | "captured_at" | "attempts" | "outcome"
    >
  >;
}

export interface LoadOptions {
  client: SourceClient;
  cacheDir?: string;
  now?: () => Date;
  log?: (message: string) => void;
  /** Records per request; the layer allows 2,000 (tests use fewer). */
  pageSize?: number;
  /** Stop after this many new pages (tests). */
  maxPages?: number;
}

const sha256Of = (buf: Buffer | string): string => createHash("sha256").update(buf).digest("hex");

const query = (extra: string): string => `${ADDRESS_LAYER_URL}/query?${extra}&f=json`;

function brief(r: CaptureReceipt): AddressLayerReceipt["requests"][number] {
  return {
    url: r.url,
    status: r.status,
    bytes: r.bytes,
    sha256: r.sha256,
    captured_at: r.captured_at,
    attempts: r.attempts,
    outcome: r.outcome,
  };
}

function must<T>(res: { receipt: CaptureReceipt; data: T | null }): T {
  const cls = stopClass(res.receipt);
  if (cls !== "ok" || res.data === null) {
    throw new Error(
      `address layer ${cls === "blocked" ? "BLOCKED (stop, do not retry)" : "request failed"}: ${res.receipt.url} status ${res.receipt.status ?? "none"} ${res.receipt.error ?? ""}`.trim(),
    );
  }
  return res.data;
}

/** Capture the whole layer into the cache (resumable). Returns the receipt. */
export async function loadAddressLayer(opts: LoadOptions): Promise<AddressLayerReceipt> {
  const dir = opts.cacheDir ?? DEFAULT_CACHE_DIR;
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => undefined);
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const pagesDir = join(dir, "pages");
  mkdirSync(pagesDir, { recursive: true });
  const requests: AddressLayerReceipt["requests"] = [];

  const infoRes = await opts.client.capture({
    url: `${ADDRESS_LAYER_URL}?f=json`,
    schema: guarded(LayerInfo),
  });
  requests.push(brief(infoRes.receipt));
  const info = must(infoRes);
  const editMs = info.editingInfo?.dataLastEditDate ?? info.editingInfo?.lastEditDate ?? null;
  const editIso = editMs === null ? null : new Date(editMs).toISOString();

  const countRes = await opts.client.capture({
    url: query("where=1%3D1&returnCountOnly=true"),
    schema: guarded(CountBody),
  });
  requests.push(brief(countRes.receipt));
  const sourceCount = must(countRes).count;

  // A cache written for another edit of the layer is not reused.
  const stampPath = join(dir, "edit-date.txt");
  const stamp = existsSync(stampPath) ? readFileSync(stampPath, "utf8").trim() : null;
  if (stamp !== null && stamp !== String(editIso)) {
    log(`layer edited since the cache was written (${stamp} -> ${String(editIso)}): restarting`);
    rmSync(pagesDir, { recursive: true, force: true });
    mkdirSync(pagesDir, { recursive: true });
  }
  writeFileSync(stampPath, `${String(editIso)}\n`);

  const pageCount = Math.ceil(sourceCount / pageSize);
  let fetched = 0;
  for (let i = 0; i < pageCount; i += 1) {
    const offset = i * pageSize;
    const file = join(pagesDir, `page-${String(offset).padStart(8, "0")}.json`);
    if (existsSync(file)) continue;
    if (opts.maxPages !== undefined && fetched >= opts.maxPages) break;
    const res = await opts.client.capture({
      url: query(
        `where=1%3D1&outFields=${OUT_FIELDS}&outSR=4326&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=${pageSize}`,
      ),
      schema: guarded(PageBody),
    });
    const page = must(res);
    const records: AddressPointRecord[] = page.features.flatMap((f) =>
      f.geometry == null
        ? []
        : [
            {
              object_id: f.attributes.OBJECTID,
              place_id: f.attributes.PLACE_ID ?? null,
              address: f.attributes.ADDRESS ?? null,
              full_street_name: f.attributes.FULL_STREET_NAME ?? null,
              address_fraction:
                f.attributes.ADDRESS_FRACTION == null
                  ? null
                  : String(f.attributes.ADDRESS_FRACTION),
              address_suffix: f.attributes.ADDRESS_SUFFIX ?? null,
              address_type: f.attributes.ADDRESS_TYPE ?? null,
              lat: f.geometry.y,
              lon: f.geometry.x,
            },
          ],
    );
    writeFileSync(
      `${file}.part`,
      JSON.stringify({ receipt: brief(res.receipt), features: page.features.length, records }),
    );
    renameSync(`${file}.part`, file);
    requests.push(brief(res.receipt));
    fetched += 1;
    log(`page ${i + 1}/${pageCount} (${page.features.length} features)`);
  }

  return finalize({
    dir,
    sourceCount,
    pageCount,
    pageSize,
    editIso,
    requests,
    retrievedAt: now().toISOString(),
  });
}

function finalize(a: {
  dir: string;
  sourceCount: number;
  pageCount: number;
  pageSize: number;
  editIso: string | null;
  requests: AddressLayerReceipt["requests"];
  retrievedAt: string;
}): AddressLayerReceipt {
  const pagesDir = join(a.dir, "pages");
  const files = readdirSync(pagesDir)
    .filter((f) => /^page-\d{8}\.json$/.test(f))
    .sort();
  if (files.length < a.pageCount) {
    throw new Error(
      `address layer cache incomplete: ${files.length} of ${a.pageCount} pages (rerun to resume)`,
    );
  }
  const lines: string[] = [];
  const seen = new Set<number>();
  let features = 0;
  const pageRequests: AddressLayerReceipt["requests"] = [];
  for (const f of files) {
    const page = JSON.parse(readFileSync(join(pagesDir, f), "utf8")) as {
      receipt: AddressLayerReceipt["requests"][number];
      features: number;
      records: AddressPointRecord[];
    };
    pageRequests.push(page.receipt);
    features += page.features;
    for (const r of page.records) {
      if (seen.has(r.object_id))
        throw new Error(
          `address layer cache has OBJECTID ${r.object_id} twice (layer edited while paging)`,
        );
      seen.add(r.object_id);
      lines.push(JSON.stringify(r));
    }
  }
  if (features !== a.sourceCount) {
    throw new Error(
      `address layer cache has ${features} features, the layer reports ${a.sourceCount}`,
    );
  }
  const body = `${lines.join("\n")}\n`;
  const file = join(a.dir, "address-points.ndjson");
  writeFileSync(`${file}.part`, body);
  renameSync(`${file}.part`, file);
  const receipt: AddressLayerReceipt = {
    layer_url: ADDRESS_LAYER_URL,
    retrieved_at: a.retrievedAt,
    record_count: lines.length,
    source_count: a.sourceCount,
    sha256: sha256Of(body),
    layer_last_edit_date: a.editIso,
    pages: files.length,
    page_size: a.pageSize,
    user_agent: "oracle-travis-discovery (project User-Agent, travis/lib/source-client.ts)",
    requests: [...a.requests.slice(0, 2), ...pageRequests],
  };
  writeFileSync(join(a.dir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

/** Read the cache back, verifying the file digest against the receipt. */
export function readAddressLayerCache(dir: string = DEFAULT_CACHE_DIR): {
  receipt: AddressLayerReceipt;
  records: AddressPointRecord[];
} {
  const receipt = JSON.parse(
    readFileSync(join(dir, "receipt.json"), "utf8"),
  ) as AddressLayerReceipt;
  const body = readFileSync(join(dir, "address-points.ndjson"), "utf8");
  if (sha256Of(body) !== receipt.sha256)
    throw new Error("address-points.ndjson does not match its receipt sha256");
  const records = body
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as AddressPointRecord);
  if (records.length !== receipt.record_count)
    throw new Error("address-points.ndjson record count differs from its receipt");
  return { receipt, records };
}
