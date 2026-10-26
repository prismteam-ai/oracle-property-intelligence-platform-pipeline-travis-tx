// A-11 Run 3 (ADR 0004, PO decision 2026-10-25): the one normalisation both sides of the
// address-point join go through. Pure; no I/O.
//
// A situs address (TCAD) and an address point (City of Austin LOCATION_address_points) are each
// reduced to the same key `<house number>|<canonical street>` and joined by string equality.
// This is an exact-string join to an official dataset, never a free-text lookup service and never a fuzzy match.
//
// Normalisation, in order, on BOTH sides:
//   1. case: upper-cased; punctuation (. , # ' ") removed or turned into a space; runs of
//      whitespace collapsed.
//   2. house number: digits (leading zeros dropped); a situs with no number gives no key. A
//      fraction ("1/2") or a letter suffix is the number's `qualifier` and IS part of the key, so
//      "9605 1/2 WILDHORSE RANCH TRL" and "9605 WILDHORSE RANCH TRL" are two addresses.
//   3. unit designators: dropped. A trailing "APT|UNIT|STE|SUITE|BLDG|BUILDING|FL|FLOOR|RM|ROOM|LOT|
//      SPC|SPACE|TRLR|# <token>" group is cut off the street text, and the structured
//      `street_secondary` of the situs is never part of the key (the layer holds building
//      points, not unit points). The unit is reported back so evidence can show it was ignored.
//   4. suffix abbreviations: the street type is mapped to the USPS Publication 28 primary
//      abbreviation (STREET, ST, STR -> ST; DRIVE -> DR; BOULEVARD -> BLVD; ...). It is applied to
//      the last street token, or to the one before a trailing directional, never to a token in
//      the middle of a name (so "ST JOHNS AVE" keeps its "ST").
//   5. directionals: NORTH/N -> N, SOUTH/S -> S, EAST/E -> E, WEST/W -> W (and the NE/NW/SE/SW
//      forms), only as the first token of a multi-token street or as the token after the street
//      type (or the last token). A name word such as "WEST LAKE" is therefore treated the same
//      way on both sides, which is all the join needs.
//   6. ZIP: reduced to its first five digits. The layer carries NO ZIP, so the ZIP is never part
//      of the key; it is returned for the evidence report and as a tie-break the matcher does
//      not use. Two points on the same number and street (for example in two cities) are
//      therefore "ambiguous" and stay unmatched.

/** The structured situs held in parcels.situs_address (TCAD export, primary situs). */
export interface SitusIn {
  street_number?: string | null;
  street_prefix?: string | null;
  street_name?: string | null;
  street_suffix?: string | null;
  street_secondary?: string | null;
  zip?: string | null;
}

/** One side of the join, reduced. */
export interface AddressKey {
  /** `<number>|<canonical street>`; the join key. */
  key: string;
  number: string;
  street: string;
  /** Fraction or letter suffix of the number ("1/2", "A"), upper-case, or null. */
  qualifier: string | null;
  /** A unit designator that was cut off or ignored, or null. */
  unit: string | null;
  /** First five digits of the ZIP, or null. */
  zip5: string | null;
}

