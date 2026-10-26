// travis-places@1.0.0: constants, Zod schemas and the RFC 8785 canonical form (no data here,
// so the build script can import it before the JSON files exist).
import { z } from "zod";

export const GAZETTEER_VERSION = "travis-places@1.0.0";
export const TRAVIS_FIPS = "48453";
/** Regional (neighbouring) counties for owner_area_class = regional. */
export const REGIONAL_COUNTY_FIPS = [
  "48491", // Williamson
  "48209", // Hays
  "48021", // Bastrop
  "48055", // Caldwell
  "48053", // Burnet
  "48031", // Blanco
] as const;

export const ZCTA_BITMAP_ENCODING =
  "bitmap: 100000 bits, bit n (MSB-first within each byte) set when the 5-digit code n is a ZCTA; base64";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Fips = z.string().regex(/^\d{5}$/);
const Zcta = z.string().regex(/^\d{5}$/);
const CensusUrl = z.string().url().startsWith("https://www2.census.gov/");

export const SourceFile = z.object({
  key: z.enum(["place", "zcta", "zctaCounty", "placeCounty"]),
  url: CensusUrl,
  last_modified: z.string().datetime(),
  retrieved_at: z.string().datetime(),
  bytes: z.number().int().positive(),
  sha256: Sha256,
  vintage: z.string(),
  note: z.string().optional(),
});
export const SourcesFile = z.array(SourceFile).length(4);

export const PlaceRow = z.object({
  geoid: z.string().regex(/^48\d{5}$/),
  name: z.string().min(1),
  name_lsad: z.string().min(1),
  lsad: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  counties: z.array(Fips).min(1),
  partial_in_travis: z.boolean(),
  source_file: CensusUrl,
});
export type PlaceRow = z.infer<typeof PlaceRow>;

export const ZctaRow = z.object({
  zcta: Zcta,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  counties: z.array(Fips).min(1),
  partial_in_travis: z.boolean(),
  source_file: CensusUrl,
});
export type ZctaRow = z.infer<typeof ZctaRow>;

export const OwnerAreaFile = z.object({
  travis_county_fips: z.literal(TRAVIS_FIPS),
  regional_county_fips: z.array(Fips),
  travis_zctas: z.array(Zcta),
  regional_zctas: z.array(Zcta),
  all_us_zctas: z.object({
    count: z.number().int().positive(),
    /** sha256 of the sorted 5-digit codes joined by "\n". */
    sha256: Sha256,
    encoding: z.literal(ZCTA_BITMAP_ENCODING),
    bitmap_base64: z.string().regex(/^[A-Za-z0-9+/]+=*$/),
  }),
  source_files: z.array(CensusUrl),
});
export type OwnerAreaFile = z.infer<typeof OwnerAreaFile>;

export interface SourceStamp {
  url: string;
  file_date: string;
  sha256: string;
}

const ZCTA_SPACE = 100_000;

// base64 through the WHATWG atob/btoa globals (Node and browsers), not Buffer (Node only).
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encodes a set of 5-digit codes as a base64 bitmap over 00000–99999. */
export function encodeZctaBitmap(codes: Iterable<string>): string {
  const bytes = new Uint8Array(ZCTA_SPACE / 8);
  for (const code of codes) {
    if (!/^\d{5}$/.test(code)) throw new Error(`not a 5-digit code: ${code}`);
    const n = Number(code);
    bytes[n >> 3] = (bytes[n >> 3] ?? 0) | (0x80 >> (n & 7));
  }
  return toBase64(bytes);
}

/** Decodes the bitmap to the sorted list of 5-digit codes. */
export function decodeZctaBitmap(base64: string): string[] {
  const bytes = fromBase64(base64);
  if (bytes.length !== ZCTA_SPACE / 8) throw new Error("ZCTA bitmap has the wrong length");
  const out: string[] = [];
  for (let n = 0; n < ZCTA_SPACE; n += 1) {
    if (((bytes[n >> 3] ?? 0) & (0x80 >> (n & 7))) !== 0) out.push(String(n).padStart(5, "0"));
  }
  return out;
}

/**
 * RFC 8785 JSON Canonicalization Scheme. Keys sort by UTF-16 code units (JS default sort);
 * numbers and strings use the ECMAScript JSON serialisation the RFC adopts.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalize: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  throw new Error(`canonicalize: unsupported ${typeof value}`);
}
