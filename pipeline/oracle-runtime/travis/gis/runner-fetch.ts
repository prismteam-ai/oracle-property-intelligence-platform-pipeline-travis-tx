// A-04 T041 (D-2, contracts/gis-runner.md): the fetch-only GIS capture that runs ONLY on the
// GitHub-hosted US runner (.github/workflows/a04-gis-capture.yml). Never run it from the
// operator machine (ARD § 8; TC-NF-03).
//
//   npx tsx travis/gis/runner-fetch.ts --config travis/gis/runner-config.json --out out
//
// - Paging is the vendored kit adapter's `enumerateAll` (snapshot = count + ids, page
//   reconciliation, `arcgis_source_drift` refusal) with the injected geometry client
//   (geometry-client.ts) for geometry, etiquette and raw-body receipts.
// - `mode` comes from runner-config.json: `pilot` = layer metadata, count, ids and ONE page
//   (pilot.json); `full` = every page (complete.json only when every page completed).
// - Page size ≤ min(2,000, bulkPageSize, the layer's maxRecordCount); pages in flight ≤ 2.
// - Resume: checkpoints/<pageKey>.json + pages/<pageKey>.json (restored by actions/cache);
//   a checkpoint is trusted only when its snapshot and objectIds digests match this run.
// - A 403/challenge or 5 failed attempts → blocked.json (blocked_at), exit 2; any other stop
//   (kit drift or reconciliation refusal, an unusable answer) → failed.json, exit 1. Never
//   complete.json on a partial run. No transform, no Query DB, no publish.
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createLogger } from "../lib/log.js";
import { createSourceClient, USER_AGENT, type SourceClient } from "../lib/source-client.js";
import {
  createGeometryClient,
  dirWriter,
  GisBlockedError,
  GisRequestError,
  sha256Hex,
  type GisDiagnostic,
  type ArtifactWriter,
  type GeometryClient,
} from "./geometry-client.js";

export const GIS_HOST = "gis.traviscountytx.gov";
export const MAX_PAGE_SIZE = 2000;
export const MAX_PAGES_IN_FLIGHT = 2;

/** A field name that could carry an owner, a mailing or situs address, or contact data. */
export const PRIVATE_FIELD = /owner|addr|situs|mail|street|city|zip|phone|email|name/i;

const FieldName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.]*$/);

