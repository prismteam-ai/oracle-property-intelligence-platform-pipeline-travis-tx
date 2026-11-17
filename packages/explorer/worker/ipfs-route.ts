import type { Publication } from "./publications.js";

export interface ByteRange {
  offset: number;
  length: number;
}

export interface MirrorObject {
  body: ReadableStream | null;
  size: number;
}

export interface MirrorStore {
  head(key: string): Promise<{ size: number } | null>;
  get(key: string, range?: ByteRange): Promise<MirrorObject | null>;
}

export interface IpfsRouteConfig {
  mirror: MirrorStore;
  gateways: readonly string[];
  fetch: typeof fetch;
  publications: () => Promise<Publication[]>;
}

enum RangeKind {
  Whole = "whole",
  Part = "part",
  Unsatisfiable = "unsatisfiable",
}

type RangeRequest =
  | { kind: RangeKind.Whole }
  | { kind: RangeKind.Part; range: ByteRange }
  | { kind: RangeKind.Unsatisfiable };

interface Target {
  ipfsPath: string;
  mirrorKey: string;
  contentType: string;
}

const IPFS_PREFIX = "/ipfs/";
const MIRROR_PREFIX = "ipfs/";
const RANGE_HEADER = /^bytes=(\d*)-(\d*)$/;
const PATH_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const IMMUTABLE = "public, max-age=31536000, immutable";
const SERVED_BY_MIRROR = "r2-mirror";
const GATEWAY_TIMEOUT_MS = 30_000;
const DEFAULT_CONTENT_TYPE = "application/octet-stream";
const JSON_CONTENT_TYPE = "application/json";
const CONTENT_TYPES: Record<string, string> = {
  parquet: "application/vnd.apache.parquet",
  json: JSON_CONTENT_TYPE,
  csv: "text/csv; charset=utf-8",
};
const FORWARDED_GATEWAY_HEADERS = ["content-type", "content-length", "content-range"];

const HttpStatus = {
  Ok: 200,
  PartialContent: 206,
  NotFound: 404,
  RangeNotSatisfiable: 416,
  BadGateway: 502,
} as const;

export class IpfsRoute {
  constructor(private readonly config: IpfsRouteConfig) {}

  async handle(request: Request): Promise<Response> {
    const target = await this.resolve(new URL(request.url).pathname);
    if (!target) return new Response("Not a published CID", { status: HttpStatus.NotFound });

    const stored = await this.config.mirror.head(target.mirrorKey);
    if (!stored) return this.fromGateways(request, target);

    const requested = parseRange(request.headers.get("range"), stored.size);
    if (requested.kind === RangeKind.Unsatisfiable) {
      return new Response(null, {
        status: HttpStatus.RangeNotSatisfiable,
        headers: { "content-range": `bytes */${stored.size}` },
      });
    }

    const headers = new Headers({
      "content-type": target.contentType,
      "accept-ranges": "bytes",
      "cache-control": IMMUTABLE,
      etag: `"${target.ipfsPath}"`,
      "x-served-by": SERVED_BY_MIRROR,
    });
    const range = requested.kind === RangeKind.Part ? requested.range : undefined;
    headers.set("content-length", String(range ? range.length : stored.size));
    if (range) {
      headers.set(
        "content-range",
        `bytes ${range.offset}-${range.offset + range.length - 1}/${stored.size}`,
      );
    }
    const status = range ? HttpStatus.PartialContent : HttpStatus.Ok;
    if (request.method === "HEAD") return new Response(null, { status, headers });

    const object = await this.config.mirror.get(target.mirrorKey, range);
    if (!object) return this.fromGateways(request, target);
    return new Response(object.body, { status, headers });
  }

  private async resolve(pathname: string): Promise<Target | undefined> {
    if (!pathname.startsWith(IPFS_PREFIX)) return undefined;
    const [cid = "", ...segments] = pathname.slice(IPFS_PREFIX.length).split("/");
    const publications = await this.config.publications();

    if (segments.length === 0) {
      return publications.some((publication) => publication.manifestCid === cid)
        ? { ipfsPath: cid, mirrorKey: `${MIRROR_PREFIX}${cid}`, contentType: JSON_CONTENT_TYPE }
        : undefined;
    }
    const isRoot = publications.some((publication) => publication.rootCid === cid);
    if (!isRoot || !segments.every((segment) => PATH_SEGMENT.test(segment))) return undefined;
    const ipfsPath = `${cid}/${segments.join("/")}`;
    return {
      ipfsPath,
      mirrorKey: `${MIRROR_PREFIX}${ipfsPath}`,
      contentType: contentTypeOf(segments.at(-1) ?? ""),
    };
  }

  private async fromGateways(request: Request, target: Target): Promise<Response> {
    const range = request.headers.get("range");
    for (const gateway of this.config.gateways) {
      try {
        const response = await this.config.fetch(`${gateway}${IPFS_PREFIX}${target.ipfsPath}`, {
          method: request.method,
          headers: range ? { range } : {},
          signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
        });
        if (!response.ok) {
          await response.body?.cancel();
          continue;
        }
        const headers = new Headers({
          "accept-ranges": "bytes",
          "cache-control": IMMUTABLE,
          "x-served-by": new URL(gateway).host,
        });
        for (const name of FORWARDED_GATEWAY_HEADERS) {
          const value = response.headers.get(name);
          if (value) headers.set(name, value);
        }
        return new Response(response.body, { status: response.status, headers });
      } catch {}
    }
    return new Response("No public gateway returned the object", {
      status: HttpStatus.BadGateway,
    });
  }
}

function parseRange(header: string | null, size: number): RangeRequest {
  const match = header?.match(RANGE_HEADER);
  const [, start = "", end = ""] = match ?? [];
  if (!match || (start === "" && end === "")) return { kind: RangeKind.Whole };

  if (start === "") {
    const suffix = Number(end);
    if (suffix === 0) return { kind: RangeKind.Unsatisfiable };
    const offset = Math.max(0, size - suffix);
    return { kind: RangeKind.Part, range: { offset, length: size - offset } };
  }

  const offset = Number(start);
  const last = end === "" ? size - 1 : Math.min(Number(end), size - 1);
  if (offset >= size || last < offset) return { kind: RangeKind.Unsatisfiable };
  return { kind: RangeKind.Part, range: { offset, length: last - offset + 1 } };
}

function contentTypeOf(fileName: string): string {
  const extension = fileName.slice(fileName.lastIndexOf(".") + 1);
  return CONTENT_TYPES[extension] ?? DEFAULT_CONTENT_TYPE;
}
