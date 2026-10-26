// A-11 (ERR-69): turn one TCAD owners[] entry into lexicon people or a company, or leave it
// unparsed. TCAD prints an individual as "LAST FIRST [MIDDLE] [SUFFIX] [& OTHER]" and, for most
// entries, leaves firstName / lastName null. The parser is deliberately conservative: a wrong
// person name is worse than an unparsed one, so anything it cannot read with certainty (single
// tokens, digits, slashes, estates, particles that start a surname, lookalike organisation
// words, 5+ tokens) stays unparsed, and a co-owner it cannot read is skipped (counted).
//
// Pure and deterministic: no I/O, no clock. The Texas section 25.025 confidential rule is
// applied by the caller before this runs; nothing here sees a redacted owner.

/** Entity words that make an unsplit owner name a company (never a person guess). */
export const ENTITY_NAME =
  /\b(LLC|L\.L\.C\.?|L L C|P L L C|L L P|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LP|L\.P\.|LTD|LLP|PLLC|TRUST|TRUSTEES?|PARTNERSHIP|PARTNERS|ASSOCIATION|ASSN|BANK|CHURCH|HOLDINGS|PROPERTIES|INVESTMENTS|FUND|FOUNDATION|ISD|CITY OF|COUNTY OF|STATE OF)\b/;

