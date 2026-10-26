// A-04 T041 (agent-design § 2, contracts/gis-runner.md): the `options.client` injected into the
// vendored kit ArcGIS adapter. The kit calls `json(url)`; this client
//
// - rewrites ONLY the `objectIds=` page queries to ask for geometry: `returnGeometry=true`,
//   `outSR=4326`, `geometryPrecision=7` and the minimal `outFields` (object id + pID/geoID
//   fields, never an owner or address column); count and ids queries pass through unchanged;
// - sends every request through travis/lib/source-client.ts (one project User-Agent,
//   HOST_POLICY: GIS ≤ 2 in flight) one attempt at a time, and owns the retry: a timeout, 429,
//   5xx or network error waits backoffDelayMs (1 s base, 60 s cap, full jitter) and tries again,
//   5 attempts in all, then gives up as `blocked` with `blocked_at`;
// - stops on the first 403 or challenge with no retry, and after any stop makes no further
//   request (every later call throws without touching the network);
// - writes the raw body and its receipt BEFORE returning (pages/<pageKey>.json, pageKey = the
//   kit's objectIdsSha256 of the page's ids; meta.json, count.json, ids.json).
// The runner never touches the Query DB; this file only writes the artifact folder.
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { redact } from "../lib/log.js";
import {
  backoffDelayMs,
  MAX_ATTEMPTS,
  stopClass,
  USER_AGENT,
  type CaptureReceipt,
  type SourceClient,
} from "../lib/source-client.js";

export const GEOMETRY_PARAMS = { returnGeometry: "true", outSR: "4326", geometryPrecision: "7" };

export type RequestKind = "meta" | "count" | "ids" | "page" | "other";
export type ReceiptOutcome = "ok" | "blocked" | "error" | "skipped_checkpoint";

/** One line of receipts.jsonl (contracts/gis-runner.md) plus the request kind. */
export interface GisReceipt {
  url: string;
  http_status: number | null;
  bytes: number;
  sha256: string;
  captured_at: string;
  outcome: ReceiptOutcome;
  attempts: number;
  ua: string;
  page_key: string | null;
  kind: RequestKind;
  /** "POST" for page queries (the ids travel in the form body, never in the URL). */
  method?: "GET" | "POST";
  blocked_at?: string;
  /** Non-ok answers: the content-type and the scrubbed first EXCERPT_CHARS of the body. */
  content_type?: string | null;
  excerpt?: string;
}

export const EXCERPT_CHARS = 300;

/** Why a stop happened, for failed.json: never request headers, body scrubbed and cut. */
export interface GisDiagnostic {
  kind: "not_json" | "arcgis_error" | "http_status";
  http_status: number | null;
  content_type: string | null;
  bytes: number;
  excerpt: string;
  arcgis_error?: { code: number | string | null; message: string | null };
}

/** The first 300 characters of a body, through the same redaction as stop evidence. */
export function scrubExcerpt(body: Buffer): string {
  return redact(body.subarray(0, 4096).toString("utf8")).slice(0, EXCERPT_CHARS);
}

/** Where the runner keeps its artifact (`out/`): relative paths only. */
export interface ArtifactWriter {
  write(relPath: string, body: Buffer | string): void;
  read(relPath: string): Buffer | null;
  appendReceipt(receipt: GisReceipt): void;
}

export function dirWriter(root: string): ArtifactWriter {
  return {
    write(relPath, body) {
      const path = join(root, relPath);
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, body);
      renameSync(tmp, path);
    },
    read(relPath) {
      const path = join(root, relPath);
      return existsSync(path) ? readFileSync(path) : null;
    },
    appendReceipt(receipt) {
      mkdirSync(root, { recursive: true });
      appendFileSync(join(root, "receipts.jsonl"), `${JSON.stringify(receipt)}\n`);
    },
  };
}

export const sha256Hex = (body: Buffer | string): string =>
  createHash("sha256").update(body).digest("hex");

export type StopReason = "http_403" | "challenge" | "gave_up" | "request_error";

/** The run stopped: a 403/challenge (never retried) or 5 failed attempts. */
export class GisBlockedError extends Error {
  override name = "GisBlockedError";
  constructor(
    readonly reason: Exclude<StopReason, "request_error">,
    readonly blockedAt: string,
    readonly httpStatus: number | null,
    readonly pageKey: string | null,
    readonly url: string,
  ) {
    super(
      `gis: blocked (${reason}) at ${blockedAt}${httpStatus === null ? "" : ` HTTP ${httpStatus}`}`,
    );
  }
}

