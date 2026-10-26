// SYNTHETIC TEST INPUT (A-04 T041): an in-process fake of an ArcGIS MapServer layer. No network:
// it is handed to createSourceClient({ fetch }) in place of the real fetch. Every feature is
// made up (square polygons near Austin, OBJECTID 1..n, PROP_ID "9" + id, GEO_ID "0" + id) and
// carries an OWNER_NAME sentinel that must never reach an artifact.
import { squareAt } from "./polygons.js";

export const FAKE_LAYER =
  "https://gis.traviscountytx.gov/server1/rest/services/CIPStoryMap/Main_Location_Map2/MapServer/6";
export const OWNER_SENTINEL = "ZZSYNTHETICOWNERSENTINEL";

export type PageAnswer = "timeout" | number | undefined;

/** What the fake saw of one request (never the headers' values beyond content-type). */
export interface FakeRequest {
  method: string;
  url: string;
  contentType: string | null;
  body: string | null;
}

export interface FakeEvent {
  type: "start" | "end";
  url: string;
  kind: "meta" | "count" | "ids" | "page" | "other";
  status?: number;
  pageNo?: number;
}

export interface FakeOptions {
  total: number;
  maxRecordCount?: number;
  /** Ids served by the snapshot queries after the first pair (drift case). */
  endTotal?: number;
  latencyMs?: number;
  /** Return an HTTP status or "timeout" for a page (1-based by first id order); undefined = 200. */
  page?: (pageNo: number, attempt: number) => PageAnswer;
  /** Answer a page with a raw body (an HTML page, a 200 JSON error envelope). */
  pageRaw?: (pageNo: number) => { status: number; contentType: string; body: string } | undefined;
  fields?: string[];
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function fakeArcgis(options: FakeOptions) {
  const events: FakeEvent[] = [];
  const requests: FakeRequest[] = [];
  const pageAttempts = new Map<number, number>();
  let inFlightPages = 0;
  let maxInFlightPages = 0;
  let snapshots = 0;
  const pageSizeSeen: number[] = [];
  const fields = options.fields ?? ["OBJECTID", "PROP_ID", "GEO_ID", "OWNER_NAME", "SITUS_ADDR"];
  let firstPageSize: number | null = null;

  const ids = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

  const fetch = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    const rawBody = typeof init.body === "string" ? init.body : null;
    requests.push({
      method: init.method ?? "GET",
      url: input,
      contentType: headers.get("content-type"),
      body: rawBody,
    });
    // a POSTed form body carries the same parameters a GET carries in its query string
    const p = new URLSearchParams(url.search);
    if (init.method === "POST" && rawBody !== null) {
      for (const [k, v] of new URLSearchParams(rawBody)) p.set(k, v);
    }
    // events show the logical query (path + merged parameters) whether it came as GET or POST
    const logical = `${url.origin}${url.pathname}?${p.toString()}`;
    const kind: FakeEvent["kind"] = p.has("objectIds")
      ? "page"
      : p.get("returnCountOnly") === "true"
        ? "count"
        : p.get("returnIdsOnly") === "true"
          ? "ids"
          : url.pathname.endsWith("/query")
            ? "other"
            : "meta";
    const ev: FakeEvent = { type: "start", url: logical, kind };
    events.push(ev);
    const end = (r: Response, pageNo?: number): Response => {
      events.push({
        type: "end",
        url: logical,
        kind,
        status: r.status,
        ...(pageNo === undefined ? {} : { pageNo }),
      });
      return r;
    };
    if (options.latencyMs) await new Promise((r) => setTimeout(r, options.latencyMs));

    if (kind === "meta") {
      return end(
        json({
          name: "synthetic parcels",
          objectIdField: "OBJECTID",
          maxRecordCount: options.maxRecordCount ?? 2000,
          supportsPagination: true,
          editingInfo: { lastEditDate: 1760000000000 },
          fields: fields.map((name) => ({
            name,
            type: name === "OBJECTID" ? "esriFieldTypeOID" : "esriFieldTypeString",
          })),
        }),
      );
    }
    if (kind === "count" || kind === "ids") {
      snapshots += 1;
      const n = snapshots > 2 && options.endTotal !== undefined ? options.endTotal : options.total;
      return end(
        kind === "count"
          ? json({ count: n })
          : json({ objectIdFieldName: "OBJECTID", objectIds: ids(n) }),
      );
    }
    if (kind === "page") {
      const pageIds = (p.get("objectIds") ?? "").split(",").map(Number);
      pageSizeSeen.push(pageIds.length);
      firstPageSize ??= pageIds.length;
      const pageNo = Math.floor(((pageIds[0] ?? 1) - 1) / (firstPageSize || 1)) + 1;
      const attempt = (pageAttempts.get(pageNo) ?? 0) + 1;
      pageAttempts.set(pageNo, attempt);
      const raw = options.pageRaw?.(pageNo);
      if (raw !== undefined) {
        return end(
          new Response(raw.body, {
            status: raw.status,
            headers: { "content-type": raw.contentType },
          }),
          pageNo,
        );
      }
      const answer = options.page?.(pageNo, attempt);
      if (answer === "timeout") {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            events.push({ type: "end", url: logical, kind, pageNo });
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
      }
      if (typeof answer === "number")
        return end(new Response("refused", { status: answer }), pageNo);
      inFlightPages += 1;
      maxInFlightPages = Math.max(maxInFlightPages, inFlightPages);
      await new Promise((r) => setTimeout(r, options.latencyMs ?? 0));
      inFlightPages -= 1;
      const out = (p.get("outFields") ?? "*").split(",");
      const geometry = p.get("returnGeometry") === "true";
      const features = pageIds.map((id) => {
        const all: Record<string, unknown> = {
          OBJECTID: id,
          PROP_ID: `9${id}`,
          GEO_ID: `0${id}`,
          OWNER_NAME: OWNER_SENTINEL,
          SITUS_ADDR: "1 SYNTHETIC ST",
        };
        const attributes = Object.fromEntries(
          Object.entries(all).filter(([k]) => out.includes("*") || out.includes(k)),
        );
        return geometry ? { attributes, geometry: squareAt(id * 30, 0, 10) } : { attributes };
      });
      return end(
        json({ objectIdFieldName: "OBJECTID", geometryType: "esriGeometryPolygon", features }),
        pageNo,
      );
    }
    return end(json({ error: { code: 400, message: "unexpected query" } }));
  };

  return {
    fetch,
    events,
    requests,
    pageAttempts,
    pageSizeSeen,
    maxInFlightPages: () => maxInFlightPages,
  };
}

/** Seeded PRNG (mulberry32) so jittered waits are reproducible. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
