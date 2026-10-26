// T030: the expected jurisdiction set from the U.S. Census Bureau (research R6, FR-004).
//
// Source: the Census Bureau's 2020 FIPS reference file "Place by County" for Texas. It has
// one record per place per county the place extends into, with the FIPS class code. The
// probe keeps incorporated places (CLASSFP C*) in Travis County (state 48, county 453).
//
// Land area: this file has no land-area column. When a file with a land column (ALAND or
// AREALAND) is used, parts with zero land are dropped; otherwise every C* place listed for
// the county is kept and `census_reference.notes` says the land filter could not be applied.
//
// One request through the source client; a 403, a challenge or a body without the expected
// header is `blocked` (never "0 places").
import { z } from "zod";
import type { CaptureReceipt } from "../../lib/source-client.js";
import type { Catalog } from "../catalog.schema.js";
import { missingReason, stopsSource, type ProbeDeps, type ProbeOutcome } from "./common.js";

/** 2020 Census FIPS codes, Place by County, Texas (pipe-delimited, about 160 KB). */
export const CENSUS_PLACE_BY_COUNTY_URL =
  "https://www2.census.gov/geo/docs/reference/codes2020/place_by_cou/st48_tx_place_by_county2020.txt";
export const CENSUS_DATASET =
  "U.S. Census Bureau, 2020 FIPS Codes for Places: Place by County (Texas), st48_tx_place_by_county2020.txt";
export const CENSUS_VINTAGE = "2020";
export const TRAVIS_STATEFP = "48";
export const TRAVIS_COUNTYFP = "453";

const REQUIRED_COLUMNS = ["STATEFP", "COUNTYFP", "PLACEFP", "PLACENAME", "CLASSFP"] as const;
const LAND_COLUMNS = ["ALAND", "AREALAND", "ALAND20"] as const;
const LEGAL_SUFFIX = / (?:city|town|village)$/;

export type CensusReference = NonNullable<Catalog["census_reference"]>;

export interface CensusPlace {
  placefp: string;
  /** Name with its legal description, as printed ("Austin city"). */
  census_name: string;
  /** Name without the legal description ("Austin"). */
  name: string;
  classfp: string;
  /** Land area of the county part in square metres, when the file carries it. */
  land_area_sqm: number | null;
}

export interface CensusProbe extends ProbeOutcome {
  url: string;
  captured_at: string;
  places: CensusPlace[];
  census_reference: CensusReference | null;
  land_area_column: string | null;
  missing_reason: string | null;
}

/** "Austin city" -> "Austin"; "The Hills village" -> "The Hills". */
export function placeShortName(censusName: string): string {
  return censusName.trim().replace(LEGAL_SUFFIX, "");
}

function headerOf(body: string): string[] {
  const first = body.split(/\r?\n/, 1)[0] ?? "";
  return first.split("|").map((c) => c.trim().toUpperCase());
}

/** A body is the file when its first line carries every required column. */
export const PlaceByCountyFile = z.string().refine(
  (body) => {
    const header = headerOf(body);
    return REQUIRED_COLUMNS.every((c) => header.includes(c));
  },
  { message: "not a Census place-by-county file (header missing)" },
);

const PlaceRow = z.object({
  STATEFP: z.string().regex(/^\d{2}$/),
  COUNTYFP: z.string().regex(/^\d{3}$/),
  PLACEFP: z.string().regex(/^\d{5}$/),
  PLACENAME: z.string().trim().min(1),
  CLASSFP: z.string().regex(/^[A-Z]\d$/),
});

export function parsePlaceByCounty(
  body: string,
  scope: { statefp: string; countyfp: string },
): { places: CensusPlace[]; land_area_column: string | null } {
  PlaceByCountyFile.parse(body);
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = headerOf(body);
  const landColumn = LAND_COLUMNS.find((c) => header.includes(c)) ?? null;
  const landIndex = landColumn === null ? -1 : header.indexOf(landColumn);
  const places: CensusPlace[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("|").map((c) => c.trim());
    const record = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
    const row = PlaceRow.parse(record);
    if (row.STATEFP !== scope.statefp || row.COUNTYFP !== scope.countyfp) continue;
    if (!row.CLASSFP.startsWith("C")) continue;
    let land: number | null = null;
    if (landIndex >= 0) {
      land = z.coerce.number().nonnegative().parse(cells[landIndex]);
      if (land <= 0) continue;
    }
    places.push({
      placefp: row.PLACEFP,
      census_name: row.PLACENAME,
      name: placeShortName(row.PLACENAME),
      classfp: row.CLASSFP,
      land_area_sqm: land,
    });
  }
  return { places, land_area_column: landColumn };
}

export interface CensusProbeOptions {
  url?: string;
  statefp?: string;
  countyfp?: string;
}

export async function probeCensusPlaces(
  deps: ProbeDeps,
  options: CensusProbeOptions = {},
): Promise<CensusProbe> {
  const url = options.url ?? CENSUS_PLACE_BY_COUNTY_URL;
  const scope = {
    statefp: options.statefp ?? TRAVIS_STATEFP,
    countyfp: options.countyfp ?? TRAVIS_COUNTYFP,
  };
  const { receipt, data } = await deps.client.capture({
    url,
    schema: PlaceByCountyFile,
    bodyKind: "text",
    accept: "text/plain",
  });
  const blocked = (r: CaptureReceipt, reason: string): CensusProbe => ({
    status: "blocked",
    receipts: [r],
    blocked_receipt: r,
    url,
    captured_at: r.captured_at,
    places: [],
    census_reference: null,
    land_area_column: null,
    missing_reason: reason,
  });
  if (stopsSource(receipt) || data === null) return blocked(receipt, missingReason(receipt));

  let parsed: ReturnType<typeof parsePlaceByCounty>;
  try {
    parsed = parsePlaceByCounty(data, scope);
  } catch (error) {
    const why = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return {
      ...blocked(
        receipt,
        `failed parse of the Census file at ${receipt.captured_at}: ${why ?? ""}`,
      ),
      status: "available",
      blocked_receipt: null,
    };
  }

  const reference: CensusReference = {
    dataset: CENSUS_DATASET,
    vintage: CENSUS_VINTAGE,
    source_url: url,
    captured_at: receipt.captured_at,
    place_count: parsed.places.length,
  };
  reference.notes =
    parsed.land_area_column === null
      ? `incorporated places (CLASSFP C*) listed for county ${scope.statefp}${scope.countyfp}; the file has no land-area column, so the land-area filter is not applied (a water-only county part would be kept)`
      : `incorporated places (CLASSFP C*) in county ${scope.statefp}${scope.countyfp} with ${parsed.land_area_column} > 0`;
  return {
    status: "available",
    receipts: [receipt],
    blocked_receipt: null,
    url,
    captured_at: receipt.captured_at,
    places: parsed.places,
    census_reference: reference,
    land_area_column: parsed.land_area_column,
    missing_reason: null,
  };
}