/** A non-retryable answer (400/404/414/unparseable body): stops the run as a failure. */
export class GisRequestError extends Error {
  override name = "GisRequestError";
  constructor(
    readonly httpStatus: number | null,
    readonly url: string,
    message: string,
    readonly diagnostic: GisDiagnostic | null = null,
  ) {
    super(message);
  }
}

/** A call after the run stopped: no request is made. */
export class GisStoppedError extends Error {
  override name = "GisStoppedError";
}

export interface GeometryClientOptions {
  source: SourceClient;
  out: ArtifactWriter;
  /** Minimal page fields: the object id field first, then the pID / geoID fields. */
  outFields: readonly string[];
  /** The kit's page identity digest (sha256Json of the page's string ids). */
  pageKeyOf: (objectIds: readonly string[]) => string;
  sleep: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => Date;
}

export interface GeometryClient {
  /** The kit seam: `{ body }` of one JSON GET. */
  json(url: string): Promise<{ body: unknown }>;
  /** Waits for every request in flight to settle (used before writing blocked.json). */
  drain(): Promise<void>;
  /** The receipt of the page fetched in this run under `pageKey`, if any. */
  pageReceipt(pageKey: string): GisReceipt | undefined;
  /** The stop that ended the run, or null. */
  stopped(): GisBlockedError | GisRequestError | null;
  /** Total requests sent to the source (attempts included). */
  requests(): number;
}

export function requestKind(url: URL): RequestKind {
  const p = url.searchParams;
  if (p.has("objectIds")) return "page";
  if (p.get("returnCountOnly") === "true") return "count";
  if (p.get("returnIdsOnly") === "true") return "ids";
  if (!url.pathname.endsWith("/query") && p.get("f") === "json") return "meta";
  return "other";
}

/**
 * Page queries only: the POST for the kit's `objectIds=` GET. The ids (up to 2,000, ~14 KB)
 * go in a form body (f, outFields, returnGeometry, outSR, geometryPrecision, objectIds); the
 * URL stays the layer's /query path, so the receipt URL never holds the ids.
 */
export function pageRequest(
  url: URL,
  outFields: readonly string[],
): { url: URL; receiptUrl: URL; formBody: string } {
  const form = new URLSearchParams();
  form.set("f", url.searchParams.get("f") ?? "json");
  form.set("outFields", outFields.join(","));
  form.set("returnGeometry", GEOMETRY_PARAMS.returnGeometry);
  form.set("outSR", GEOMETRY_PARAMS.outSR);
  form.set("geometryPrecision", GEOMETRY_PARAMS.geometryPrecision);
  form.set("objectIds", url.searchParams.get("objectIds") ?? "");
  const formBody = form.toString();
  const target = new URL(url.origin + url.pathname);
  form.delete("objectIds");
  // the receipt names the POST parameters (never the ids; the page is identified by its key)
  const receiptUrl = new URL(target.href);
  receiptUrl.search = form.toString();
  return { url: target, receiptUrl, formBody };
}

const retryable = (r: CaptureReceipt): boolean =>
  (r.outcome === "blocked" && r.blocked_reason === "timeout") ||
  (r.outcome === "failed" && (r.status === null || r.status === 429 || r.status >= 500));

