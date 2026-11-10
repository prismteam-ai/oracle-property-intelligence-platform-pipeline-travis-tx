export const STREET_TYPE_ALIASES: Readonly<Record<string, string>> = {
  AV: "AVE",
  BEND: "BND",
  BL: "BLVD",
  CR: "CIR",
  CRT: "CT",
  DRIVE: "DR",
  HY: "HWY",
  LP: "LOOP",
  PKY: "PKWY",
  PS: "PASS",
  PTH: "PATH",
  TERR: "TER",
  TR: "TRL",
  TRACE: "TRCE",
  VIEW: "VW",
  AVENUE: "AVE",
  BOULEVARD: "BLVD",
  CIRCLE: "CIR",
  COURT: "CT",
  COVE: "CV",
  HIGHWAY: "HWY",
  LANE: "LN",
  PARKWAY: "PKWY",
  ROAD: "RD",
  STREET: "ST",
  TRAIL: "TRL",
};

const STREET_TYPES = new Set([
  "ST",
  "AVE",
  "DR",
  "RD",
  "LN",
  "BLVD",
  "CT",
  "CIR",
  "CV",
  "TRL",
  "PKWY",
  "HWY",
  "WAY",
  "LOOP",
  "PL",
  "PASS",
  "PATH",
  "TER",
  "TRCE",
  "VW",
  "BND",
  "XING",
  "RDG",
  "HOLW",
  "PT",
  "RUN",
  "SQ",
  "PLZ",
  "EXPY",
  "FWY",
  "ROW",
  "WALK",
  "GLN",
  "GRV",
  "HL",
  "HLS",
  "MDW",
  "MDWS",
  "CRK",
  "CYN",
  "VLY",
  "SPUR",
  "LNDG",
  "PARK",
  "PIKE",
  "SKWY",
  "BRG",
]);
const DIRECTIONS: Readonly<Record<string, string>> = {
  N: "N",
  S: "S",
  E: "E",
  W: "W",
  NE: "NE",
  NW: "NW",
  SE: "SE",
  SW: "SW",
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
};
const UNIT_DESIGNATORS = new Set([
  "STE",
  "SUITE",
  "UNIT",
  "APT",
  "BLDG",
  "BLD",
  "FL",
  "FLOOR",
  "RM",
  "ROOM",
  "SPC",
  "SPACE",
  "LOT",
  "NO",
]);
const UNIT_MARK = "#";
const HOUSE_NUMBER = /^\d+[A-Z]?$/;
const KEY_SEPARATOR = "|";

export const MAX_ADDRESS_POINT_SPREAD_DEGREES = 0.004;

export function streetAddressKey(address: string | undefined): string | undefined {
  const tokens = withoutUnits(
    (address ?? "")
      .toUpperCase()
      .replaceAll(".", "")
      .replaceAll(",", " ")
      .split(/\s+/)
      .filter((token) => token !== ""),
  );
  const [number, ...rest] = tokens;
  if (number === undefined || !HOUSE_NUMBER.test(number)) return undefined;

  const prefix = rest[0] !== undefined && rest.length > 1 ? DIRECTIONS[rest[0]] : undefined;
  const street = prefix ? rest.slice(1) : rest;
  const last = canonicalStreetType(street.at(-1));
  const hasType = street.length > 1 && STREET_TYPES.has(last);
  const name = (hasType ? street.slice(0, -1) : street).join(" ");
  return [number, prefix ?? "", name, hasType ? last : ""].join(KEY_SEPARATOR);
}

function withoutUnits(tokens: readonly string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token.startsWith(UNIT_MARK)) continue;
    if (UNIT_DESIGNATORS.has(token) && index > 1) {
      index += 1;
      continue;
    }
    kept.push(token);
  }
  return kept;
}

export function canonicalStreetType(type: string | undefined): string {
  const normalized = type?.trim().toUpperCase() ?? "";
  return STREET_TYPE_ALIASES[normalized] ?? normalized;
}