/** USPS Publication 28 street types: every spelling seen in the two sources -> primary abbreviation. */
const STREET_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ALLEY: "ALY",
  ALY: "ALY",
  ALLEE: "ALY",
  AVENUE: "AVE",
  AVE: "AVE",
  AV: "AVE",
  AVEN: "AVE",
  AVENU: "AVE",
  AVN: "AVE",
  BEND: "BND",
  BND: "BND",
  BOULEVARD: "BLVD",
  BLVD: "BLVD",
  BOUL: "BLVD",
  BOULV: "BLVD",
  BRANCH: "BR",
  BR: "BR",
  BRIDGE: "BRG",
  BRG: "BRG",
  BYPASS: "BYP",
  BYP: "BYP",
  CAMINO: "CAM",
  CAM: "CAM",
  CANYON: "CYN",
  CYN: "CYN",
  CANYN: "CYN",
  CAPE: "CPE",
  CPE: "CPE",
  CAUSEWAY: "CSWY",
  CSWY: "CSWY",
  CENTER: "CTR",
  CTR: "CTR",
  CENTRE: "CTR",
  CNTR: "CTR",
  CIRCLE: "CIR",
  CIR: "CIR",
  CIRC: "CIR",
  CRCL: "CIR",
  CLIFF: "CLF",
  CLF: "CLF",
  COMMON: "CMN",
  CMN: "CMN",
  CORNER: "COR",
  COR: "COR",
  COURSE: "CRSE",
  CRSE: "CRSE",
  COURT: "CT",
  CT: "CT",
  CRT: "CT",
  COVE: "CV",
  CV: "CV",
  CREEK: "CRK",
  CRK: "CRK",
  CRESCENT: "CRES",
  CRES: "CRES",
  CRSENT: "CRES",
  CROSSING: "XING",
  XING: "XING",
  CRSSNG: "XING",
  CROSSROAD: "XRD",
  XRD: "XRD",
  CURVE: "CURV",
  CURV: "CURV",
  DALE: "DL",
  DL: "DL",
  DRIVE: "DR",
  DR: "DR",
  DRV: "DR",
  DRIV: "DR",
  EXPRESSWAY: "EXPY",
  EXPY: "EXPY",
  EXPR: "EXPY",
  EXPRESS: "EXPY",
  EXP: "EXPY",
  ESTATE: "EST",
  EST: "EST",
  ESTATES: "ESTS",
  ESTS: "ESTS",
  EXTENSION: "EXT",
  EXT: "EXT",
  EXTN: "EXT",
  FALLS: "FLS",
  FLS: "FLS",
  FIELD: "FLD",
  FLD: "FLD",
  FLAT: "FLT",
  FLT: "FLT",
  FORD: "FRD",
  FRD: "FRD",
  FOREST: "FRST",
  FRST: "FRST",
  FORK: "FRK",
  FRK: "FRK",
  FREEWAY: "FWY",
  FWY: "FWY",
  FREEWY: "FWY",
  FRWY: "FWY",
  GARDEN: "GDN",
  GDN: "GDN",
  GARDENS: "GDNS",
  GDNS: "GDNS",
  GATEWAY: "GTWY",
  GTWY: "GTWY",
  GATEWY: "GTWY",
  GLEN: "GLN",
  GLN: "GLN",
  GREEN: "GRN",
  GRN: "GRN",
  GROVE: "GRV",
  GRV: "GRV",
  HARBOR: "HBR",
  HBR: "HBR",
  HAVEN: "HVN",
  HVN: "HVN",
  HEIGHTS: "HTS",
  HTS: "HTS",
  HGTS: "HTS",
  HIGHWAY: "HWY",
  HWY: "HWY",
  HIGHWY: "HWY",
  HIWAY: "HWY",
  HILL: "HL",
  HL: "HL",
  HILLS: "HLS",
  HLS: "HLS",
  HOLLOW: "HOLW",
  HOLW: "HOLW",
  ISLAND: "IS",
  IS: "IS",
  JUNCTION: "JCT",
  JCT: "JCT",
  KEY: "KY",
  KY: "KY",
  KNOLL: "KNL",
  KNL: "KNL",
  LAKE: "LK",
  LK: "LK",
  LANDING: "LNDG",
  LNDG: "LNDG",
  LANE: "LN",
  LN: "LN",
  LOOP: "LOOP",
  LP: "LOOP",
  MALL: "MALL",
  MANOR: "MNR",
  MNR: "MNR",
  MEADOW: "MDW",
  MDW: "MDW",
  MEADOWS: "MDWS",
  MDWS: "MDWS",
  MILL: "ML",
  ML: "ML",
  MOUNT: "MT",
  MT: "MT",
  MOUNTAIN: "MTN",
  MTN: "MTN",
  OVERPASS: "OPAS",
  OPAS: "OPAS",
  PARK: "PARK",
  PRK: "PARK",
  PARKWAY: "PKWY",
  PKWY: "PKWY",
  PARKWY: "PKWY",
  PKY: "PKWY",
  PASS: "PASS",
  PASSAGE: "PSGE",
  PSGE: "PSGE",
  PATH: "PATH",
  PIKE: "PIKE",
  PINE: "PNE",
  PNE: "PNE",
  PINES: "PNES",
  PNES: "PNES",
  PLACE: "PL",
  PL: "PL",
  PLAIN: "PLN",
  PLN: "PLN",
  PLAINS: "PLNS",
  PLNS: "PLNS",
  PLAZA: "PLZ",
  PLZ: "PLZ",
  POINT: "PT",
  PT: "PT",
  PORT: "PRT",
  PRT: "PRT",
  PRAIRIE: "PR",
  PR: "PR",
  RADIAL: "RADL",
  RADL: "RADL",
  RANCH: "RNCH",
  RNCH: "RNCH",
  RAPID: "RPD",
  RPD: "RPD",
  REST: "RST",
  RST: "RST",
  RIDGE: "RDG",
  RDG: "RDG",
  RIDGES: "RDGS",
  RDGS: "RDGS",
  RIVER: "RIV",
  RIV: "RIV",
  ROAD: "RD",
  RD: "RD",
  ROADS: "RDS",
  RDS: "RDS",
  ROUTE: "RTE",
  RTE: "RTE",
  ROW: "ROW",
  RUN: "RUN",
  SHOAL: "SHL",
  SHL: "SHL",
  SHORE: "SHR",
  SHR: "SHR",
  SKYWAY: "SKWY",
  SKWY: "SKWY",
  SPRING: "SPG",
  SPG: "SPG",
  SPRINGS: "SPGS",
  SPGS: "SPGS",
  SPUR: "SPUR",
  SQUARE: "SQ",
  SQ: "SQ",
  SQR: "SQ",
  STATION: "STA",
  STA: "STA",
  STREAM: "STRM",
  STRM: "STRM",
  STREET: "ST",
  ST: "ST",
  STR: "ST",
  STRT: "ST",
  SUMMIT: "SMT",
  SMT: "SMT",
  TERRACE: "TER",
  TER: "TER",
  TERR: "TER",
  TRACE: "TRCE",
  TRCE: "TRCE",
  TRACK: "TRAK",
  TRAK: "TRAK",
  TRAIL: "TRL",
  TRL: "TRL",
  TRAILS: "TRL",
  TRLS: "TRL",
  TURNPIKE: "TPKE",
  TPKE: "TPKE",
  UNDERPASS: "UPAS",
  UPAS: "UPAS",
  UNION: "UN",
  UN: "UN",
  VALLEY: "VLY",
  VLY: "VLY",
  VIADUCT: "VIA",
  VIA: "VIA",
  VIEW: "VW",
  VW: "VW",
  VILLAGE: "VLG",
  VLG: "VLG",
  VISTA: "VIS",
  VIS: "VIS",
  VST: "VIS",
  WALK: "WALK",
  // TCAD short forms seen on condo situs (CI, RG, TR, HY); anything else stays as printed and
  // simply fails to match.
  CI: "CIR",
  RG: "RDG",
  TR: "TRL",
  HY: "HWY",
  WAY: "WAY",
  WY: "WAY",
  WELL: "WL",
  WL: "WL",
});