export const PERSON_NAME = /^[A-Z][a-z]*([ \-',.][A-Za-z][a-z]*)*$/;

/** Words that mark an organisation or a non-person holder without being a legal-entity suffix. */
const NON_PERSON_WORD = new Set([
  "ESTATE",
  "EST",
  "OF",
  "HEIRS",
  "HEIR",
  "DECEASED",
  "UNKNOWN",
  "UNDIVIDED",
  "INTEREST",
  "LIFE",
  "TRS",
  "TR",
  "ATTN",
  "CONFIDENTIAL",
  "REDACTED",
  "PRIVATE",
  "REVOCABLE",
  "IRREVOCABLE",
  "LIVING",
  "FAMILY",
  "SERIES",
  "SERVICES",
  "SERVICE",
  "GROUP",
  "MANAGEMENT",
  "MGMT",
  "REALTY",
  "CAPITAL",
  "VENTURES",
  "VENTURE",
  "ENTERPRISES",
  "ENTERPRISE",
  "DEVELOPMENT",
  "DEVELOPERS",
  "HOMES",
  "BUILDERS",
  "CONSTRUCTION",
  "ASSOC",
  "ASSOCS",
  "ASSOCIATES",
  "MINISTRIES",
  "MINISTRY",
  "SOCIETY",
  "CLUB",
  "SCHOOL",
  "DISTRICT",
  "AUTHORITY",
  "DEPT",
  "DEPARTMENT",
  "BOARD",
  "UNIVERSITY",
  "COLLEGE",
  "HOSPITAL",
  "MARKET",
  "PLUMBING",
  "APARTMENTS",
  "APTS",
  "HOUSING",
  "EQUITY",
  "REAL",
  "SYSTEMS",
  "SOLUTIONS",
  "INDUSTRIES",
  "INTERNATIONAL",
  "INTL",
  "RANCH",
  "FARMS",
  "FARM",
  "OIL",
  "GAS",
  "ENERGY",
  "JOINT",
  "CONDOMINIUM",
  "CONDOMINIUMS",
  "COMMUNITY",
  "OWNERS",
  "HOA",
  "PROPERTY",
  "INVESTMENT",
  "INVEST",
  "FINANCIAL",
  "MORTGAGE",
  "UNITED",
  "AMERICAN",
  "NATIONAL",
  "FIRST",
  "TEXAS",
  "MOTORS",
  "AUTO",
  "STORAGE",
  "RESTAURANT",
  "HOTEL",
  "INN",
  "LODGE",
  "CENTER",
  "CENTRE",
  "PARTNERSHIPS",
  "TRST",
  "REV",
  "REVOC",
  "AMD",
  "RESTATED",
  "LVG",
  "DECLARATION",
  "COUNTY",
  "CITY",
  "STATE",
  "PLACE",
  "PLAZA",
  "VILLAGE",
  "VILLAS",
  "TOWNHOMES",
  "TOWERS",
  "HILLS",
  "CREEK",
  "HOMEOWNERS",
  "OWNER",
  "RESIDENTIAL",
  "COMMERCIAL",
  "INDUSTRIAL",
  "DOWNTOWN",
  "TRUSTS",
  "PROPERTIES",
  "REALTORS",
  "REALTOR",
  "UNIT",
  "APT",
]);

/** Surname particles. As token 1 or 2 of a LAST FIRST name they make the split ambiguous. */
const PARTICLE = new Set([
  "DE",
  "DEL",
  "LA",
  "LAS",
  "LOS",
  "VAN",
  "VON",
  "DER",
  "DEN",
  "DI",
  "DA",
  "DOS",
  "DU",
  "ST",
  "SAINT",
  "BIN",
  "BEN",
  "AL",
  "EL",
  "MC",
  "MAC",
  "O",
  "D",
  "LE",
]);

/** Trailing "and others" markers, dropped (the first-named owner is still the owner). */
const DROP_TAIL: ReadonlyArray<readonly string[]> = [
  ["ET", "AL"],
  ["ET", "UX"],
  ["ET", "VIR"],
  ["ETAL"],
  ["ETUX"],
  ["ETVIR"],
];

/**
 * Given names that are far more often a middle name than a surname. After "FIRST X" with X in
 * this set and X not the shared surname, the pair is ambiguous ("MARY ANN" is a first and a
 * middle name, "SUN YANG" is not), so the second party is not read.
 */
const MIDDLE_LIKE = new Set([
  "ANN",
  "ANNE",
  "MARIE",
  "LEE",
  "LYNN",
  "KAY",
  "SUE",
  "JEAN",
  "JO",
  "ELIZABETH",
  "ROSE",
  "JANE",
  "RENEE",
  "BETH",
  "ELLEN",
  "LOU",
  "RAE",
  "ELAINE",
  "LOUISE",
  "DIANE",
  "LEIGH",
  "RUTH",
  "DENISE",
  "NICOLE",
  "MICHELLE",
  "CHRISTINE",
  "MAE",
  "FAYE",
  "GRACE",
  "JOY",
  "DEAN",
  "RAY",
  "JAY",
  "LYNNE",
]);

const SUFFIX: Readonly<Record<string, string>> = {
  JR: "Jr.",
  SR: "Sr.",
  II: "II",
  III: "III",
  IV: "IV",
};

export interface ParsedPerson {
  first_name: string;
  last_name: string;
  middle_name: string | null;
  suffix_name: string | null;
}

export type ParsedOwner =
  | { kind: "people"; people: ParsedPerson[]; skippedCoOwner: boolean }
  | { kind: "company"; name: string }
  | { kind: "unparsed" };

export interface OwnerNameFields {
  name?: string | null | undefined;
  nameSecondary?: string | null | undefined;
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
}

export function titleCase(word: string): string {
  return word
    .toLowerCase()
    .replace(/(^|[ \-',.])([a-z])/g, (_m, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`);
}

const squash = (v: string | null | undefined): string => (v ?? "").replace(/\s+/g, " ").trim();
const nonEmpty = (v: string | null | undefined): boolean => squash(v) !== "";

/** Words that only complete a trust name when TCAD put them on the second name line. */
const TRUST_TAIL = new Set([
  "REVOCABLE",
  "IRREVOCABLE",
  "LIVING",
  "FAMILY",
  "TRUST",
  "TRUSTEE",
  "TRUSTEES",
  "TR",
  "TRS",
]);

/** A second name line that is only a unit designator ("UNIT A", "APT 4", "STE 200", "#B"). */
const UNIT_LINE = /^(UNIT|APT|APARTMENT|STE|SUITE|BLDG|BUILDING|#)\s*[A-Z0-9-]{1,6}$/;

/** True when the text carries an entity word or a lookalike organisation word. */
function isOrgText(text: string): boolean {
  return ENTITY_NAME.test(text) || text.split(" ").some((w) => NON_PERSON_WORD.has(w));
}

const TOKEN = /^[A-Z][A-Z'-]*$/;

interface Segment {
  tokens: string[];
  suffix: string | null;
}

/** Tokenise one name segment; null when anything in it is not a plain name token. */
function segmentOf(text: string): Segment | null {
  let tokens = text
    .replace(/\./g, "")
    .split(" ")
    .filter((t) => t !== "");
  // Drop trailing "ET AL"-style markers.
  for (let changed = true; changed;) {
    changed = false;
    for (const tail of DROP_TAIL) {
      const start = tokens.length - tail.length;
      if (start > 0 && tail.every((w, i) => tokens[start + i] === w)) {
        tokens = tokens.slice(0, start);
        changed = true;
      }
    }
  }
  let suffix: string | null = null;
  const last = tokens[tokens.length - 1];
  if (last !== undefined && SUFFIX[last] !== undefined && tokens.length > 1) {
    suffix = SUFFIX[last] as string;
    tokens = tokens.slice(0, -1);
  }
  if (tokens.length === 0) return null;
  // A trailing LE is a life estate or a surname (Vietnamese Le): with 3+ tokens it cannot be told.
  if (tokens.length >= 3 && tokens[tokens.length - 1] === "LE") return null;
  for (const t of tokens) {
    if (!TOKEN.test(t) || NON_PERSON_WORD.has(t)) return null;
  }
  return { tokens, suffix };
}

function personOf(
  first: string,
  last: string,
  middle: string[],
  suffix: string | null,
): ParsedPerson | null {
  const f = titleCase(first);
  const l = titleCase(last);
  const m = middle.length === 0 ? null : titleCase(middle.join(" "));
  // A one-letter first name is an initial, not a name worth publishing.
  if (first.length < 2) return null;
  if (!PERSON_NAME.test(f) || !PERSON_NAME.test(l)) return null;
  if (m !== null && !/^[A-Z][a-zA-Z\s\-',.]*$/.test(m)) return null;
  return { first_name: f, last_name: l, middle_name: m, suffix_name: suffix };
}

/** "LAST FIRST [MIDDLE...]": the first party, TCAD's printed order. */
function lastFirst(seg: Segment): ParsedPerson | null {
  const { tokens, suffix } = seg;
  if (tokens.length < 2 || tokens.length > 4) return null;
  // A particle at token 1 or 2 makes the surname boundary ambiguous.
  if (PARTICLE.has(tokens[0] as string) || PARTICLE.has(tokens[1] as string)) return null;
  // "DULANEY RADOMSKI DIANA D": a closing initial after a full third name hints at a double
  // surname, so the boundary cannot be read.
  if (tokens.length === 4 && (tokens[2] as string).length > 1 && (tokens[3] as string).length === 1)
    return null;
  return personOf(tokens[1] as string, tokens[0] as string, tokens.slice(2), suffix);
}

/** "FIRST [MIDDLE] LAST", "FIRST" or "FIRST I": a second party, natural order. */
function natural(seg: Segment, sharedLast: string): ParsedPerson | null {
  const { tokens, suffix } = seg;
  if (tokens.some((t) => PARTICLE.has(t))) return null;
  if (tokens.length === 1) return personOf(tokens[0] as string, sharedLast, [], suffix);
  if (tokens.length === 2) {
    if ((tokens[1] as string).length === 1) {
      return personOf(tokens[0] as string, sharedLast, [tokens[1] as string], suffix);
    }
    if (tokens[1] !== sharedLast.toUpperCase() && MIDDLE_LIKE.has(tokens[1] as string)) return null;
    return personOf(tokens[0] as string, tokens[1] as string, [], suffix);
  }
  if (tokens.length === 3) {
    return personOf(tokens[0] as string, tokens[2] as string, [tokens[1] as string], suffix);
  }
  return null;
}

/**
 * Classify one owners[] entry. Order of precedence:
 *  1. an entity word in the printed name -> company (name as printed);
 *  2. explicit firstName + lastName that pass the lexicon pattern -> one person (as before);
 *  3. a trust tail on the second name line ("REVOCABLE" + "TRUST") -> company;
 *  4. the text parser above -> one or two people;
 *  5. otherwise unparsed.
 */
export function parseOwner(owner: OwnerNameFields): ParsedOwner {
  const name = squash(owner.name).toUpperCase().replace(/ AND /g, " & ");
  // A condo owner's second line is often only the unit ("UNIT A"): an address designator, not a party.
  const rawSecondary = squash(owner.nameSecondary).toUpperCase();
  const secondary = UNIT_LINE.test(rawSecondary) ? "" : rawSecondary;
  if (name !== "" && ENTITY_NAME.test(name)) return { kind: "company", name: squash(owner.name) };

  if (nonEmpty(owner.firstName) && nonEmpty(owner.lastName)) {
    const first = titleCase(squash(owner.firstName));
    const last = titleCase(squash(owner.lastName));
    if (PERSON_NAME.test(first) && PERSON_NAME.test(last)) {
      return {
        kind: "people",
        people: [{ first_name: first, last_name: last, middle_name: null, suffix_name: null }],
        skippedCoOwner: false,
      };
    }
  }
  if (name === "") return { kind: "unparsed" };

  const careOf = /^(%|C\/O\b|ATTN\b)/.test(secondary);
  const endsWithAmp = name.endsWith("&");
  let extraParty = false;
  if (secondary !== "" && !careOf && !endsWithAmp) {
    const words = secondary.split(" ");
    const full = `${squash(owner.name)} ${squash(owner.nameSecondary)}`;
    if (words.every((w) => TRUST_TAIL.has(w)) && words.includes("TRUST")) {
      return { kind: "company", name: full };
    }
    if (isOrgText(secondary)) {
      // The second line continues an organisation name ("HOMEOWNERS ASSOC INC"). Only a name
      // without a joint "&" is read as one; a mix of people and an organisation stays unparsed.
      return !name.includes("&") && ENTITY_NAME.test(full)
        ? { kind: "company", name: full }
        : { kind: "unparsed" };
    }
    // A second name line with no "&" that reads as a name is a further party we do not read.
    extraParty = /^[A-Z'-]+( [A-Z'-]+)+$/.test(secondary);
  }
  if (/[\d/@#()]/.test(name)) return { kind: "unparsed" };

  const parts = name.split("&").map((p) => p.trim());
  if (parts.length > 2) return { kind: "unparsed" };
  const firstSeg = segmentOf(parts[0] as string);
  if (firstSeg === null) return { kind: "unparsed" };
  const primary = lastFirst(firstSeg);
  if (primary === null) return { kind: "unparsed" };

  // The second party: text after "&", or the second name line when the first ends with "&".
  let secondText = parts[1] ?? null;
  if (parts.length === 2 && secondText === "" && secondary !== "") secondText = secondary;
  // "X & GAY LYNN" with the second line "GAY LYNN HYNDS": the second line is the full second party.
  else if (secondText !== null && extraParty && secondary.startsWith(`${secondText} `)) {
    secondText = secondary;
    extraParty = false;
  }
  if (secondText === null || secondText === "") {
    // "NAME &" with nothing after it, or a single party.
    return { kind: "people", people: [primary], skippedCoOwner: parts.length === 2 || extraParty };
  }
  if (isOrgText(secondText)) return { kind: "unparsed" };
  if (/[\d/@#()]/.test(secondText)) {
    return { kind: "people", people: [primary], skippedCoOwner: true };
  }
  const secondSeg = segmentOf(secondText);
  const second = secondSeg === null ? null : natural(secondSeg, primary.last_name);
  return second === null
    ? { kind: "people", people: [primary], skippedCoOwner: true }
    : { kind: "people", people: [primary, second], skippedCoOwner: extraParty };
}

/**
 * Whether individuals' names are written to the County group. The PO decision on publishing
 * individuals' names county-wide is pending (ERR-69); until it lands the default is `publish`.
 * `omit` leaves every person (and their mailing address) out without a code change; companies
 * are unaffected. Read from the OWNER_PERSONS environment variable; any other value throws, so a
 * typo can never silently publish names.
 */
export type OwnerPersonsMode = "publish" | "omit";

export const OWNER_PERSONS_DEFAULT: OwnerPersonsMode = "publish";

export function ownerPersonsMode(
  env: Record<string, string | undefined> = process.env,
): OwnerPersonsMode {
  const v = (env.OWNER_PERSONS ?? "").trim().toLowerCase();
  if (v === "") return OWNER_PERSONS_DEFAULT;
  if (v === "publish" || v === "omit") return v;
  throw new Error(`OWNER_PERSONS must be "publish" or "omit", got "${v}"`);
}