export const RunnerConfig = z
  .object({
    mode: z.enum(["pilot", "full"]),
    layerUrl: z
      .url()
      .refine((u) => new URL(u).protocol === "https:" && new URL(u).host === GIS_HOST, {
        message: `layerUrl must be an https URL on ${GIS_HOST}`,
      }),
    /**
     * Page fields besides the layer's object id (always requested, read from the layer
     * metadata): the pID and geoID fields only. Empty for the pilot, which reads the field
     * names from the layer metadata first.
     */
    outFields: z.array(FieldName),
    pidField: FieldName.nullable(),
    geoidField: FieldName.nullable(),
    bulkPageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
    /** Clamped to MAX_PAGES_IN_FLIGHT (NFR-004), never raised. */
    bulkConcurrency: z.number().int().min(1),
    userAgent: z.literal(USER_AGENT),
    /** Bumped to retrigger the workflow's path filter; never changes behaviour. */
    attempt: z.number().int().min(1).default(1),
    /** Read by the workflow's gate job: false after the finished full run (no repeat capture). */
    enabled: z.boolean().default(true),
  })
  .strict()
  .superRefine((c, ctx) => {
    for (const f of c.outFields) {
      if (PRIVATE_FIELD.test(f)) {
        ctx.addIssue({
          code: "custom",
          path: ["outFields"],
          message: `outFields must not carry ${f}`,
        });
      }
    }
    for (const key of ["pidField", "geoidField"] as const) {
      const f = c[key];
      if (f !== null && !c.outFields.includes(f)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} ${f} must be one of outFields`,
        });
      }
    }
  });
export type RunnerConfig = z.infer<typeof RunnerConfig>;

const LayerMeta = z
  .object({
    objectIdField: z.string().optional(),
    maxRecordCount: z.number().int().positive().optional(),
    supportsPagination: z.boolean().optional(),
    editingInfo: z.object({ lastEditDate: z.number().optional() }).loose().optional(),
    fields: z
      .array(z.object({ name: z.string(), type: z.string().optional() }).loose())
      .default([]),
  })
  .loose();

const Checkpoint = z
  .object({
    status: z.literal("complete"),
    snapshotSha256: z.string(),
    objectIdsSha256: z.string(),
    receivedCount: z.number().int().nonnegative(),
    page_key: z.string(),
    page_index: z.number().int().nonnegative(),
    sha256: z.string(),
    url: z.string(),
    captured_at: z.string(),
  })
  .strict();

export type RunStatus = "complete" | "pilot" | "blocked" | "failed";
export interface RunResult {
  status: RunStatus;
  exitCode: 0 | 1 | 2;
  pages: number;
  features: number;
}

interface PageIdentity {
  pageKey: string;
  pageIndex: number;
  objectIds: string[];
  objectIdsSha256: string;
  snapshotSha256: string;
}
interface KitAdapter {
  enumerateAll(options: {
    pageConcurrency: number;
    loadPageCheckpoint: (p: PageIdentity) => Promise<unknown>;
    onPage: (p: PageIdentity & { receivedCount: number }) => Promise<void>;
  }): Promise<{
    pageCount: number;
    receivedCount: number;
    snapshotSha256: string;
    sourceCount: number;
  }>;
}
type CreateAdapter = (
  jurisdiction: { key: string; adapterConfig: Record<string, unknown> },
  options: { client: Pick<GeometryClient, "json">; countyKey: string; countyName: string },
) => KitAdapter;

const KIT = new URL("../../kit/use-oracle/runtime/src/permits/", import.meta.url);

/** The vendored kit modules (untyped .mjs, imported by URL and narrowed here). */
async function loadKit(): Promise<{
  createAdapter: CreateAdapter;
  sha256Json: (v: unknown) => string;
}> {
  const adapterUrl: string = new URL("adapters/arcgis-feature-service.mjs", KIT).href;
  const inputsUrl: string = new URL("backfill-inputs.mjs", KIT).href;
  const adapter = (await import(adapterUrl)) as {
    createArcgisFeatureServiceAdapter: CreateAdapter;
  };
  const inputs = (await import(inputsUrl)) as { sha256Json: (v: unknown) => string };
  return {
    createAdapter: adapter.createArcgisFeatureServiceAdapter,
    sha256Json: inputs.sha256Json,
  };
}

class PilotDone extends Error {
  override name = "PilotDone";
  constructor(readonly pageKey: string) {
    super("pilot: one page captured");
  }
}

const SAMPLE_FEATURES = 3;

/** [xmin, ymin, xmax, ymax] of an Esri geometry (rings, paths, points or a single x/y). */
function boundsOf(geometry: unknown): [number, number, number, number] | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      if (v.length >= 2 && typeof v[0] === "number" && typeof v[1] === "number") {
        xs.push(v[0]);
        ys.push(v[1]);
      } else for (const x of v) walk(x);
    }
  };
  if (geometry === null || typeof geometry !== "object") return null;
  const g = geometry as Record<string, unknown>;
  if (typeof g.x === "number" && typeof g.y === "number") {
    xs.push(g.x);
    ys.push(g.y);
  }
  for (const key of ["rings", "paths", "points"]) walk(g[key]);
  if (xs.length === 0) return null;
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** What the pilot's one page shows: counts, field names, geometry type, 3 sample bounds. */
function pageSummary(body: Buffer | null, oid: string): Record<string, unknown> | null {
  if (body === null) return null;
  const page = JSON.parse(body.toString("utf8")) as {
    geometryType?: string;
    fields?: Array<{ name?: string }>;
    features?: Array<{ attributes?: Record<string, unknown>; geometry?: unknown }>;
  };
  const features = page.features ?? [];
  const fields =
    page.fields?.flatMap((f) => (typeof f.name === "string" ? [f.name] : [])) ??
    Object.keys(features[0]?.attributes ?? {});
  return {
    feature_count: features.length,
    geometry_type: page.geometryType ?? null,
    fields,
    // OBJECTID and bounds only: no attribute value besides the object id
    sample: features.slice(0, SAMPLE_FEATURES).map((f) => ({
      [oid]: f.attributes?.[oid] ?? null,
      bounds: boundsOf(f.geometry),
    })),
  };
}

const STALE = ["receipts.jsonl", "complete.json", "blocked.json", "failed.json", "pilot.json"];

export interface RunnerDeps {
  config: RunnerConfig;
  outDir: string;
  source: SourceClient;
  sleep: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => Date;
  out?: ArtifactWriter;
}

const iso = (d: Date): string => d.toISOString();
const round2 = (v: number): number => Math.round(v * 100) / 100;

export async function runGisCapture(deps: RunnerDeps): Promise<RunResult> {
  const now = deps.now ?? (() => new Date());
  const cfg = deps.config;
  for (const f of STALE) rmSync(resolve(deps.outDir, f), { force: true });
  const out = deps.out ?? dirWriter(deps.outDir);
  const kit = await loadKit();
  const startedAt = now();
  const mode = cfg.mode;
  let features = 0;
  let pages = 0;

  const fail = (code: string, message: string, diagnostic?: GisDiagnostic | null): RunResult => {
    out.write(
      "failed.json",
      `${JSON.stringify(
        {
          outcome: "failed",
          code,
          message,
          failed_at: iso(now()),
          pages,
          features,
          ...(diagnostic ? { diagnostic } : {}),
        },
        null,
        2,
      )}\n`,
    );
    return { status: "failed", exitCode: 1, pages, features };
  };

  // Layer metadata first, through the same client (no geometry, no page fields).
  const metaClient = createGeometryClient({
    source: deps.source,
    out,
    outFields: [],
    pageKeyOf: (ids) => kit.sha256Json(ids),
    sleep: deps.sleep,
    ...(deps.random ? { random: deps.random } : {}),
    now,
  });
  let meta: z.infer<typeof LayerMeta>;
  try {
    meta = LayerMeta.parse(
      (await metaClient.json(`${cfg.layerUrl.replace(/\/+$/, "")}?f=json`)).body,
    );
  } catch (error) {
    if (error instanceof GisBlockedError) return blocked(error);
    return fail("layer_metadata_unusable", error instanceof Error ? error.message : String(error));
  }
  const oid =
    meta.objectIdField ??
    meta.fields.find((f) => f.type === "esriFieldTypeOID")?.name ??
    "OBJECTID";
  const layerFields = new Set(meta.fields.map((f) => f.name.toUpperCase()));
  const outFields = [oid, ...cfg.outFields.filter((f) => f.toUpperCase() !== oid.toUpperCase())];
  const missing = outFields.filter((f) => !layerFields.has(f.toUpperCase()));
  const pageSize = Math.min(MAX_PAGE_SIZE, cfg.bulkPageSize, meta.maxRecordCount ?? MAX_PAGE_SIZE);
  const concurrency = mode === "pilot" ? 1 : Math.min(MAX_PAGES_IN_FLIGHT, cfg.bulkConcurrency);
  const lastEdit = meta.editingInfo?.lastEditDate;
  const layerLastEditDate = lastEdit === undefined ? null : new Date(lastEdit).toISOString();
  out.write(
    "config.json",
    `${JSON.stringify({ ...cfg, objectIdField: oid, effectiveOutFields: outFields, pageSize, concurrency, layerLastEditDate }, null, 2)}\n`,
  );
  if (missing.length > 0) {
    return fail("out_field_not_in_layer", `outFields not in the layer: ${missing.join(", ")}`);
  }

  const client = createGeometryClient({
    source: deps.source,
    out,
    outFields,
    pageKeyOf: (ids) => kit.sha256Json(ids),
    sleep: deps.sleep,
    ...(deps.random ? { random: deps.random } : {}),
    now,
  });

  function blocked(error: GisBlockedError): RunResult {
    out.write(
      "blocked.json",
      `${JSON.stringify(
        {
          outcome: "blocked",
          reason: error.reason,
          ...(error.httpStatus === null ? {} : { http_status: error.httpStatus }),
          blocked_at: error.blockedAt,
          last_page_key: error.pageKey,
          pages,
          features,
        },
        null,
        2,
      )}\n`,
    );
    return { status: "blocked", exitCode: 2, pages, features };
  }

  const adapter = kit.createAdapter(
    {
      key: "travis-county-gis",
      adapterConfig: {
        sourceSystem: "travis-county-gis-parcels",
        layerUrl: cfg.layerUrl,
        objectIdField: oid,
        parcelField: null,
        fieldMap: cfg.pidField === null ? {} : { parcelIdentifier: cfg.pidField },
        bulkPageSize: pageSize,
        bulkConcurrency: MAX_PAGES_IN_FLIGHT,
      },
    },
    { client, countyKey: "travis", countyName: "Travis" },
  );

  try {
    const result = await adapter.enumerateAll({
      pageConcurrency: concurrency,
      loadPageCheckpoint: async (p) => {
        const raw = out.read(`checkpoints/${p.objectIdsSha256}.json`);
        if (raw === null) return null;
        const cp = Checkpoint.safeParse(JSON.parse(raw.toString("utf8")));
        if (!cp.success) return null;
        const body = out.read(`pages/${p.objectIdsSha256}.json`);
        const c = cp.data;
        if (
          body === null ||
          sha256Hex(body) !== c.sha256 ||
          c.snapshotSha256 !== p.snapshotSha256 ||
          c.objectIdsSha256 !== p.objectIdsSha256 ||
          c.receivedCount !== p.objectIds.length
        ) {
          return null;
        }
        out.appendReceipt({
          url: c.url,
          http_status: 200,
          bytes: body.byteLength,
          sha256: c.sha256,
          captured_at: c.captured_at,
          outcome: "skipped_checkpoint",
          attempts: 0,
          ua: USER_AGENT,
          page_key: c.objectIdsSha256,
          kind: "page",
        });
        pages += 1;
        features += c.receivedCount;
        return c;
      },
      onPage: async (p) => {
        const receipt = client.pageReceipt(p.objectIdsSha256);
        if (receipt === undefined) throw new Error(`gis: page ${p.pageKey} has no receipt`);
        out.write(
          `checkpoints/${p.objectIdsSha256}.json`,
          `${JSON.stringify({
            status: "complete",
            snapshotSha256: p.snapshotSha256,
            objectIdsSha256: p.objectIdsSha256,
            receivedCount: p.receivedCount,
            page_key: p.objectIdsSha256,
            page_index: p.pageIndex,
            sha256: receipt.sha256,
            url: receipt.url,
            captured_at: receipt.captured_at,
          })}\n`,
        );
        pages += 1;
        features += p.receivedCount;
        if (mode === "pilot") throw new PilotDone(p.objectIdsSha256);
      },
    });
    const finishedAt = now();
    const durationS = round2((finishedAt.getTime() - startedAt.getTime()) / 1000);
    out.write(
      "complete.json",
      `${JSON.stringify(
        {
          mode,
          pages: result.pageCount,
          features: result.receivedCount,
          started_at: iso(startedAt),
          finished_at: iso(finishedAt),
          duration_s: durationS,
          features_per_s: durationS > 0 ? round2(result.receivedCount / durationS) : 0,
          snapshot_sha256: result.snapshotSha256,
          source_count: result.sourceCount,
          page_size: pageSize,
          concurrency,
          object_id_field: oid,
          layer_last_edit_date: layerLastEditDate,
        },
        null,
        2,
      )}\n`,
    );
    return {
      status: "complete",
      exitCode: 0,
      pages: result.pageCount,
      features: result.receivedCount,
    };
  } catch (error) {
    await client.drain();
    if (error instanceof PilotDone) {
      const count = JSON.parse(out.read("count.json")?.toString("utf8") ?? "{}") as {
        count?: number;
      };
      out.write(
        "pilot.json",
        `${JSON.stringify(
          {
            mode,
            pages,
            features,
            count: count.count ?? null,
            started_at: iso(startedAt),
            finished_at: iso(now()),
            page_size: pageSize,
            concurrency,
            object_id_field: oid,
            layer_fields: meta.fields.map((f) => f.name),
            max_record_count: meta.maxRecordCount ?? null,
            supports_pagination: meta.supportsPagination ?? null,
            layer_last_edit_date: layerLastEditDate,
            page: pageSummary(out.read(`pages/${error.pageKey}.json`), oid),
          },
          null,
          2,
        )}\n`,
      );
      return { status: "pilot", exitCode: 0, pages, features };
    }
    const stop = client.stopped();
    if (error instanceof GisBlockedError) return blocked(error);
    if (stop instanceof GisBlockedError) return blocked(stop);
    const code = (error as { code?: unknown }).code;
    const diagnostic = stop instanceof GisRequestError ? stop.diagnostic : null;
    return fail(
      typeof code === "string" ? code : (stop?.name ?? "runner_error"),
      error instanceof Error ? error.message : String(error),
      diagnostic,
    );
  }
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: readonly string[]): Promise<number> {
  const log = createLogger();
  const configPath = flag(argv, "config");
  const outDir = flag(argv, "out");
  if (configPath === undefined || outDir === undefined) {
    log.error("gis.runner.usage", {
      usage: "runner-fetch.ts --config <runner-config.json> --out <dir>",
    });
    return 64;
  }
  const config = RunnerConfig.parse(JSON.parse(readFileSync(configPath, "utf8")));
  const result = await runGisCapture({
    config,
    outDir,
    source: createSourceClient(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  log.info("gis.runner.done", { ...result, mode: config.mode });
  return result.exitCode;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
