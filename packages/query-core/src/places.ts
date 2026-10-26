// T011 (A-13, AC-4, FR-004): resolve the Explore search box's text (or the `place` URL parameter,
// a gazetteer id) through travis-places@1.0.0. The label is what the page shows next to the
// search box: "{name_lsad} · Census {year} Gazetteer · {lat}, {lon}", with U+2212 for a negative
// coordinate. The year comes from the Census source file's URL (".../2024_Gazetteer/..."), so no
// year is written here. Outside Travis → out_of_scope with no point.
import {
  GAZETTEER,
  lookup,
  searchPlaces as searchGazetteer,
  type Found,
  type SourceStamp,
} from "../gazetteer/travis-places@1.0.0/index.js";
import placesJson from "../gazetteer/travis-places@1.0.0/places.json" with { type: "json" };

export interface ResolvedPlace {
  readonly status: "found";
  /** GEOID for a place, the 5-digit code for a ZCTA: the `place` URL parameter. */
  readonly id: string;
  readonly kind: "place" | "zcta";
  /** Census name with its LSAD word ("Pflugerville city") or "ZCTA5 78753". */
  readonly name: string;
  readonly point: { readonly lat: number; readonly lon: number };
  readonly label: string;
  readonly source: SourceStamp;
  readonly gazetteer: { readonly version: string; readonly sha256: string };
}

export interface PlaceOutOfScope {
  readonly status: "out_of_scope";
  readonly query: string;
}

export type PlaceResult = ResolvedPlace | PlaceOutOfScope;

const MINUS = "−";
const coordinate = (value: number): string =>
  value < 0 ? `${MINUS}${String(-value)}` : String(value);

/** "{name} · Census {year} Gazetteer · {lat}, {lon}". */
export function placeLabel(
  name: string,
  point: { lat: number; lon: number },
  year: string,
): string {
  return `${name} · Census ${year} Gazetteer · ${coordinate(point.lat)}, ${coordinate(point.lon)}`;
}

function censusYear(url: string): string {
  const year = /\/(\d{4})_Gazetteer\//.exec(url)?.[1];
  if (year === undefined) throw new Error(`gazetteer: no Census year in ${url}`);
  return year;
}

const GEOID = /^\d{7}$/;

/** Place by name (any case, LSAD word optional), ZCTA by code, or place by 7-digit GEOID. */
export function resolvePlace(text: string): PlaceResult {
  const outOfScope: PlaceOutOfScope = { status: "out_of_scope", query: text };
  const trimmed = text.trim();
  const r = GEOID.test(trimmed) ? lookupGeoid(trimmed) : lookup(text);
  if (r === undefined || r.status !== "found") return outOfScope;
  return resolved(r);
}

function resolved(r: Found): ResolvedPlace {
  return {
    status: "found",
    id: r.kind === "place" ? r.geoid : r.zcta,
    kind: r.kind,
    name: r.name,
    point: { lat: r.point.lat, lon: r.point.lon },
    label: placeLabel(r.name, r.point, censusYear(r.source.url)),
    source: r.source,
    gazetteer: { version: GAZETTEER.version, sha256: GAZETTEER.sha256 },
  };
}

/** Typing suggestions: name-prefix matches (and an exact ZIP), shaped exactly like resolvePlace. */
export function searchPlaces(prefix: string, limit: number): ResolvedPlace[] {
  return searchGazetteer(prefix, limit).map(resolved);
}

const byGeoid = new Map<string, ReturnType<typeof lookup>>();

/** A place by GEOID: looked up through its name, so lookup() stays the one reader. */
function lookupGeoid(geoid: string): ReturnType<typeof lookup> | undefined {
  if (byGeoid.size === 0) {
    for (const name of PLACE_NAMES) {
      const r = lookup(name);
      if (r.status === "found" && r.kind === "place") byGeoid.set(r.geoid, r);
    }
  }
  return byGeoid.get(geoid);
}

const PLACE_NAMES: readonly string[] = (placesJson as { name_lsad: string }[]).map(
  (p) => p.name_lsad,
);
