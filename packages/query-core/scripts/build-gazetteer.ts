// T029 (A-02, FR-006 / research R-08): build travis-places@1.0.0 from public US Census files.
//
//   pnpm --filter @countylens/query-core build-gazetteer          # download once, then build
//   pnpm --filter @countylens/query-core build-gazetteer --offline  # rebuild from the raw folder
//
// Each source file is fetched with ONE identified request. A 403 (or any non-200) stops the
// run; there is no retry and no other identity. Raw files and their receipts stay in the
// gitignored pipeline/data/raw/census/; only the filtered JSON and DIGEST are written to git.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { z } from "zod";
import {
  GAZETTEER_VERSION,
  REGIONAL_COUNTY_FIPS,
  TRAVIS_FIPS,
  canonicalize,
  ZCTA_BITMAP_ENCODING,
  encodeZctaBitmap,
  type OwnerAreaFile,
  type PlaceRow,
  type SourceStamp,
  type ZctaRow,
} from "../gazetteer/travis-places@1.0.0/schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const RAW_DIR = join(repoRoot, "pipeline/data/raw/census");
const OUT_DIR = resolve(here, `../gazetteer/${GAZETTEER_VERSION}`);
const USER_AGENT =
  "countylens-gazetteer-build/1.0 (oracle-property-intelligence-platform-pipeline-travis-tx; public Census data)";

const GAZ = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer";
const SOURCES = {
  place: { url: `${GAZ}/2024_Gaz_place_national.zip`, file: "2024_Gaz_place_national.zip" },
  zcta: { url: `${GAZ}/2024_Gaz_zcta_national.zip`, file: "2024_Gaz_zcta_national.zip" },
  zctaCounty: {
    url: "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt",
    file: "tab20_zcta520_county20_natl.txt",
  },
  placeCounty: {
    url: "https://www2.census.gov/geo/docs/reference/codes2020/place_by_cou/st48_tx_place_by_county2020.txt",
    file: "st48_tx_place_by_county2020.txt",
  },
} as const;
type SourceKey = keyof typeof SOURCES;

const Receipt = z.object({
  url: z.string().url(),
  last_modified: z.string().min(1),
  retrieved_at: z.string().datetime(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.literal(200),
});
type Receipt = z.infer<typeof Receipt>;

const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
/** Code-unit order: locale-independent, byte-stable output (code-review #5). */
const codeUnitOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One identified GET per file. Reuses an existing raw file only when its receipt matches. */
async function acquire(
  key: SourceKey,
  offline: boolean,
): Promise<{ body: Buffer; receipt: Receipt }> {
  const { url, file } = SOURCES[key];
  const rawPath = join(RAW_DIR, file);
  const receiptPath = `${rawPath}.receipt.json`;
  if (existsSync(rawPath) && existsSync(receiptPath)) {
    const body = readFileSync(rawPath);
    const receipt = Receipt.parse(JSON.parse(readFileSync(receiptPath, "utf8")));
    if (receipt.url !== url || receipt.sha256 !== sha256(body) || receipt.bytes !== body.length) {
      throw new Error(`${file}: raw file does not match its receipt; delete both to re-download`);
    }
    return { body, receipt };
  }
  if (offline) throw new Error(`${file}: not in ${RAW_DIR} and --offline was given`);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "error" });
  if (res.status === 403)
    throw new Error(`${url}: HTTP 403; stopping (no retry, no other identity)`);
  if (res.status !== 200) throw new Error(`${url}: HTTP ${res.status}; stopping`);
  const lastModified = res.headers.get("last-modified");
  if (!lastModified) throw new Error(`${url}: no Last-Modified header`);
  const body = Buffer.from(await res.arrayBuffer());
  const receipt = Receipt.parse({
    url,
    last_modified: new Date(lastModified).toISOString(),
    retrieved_at: new Date().toISOString(),
    bytes: body.length,
    sha256: sha256(body),
    status: 200,
  });
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(rawPath, body);
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { body, receipt };
}