const DIRECTIONALS: Readonly<Record<string, string>> = Object.freeze({
  N: "N",
  NORTH: "N",
  S: "S",
  SOUTH: "S",
  E: "E",
  EAST: "E",
  W: "W",
  WEST: "W",
  NE: "NE",
  NORTHEAST: "NE",
  NW: "NW",
  NORTHWEST: "NW",
  SE: "SE",
  SOUTHEAST: "SE",
  SW: "SW",
  SOUTHWEST: "SW",
});

/** Unit designators cut off the end of a street text ("... DR APT 2", "... DR # 270", "... DR STE 3104"). */
const UNIT_TAIL =
  /\s+(?:APT|APARTMENT|UNIT|STE|SUITE|BLDG|BUILDING|FL|FLOOR|RM|ROOM|LOT|SPC|SPACE|TRLR|TRAILER|#)\s*([A-Z0-9-]+)\s*$/;
/** A hash sign glued to the unit at the end of the street. */
const HASH_TAIL = /\s*#\s*([A-Z0-9-]+)\s*$/;

const squash = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[.,'"`]/g, "")
    .replace(/[^A-Z0-9#/ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const dirOf = (t: string): string | undefined => DIRECTIONALS[t];

/** Street text (name words, no number) -> canonical street, plus a unit if one was cut off. */
export function canonicalStreet(raw: string): { street: string; unit: string | null } {
  let text = squash(raw);
  let unit: string | null = null;
  const hash = HASH_TAIL.exec(text);
  if (hash !== null) {
    unit = hash[1] ?? null;
    text = text.slice(0, hash.index).trim();
  } else {
    const m = UNIT_TAIL.exec(text);
    if (m !== null) {
      unit = m[1] ?? null;
      text = text.slice(0, m.index).trim();
    }
  }
  const tokens = text.split(" ").filter((t) => t !== "");
  if (tokens.length === 0) return { street: "", unit };
  // Leading directional, only when a street name follows it.
  if (tokens.length > 1) {
    const d = dirOf(tokens[0] as string);
    if (d !== undefined) tokens[0] = d;
  }
  // Trailing directional ("... AVE N"), then the street type before it (or the last token).
  let last = tokens.length - 1;
  if (tokens.length > 2) {
    const d = dirOf(tokens[last] as string);
    if (d !== undefined && STREET_TYPES[tokens[last - 1] as string] !== undefined) {
      tokens[last] = d;
      last -= 1;
    }
  }
  if (tokens.length > 1) {
    const t = STREET_TYPES[tokens[last] as string];
    if (t !== undefined) tokens[last] = t;
  }
  return { street: tokens.join(" "), unit };
}

/** House number text -> digits (leading zeros dropped) and an optional qualifier ("1/2", "A"). */
export function canonicalNumber(raw: string): { number: string; qualifier: string | null } | null {
  const m = /^\s*0*(\d+)\s*(?:-?\s*([A-Z]|\d\/\d))?\s*$/i.exec(raw);
  if (m === null) return null;
  const qualifier = m[2] === undefined ? null : m[2].toUpperCase();
  return { number: m[1] as string, qualifier };
}

/** The ZIP's first five digits, or null. */
export function zip5Of(zip: string | null | undefined): string | null {
  const m = /^\s*(\d{5})(?:\D|$)/.exec(zip ?? "");
  return m === null ? null : (m[1] as string);
}

const keyOf = (number: string, qualifier: string | null, street: string): string =>
  `${number}${qualifier === null ? "" : ` ${qualifier}`}|${street}`;

/** Situs (TCAD) -> join key; null when the situs has no house number or no street name. */
export function situsKey(situs: SitusIn | null | undefined): AddressKey | null {
  if (situs === null || situs === undefined) return null;
  const num = canonicalNumber(situs.street_number ?? "");
  if (num === null) return null;
  // A situs with no street name is not an address (a bare "ST" would otherwise be a key).
  if ((situs.street_name ?? "").trim() === "") return null;
  // TCAD prints a fraction ("1/2") in the prefix field: it belongs to the number.
  const prefix = (situs.street_prefix ?? "").trim();
  const prefixIsFraction = /^\d\/\d$/.test(prefix);
  const street = canonicalStreet(
    [prefixIsFraction ? null : prefix, situs.street_name, situs.street_suffix]
      .filter((p): p is string => typeof p === "string" && p.trim() !== "")
      .join(" "),
  );
  if (street.street === "" || /^\d*$/.test(street.street)) return null;
  const secondary = squash(situs.street_secondary ?? "");
  const qualifier = prefixIsFraction ? prefix : num.qualifier;
  return {
    key: keyOf(num.number, qualifier, street.street),
    number: num.number,
    street: street.street,
    qualifier,
    unit: street.unit ?? (secondary === "" ? null : secondary),
    zip5: zip5Of(situs.zip),
  };
}

/** Layer record (LOCATION_address_points) -> join key; null without a number or street. */
export function layerKey(rec: {
  address: number | string | null;
  full_street_name: string | null;
  address_fraction?: string | null;
  address_suffix?: string | null;
}): AddressKey | null {
  const num = canonicalNumber(String(rec.address ?? ""));
  if (num === null || num.number === "0") return null;
  // FULL_STREET_NAME is "<number> [<fraction>] <street words>"; the street is what follows.
  const full = squash(rec.full_street_name ?? "");
  const m = /^\d+(?:\s+(\d\/\d))?\s+(.+)$/.exec(full);
  if (m === null) return null;
  const street = canonicalStreet(m[2] as string);
  if (street.street === "") return null;
  // The number's fraction and letter suffix go into the key, so "9605 1/2" and "9605" are two
  // addresses, never one ambiguous key.
  const qualifier =
    [squash(rec.address_fraction ?? "") || (m[1] ?? ""), squash(rec.address_suffix ?? "")]
      .filter((p) => p !== "")
      .join(" ") || null;
  return {
    key: keyOf(num.number, qualifier, street.street),
    number: num.number,
    street: street.street,
    qualifier,
    unit: street.unit,
    zip5: null,
  };
}