export function createGeometryClient(options: GeometryClientOptions): GeometryClient {
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const inFlight = new Set<Promise<unknown>>();
  const pages = new Map<string, GisReceipt>();
  const seen = new Map<RequestKind, number>();
  let stop: GisBlockedError | GisRequestError | null = null;
  let sent = 0;

  const fileFor = (kind: RequestKind, pageKey: string | null): string => {
    if (kind === "page") return `pages/${pageKey ?? "unknown"}.json`;
    const n = (seen.get(kind) ?? 0) + 1;
    seen.set(kind, n);
    return n === 1 ? `${kind}.json` : `${kind}.end.json`;
  };

  // read through a function: another in-flight call may set `stop` while this one awaits
  const halted = (): GisBlockedError | GisRequestError | null => stop;
  const refuseIfStopped = (): void => {
    const h = halted();
    if (h !== null) throw new GisStoppedError(`gis: run stopped (${h.message}); no request made`);
  };

  const diagnosticOf = (
    kind: GisDiagnostic["kind"],
    status: number | null,
    res: { body: Buffer; headers: Record<string, string> },
  ): GisDiagnostic => ({
    kind,
    http_status: status,
    content_type: res.headers["content-type"] ?? null,
    bytes: res.body.byteLength,
    excerpt: scrubExcerpt(res.body),
  });

  async function fetchOnce(input: string): Promise<{ body: unknown }> {
    refuseIfStopped();
    const original = new URL(input);
    const kind = requestKind(original);
    const page = kind === "page" ? pageRequest(original, options.outFields) : null;
    const url = (page?.url ?? original).href;
    const receiptUrl = (page?.receiptUrl ?? original).href;
    const pageKey =
      kind === "page"
        ? options.pageKeyOf(
            (original.searchParams.get("objectIds") ?? "").split(",").filter(Boolean),
          )
        : null;
    const receiptOf = (
      r: CaptureReceipt,
      outcome: ReceiptOutcome,
      attempts: number,
      res: { body: Buffer; headers: Record<string, string> },
      blockedAt?: string,
    ): GisReceipt => {
      const body = res.body;
      return {
        url: receiptUrl,
        http_status: r.status,
        bytes: body.byteLength,
        sha256: sha256Hex(body),
        captured_at: r.captured_at,
        outcome,
        attempts,
        ua: r.user_agent,
        page_key: pageKey,
        kind,
        ...(page === null ? {} : { method: "POST" as const }),
        ...(blockedAt === undefined ? {} : { blocked_at: blockedAt }),
        ...(outcome === "ok" || outcome === "skipped_checkpoint"
          ? {}
          : { content_type: res.headers["content-type"] ?? null, excerpt: scrubExcerpt(body) }),
      };
    };

    for (let attempt = 1; ; attempt += 1) {
      refuseIfStopped();
      sent += 1;
      const res = await options.source.capture({
        url,
        maxAttempts: 1,
        accept: "application/json",
        ...(page === null ? {} : { method: "POST" as const, formBody: page.formBody }),
      });
      const r = res.receipt;
      if (r.outcome === "ok" || r.outcome === "throttled-then-ok") {
        let body: unknown;
        try {
          body = JSON.parse(res.body.toString("utf8"));
        } catch {
          options.out.appendReceipt(receiptOf(r, "error", attempt, res));
          stop = new GisRequestError(
            r.status,
            url,
            `gis: ${kind} answer is not JSON`,
            diagnosticOf("not_json", r.status, res),
          );
          throw stop;
        }
        const arcgisError =
          typeof body === "object" && body !== null && "error" in body && !("features" in body);
        options.out.write(fileFor(kind, pageKey), res.body);
        const receipt = receiptOf(r, arcgisError ? "error" : "ok", attempt, res);
        options.out.appendReceipt(receipt);
        if (kind === "page" && pageKey !== null && !arcgisError) pages.set(pageKey, receipt);
        // an ArcGIS error payload is returned as is: the kit refuses it (arcgis_query_failed)
        if (arcgisError) {
          const e = (body as { error: { code?: unknown; message?: unknown } }).error;
          const detail = {
            code: typeof e?.code === "number" || typeof e?.code === "string" ? e.code : null,
            message:
              typeof e?.message === "string" ? redact(e.message).slice(0, EXCERPT_CHARS) : null,
          };
          stop = new GisRequestError(
            r.status,
            url,
            `gis: ${kind} answered an ArcGIS error (${detail.code ?? "no code"}: ${detail.message ?? "no message"})`,
            { ...diagnosticOf("arcgis_error", r.status, res), arcgis_error: detail },
          );
        }
        return { body };
      }
      if (stopClass(r) === "blocked") {
        const at = now().toISOString();
        options.out.appendReceipt(receiptOf(r, "blocked", attempt, res, at));
        stop = new GisBlockedError(
          r.blocked_reason === "challenge" ? "challenge" : "http_403",
          at,
          r.status,
          pageKey,
          url,
        );
        throw stop;
      }
      if (retryable(r)) {
        if (attempt >= MAX_ATTEMPTS) {
          const at = now().toISOString();
          options.out.appendReceipt(receiptOf(r, "blocked", attempt, res, at));
          stop = new GisBlockedError("gave_up", at, r.status, pageKey, url);
          throw stop;
        }
        await options.sleep(backoffDelayMs(attempt, random));
        continue;
      }
      options.out.appendReceipt(receiptOf(r, "error", attempt, res));
      stop = new GisRequestError(
        r.status,
        url,
        `gis: ${kind} answered HTTP ${r.status ?? "none"}`,
        diagnosticOf("http_status", r.status, res),
      );
      throw stop;
    }
  }

  return {
    json(url) {
      const p = fetchOnce(url);
      inFlight.add(p);
      void p.then(
        () => inFlight.delete(p),
        () => inFlight.delete(p),
      );
      return p;
    },
    async drain() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
    pageReceipt: (key) => pages.get(key),
    stopped: () => stop,
    requests: () => sent,
  };
}

/** The receipt `ua` of every request: the single project User-Agent. */
export const RUNNER_USER_AGENT = USER_AGENT;