/** Reads the single text entry of a small (non-ZIP64) archive held in memory. */
function unzipSingle(buf: Buffer): string {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip: end of central directory not found");
  if (buf.readUInt16LE(eocd + 10) !== 1) throw new Error("zip: expected exactly one entry");
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error("zip: bad central directory");
  const method = buf.readUInt16LE(cd + 10);
  const compressed = buf.readUInt32LE(cd + 20);
  const local = buf.readUInt32LE(cd + 42);
  if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("zip: bad local header");
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + compressed);
  if (method === 0) return data.toString("utf8");
  if (method === 8) return inflateRawSync(data).toString("utf8");
  throw new Error(`zip: unsupported method ${method}`);
}

/** Parses a delimited Census text file into header-keyed rows (headers and cells trimmed). */
function parseTable(text: string, delimiter: string): Array<Record<string, string>> {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  const header = (lines.shift() ?? "").split(delimiter).map((h) => h.trim());
  return lines.map((line) => {
    const cells = line.split(delimiter);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
}

const GazPlace = z.object({
  USPS: z.string(),
  GEOID: z.string().regex(/^\d{7}$/),
  NAME: z.string().min(1),
  LSAD: z.string(),
  INTPTLAT: z.coerce.number().min(-90).max(90),
  INTPTLONG: z.coerce.number().min(-180).max(180),
});
const GazZcta = z.object({
  GEOID: z.string().regex(/^\d{5}$/),
  INTPTLAT: z.coerce.number().min(-90).max(90),
  INTPTLONG: z.coerce.number().min(-180).max(180),
});
const ZctaCountyRel = z.object({
  GEOID_ZCTA5_20: z.string(),
  GEOID_COUNTY_20: z.string().regex(/^\d{5}$/),
  AREALAND_PART: z.coerce.number().nonnegative(),
});
const PlaceByCounty = z.object({
  STATEFP: z.literal("48"),
  COUNTYFP: z.string().regex(/^\d{3}$/),
  PLACEFP: z.string().regex(/^\d{5}$/),
  PLACENAME: z.string().min(1),
});

/** "Pflugerville city" → "Pflugerville": the Gazetteer NAME carries the LSAD word as a suffix. */
function stripLsadWord(name: string): string {
  return name.replace(/\s+(city|town|village|CDP)$/i, "");
}

function stamp(r: Receipt): SourceStamp {
  return { url: r.url, file_date: r.last_modified, sha256: r.sha256 };
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  const got = {} as Record<SourceKey, { body: Buffer; receipt: Receipt }>;
  for (const key of Object.keys(SOURCES) as SourceKey[]) got[key] = await acquire(key, offline);

  // Place membership by county (2020 vintage; there is no rel2020 place file).
  const placeCounties = new Map<string, Set<string>>();
  for (const raw of parseTable(got.placeCounty.body.toString("utf8"), "|")) {
    const r = PlaceByCounty.parse(raw);
    const geoid = `48${r.PLACEFP}`;
    const set = placeCounties.get(geoid) ?? new Set<string>();
    set.add(`48${r.COUNTYFP}`);
    placeCounties.set(geoid, set);
  }

  // ZCTA membership by county, land only (AREALAND_PART > 0).
  const zctaCounties = new Map<string, Set<string>>();
  for (const raw of parseTable(got.zctaCounty.body.toString("utf8"), "|")) {
    const r = ZctaCountyRel.parse(raw);
    if (!/^\d{5}$/.test(r.GEOID_ZCTA5_20) || r.AREALAND_PART <= 0) continue;
    const set = zctaCounties.get(r.GEOID_ZCTA5_20) ?? new Set<string>();
    set.add(r.GEOID_COUNTY_20);
    zctaCounties.set(r.GEOID_ZCTA5_20, set);
  }

  const placeStamp = stamp(got.place.receipt);
  const zctaStamp = stamp(got.zcta.receipt);
  const sortCounties = (s: Set<string>): string[] =>
    [...s].sort((a, b) => (a === TRAVIS_FIPS ? -1 : b === TRAVIS_FIPS ? 1 : codeUnitOrder(a, b)));

  const places: PlaceRow[] = [];
  const txPlacesWithoutCountyRow: string[] = [];
  for (const raw of parseTable(unzipSingle(got.place.body), "\t")) {
    const r = GazPlace.parse(raw);
    if (r.USPS !== "TX") continue;
    const counties = placeCounties.get(r.GEOID);
    if (!counties) {
      txPlacesWithoutCountyRow.push(`${r.GEOID} ${r.NAME}`);
      continue;
    }
    if (!counties.has(TRAVIS_FIPS)) continue;
    places.push({
      geoid: r.GEOID,
      name: stripLsadWord(r.NAME),
      name_lsad: r.NAME,
      lsad: r.LSAD,
      lat: r.INTPTLAT,
      lon: r.INTPTLONG,
      counties: sortCounties(counties),
      partial_in_travis: counties.size > 1,
      source_file: placeStamp.url,
    });
  }
  places.sort((a, b) => codeUnitOrder(a.geoid, b.geoid));

  const zctas: ZctaRow[] = [];
  const allUsZctas: string[] = [];
  for (const raw of parseTable(unzipSingle(got.zcta.body), "\t")) {
    const r = GazZcta.parse(raw);
    allUsZctas.push(r.GEOID);
    const counties = zctaCounties.get(r.GEOID);
    if (!counties?.has(TRAVIS_FIPS)) continue;
    zctas.push({
      zcta: r.GEOID,
      lat: r.INTPTLAT,
      lon: r.INTPTLONG,
      counties: sortCounties(counties),
      partial_in_travis: counties.size > 1,
      source_file: zctaStamp.url,
    });
  }
  zctas.sort((a, b) => codeUnitOrder(a.zcta, b.zcta));
  allUsZctas.sort();

  const travisZctas = new Set(zctas.map((z) => z.zcta));
  const regional = new Set<string>(REGIONAL_COUNTY_FIPS);
  const regionalZctas = [...zctaCounties]
    .filter(([z, cs]) => !travisZctas.has(z) && [...cs].some((c) => regional.has(c)))
    .map(([z]) => z)
    .sort();

  const allUsJoined = allUsZctas.join("\n");
  const ownerArea: OwnerAreaFile = {
    travis_county_fips: TRAVIS_FIPS,
    regional_county_fips: [...REGIONAL_COUNTY_FIPS],
    travis_zctas: [...travisZctas].sort(),
    regional_zctas: regionalZctas,
    all_us_zctas: {
      count: allUsZctas.length,
      sha256: sha256(allUsJoined),
      encoding: ZCTA_BITMAP_ENCODING,
      bitmap_base64: encodeZctaBitmap(allUsZctas),
    },
    source_files: [zctaStamp.url, SOURCES.zctaCounty.url],
  };

  const sources = (Object.keys(SOURCES) as SourceKey[]).map((key) => {
    const r = got[key].receipt;
    return {
      key,
      url: r.url,
      last_modified: r.last_modified,
      retrieved_at: r.retrieved_at,
      bytes: r.bytes,
      sha256: r.sha256,
      ...(key === "placeCounty"
        ? { vintage: "2020", note: "place-by-county list; no rel2020 place file exists" }
        : {}),
      ...(key === "zctaCounty"
        ? { vintage: "2020", note: "membership uses AREALAND_PART > 0" }
        : {}),
      ...(key === "place" || key === "zcta" ? { vintage: "2024" } : {}),
    };
  });

  const write = (name: string, value: unknown): void =>
    writeFileSync(join(OUT_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
  mkdirSync(OUT_DIR, { recursive: true });
  write("sources.json", sources);
  write("places.json", places);
  write("zctas.json", zctas);
  write("owner-area.json", ownerArea);
  const digest = sha256(
    canonicalize({ version: GAZETTEER_VERSION, places, zctas, "owner-area": ownerArea, sources }),
  );
  writeFileSync(join(OUT_DIR, "DIGEST"), `${digest}\n`);

  const txNoCounty = txPlacesWithoutCountyRow.length;
  process.stdout.write(
    `${JSON.stringify(
      {
        version: GAZETTEER_VERSION,
        digest,
        places: places.length,
        places_partial: places.filter((p) => p.partial_in_travis).length,
        zctas: zctas.length,
        zctas_partial: zctas.filter((z) => z.partial_in_travis).length,
        regional_zctas: regionalZctas.length,
        all_us_zctas: allUsZctas.length,
        tx_gazetteer_places_without_2020_county_row: txNoCounty,
        tx_gazetteer_places_without_2020_county_row_list: txPlacesWithoutCountyRow,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`build-gazetteer: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
