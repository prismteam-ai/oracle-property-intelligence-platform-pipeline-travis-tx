// The search box's logic (A-16, ported from Task B B-03 searchSuggest; pure, no React): what the
// typed text is, and which options it gives. Places and ZIPs come from the vendored Travis
// gazetteer (query-core/places); choosing one sets the Explore area. A permit number or a TCAD
// parcel id has no exact-lookup endpoint in Task A's Explore API, so its option hands the question
// to the AI tab, whose agent tools look it up exactly (searchRoofingPermits by permit number,
// getProperty by parcel id). Street addresses are not published in this run: a disabled option
// says so. Anything else can still be asked as a question (the header box's old behaviour).
import { resolvePlace, searchPlaces, type ResolvedPlace } from "@countylens/query-core/places";

export type QueryKind = "empty" | "place" | "zip" | "permit" | "tcad" | "address";

export interface SearchOption {
  /** Unique within one listbox; used for the option element id. */
  readonly id: string;
  readonly kind: "place" | "zip" | "permit" | "tcad" | "address" | "ask";
  readonly label: string;
  /** Secondary line: what choosing it does, or why it is disabled. */
  readonly detail: string;
  readonly disabled?: boolean;
  /** Place and ZIP options: the Explore `place` value (GEOID or ZCTA code). */
  readonly place?: string;
  /** Permit, TCAD and ask options: the question for the AI tab. */
  readonly question?: string;
}

export const ADDRESS_UNAVAILABLE =
  "Street addresses are not published in this run, so they cannot be searched";
export const GAZETTEER_NOTE = "Places and ZIPs: Census 2024 Gazetteer (travis-places@1.0.0)";

const PERMIT_RE = /^\d{4}-\d{6}(?:\s*[a-z]{2})?$/i;
const ZIP_RE = /^(?:zip\s*)?\d{3,5}$/i;
const TCAD_RE = /^\d{6,8}$/;
const ADDRESS_RE = /^\d+\s+\p{L}/u;
const MAX = 6;

const tidy = (text: string): string => text.trim().replace(/\s+/g, " ");

/** What the text looks like: 3-5 digits are a ZIP, 6-8 digits a TCAD parcel id. */
export function classifyQuery(text: string): QueryKind {
  const q = tidy(text);
  if (q === "") return "empty";
  if (PERMIT_RE.test(q)) return "permit";
  if (ZIP_RE.test(q)) return "zip";
  if (TCAD_RE.test(q)) return "tcad";
  if (ADDRESS_RE.test(q)) return "address";
  return "place";
}

/** `2026-121002` → `2026-121002 BP` (the suffix is kept when typed). */
export function normalisePermit(text: string): string {
  const q = tidy(text).toUpperCase();
  return /[A-Z]{2}$/.test(q) ? q.replace(/^(\d{4}-\d{6})\s*/, "$1 ") : `${q} BP`;
}

function placeOption(p: ResolvedPlace): SearchOption {
  return p.kind === "zcta"
    ? { id: `zip-${p.id}`, kind: "zip", label: p.id, detail: "ZIP code (ZCTA)", place: p.id }
    : { id: `place-${p.id}`, kind: "place", label: p.name, detail: "Place", place: p.id };
}

/** ZCTAs that start with 3-5 typed digits, in code order. */
function zipOptions(digits: string): SearchOption[] {
  const out: SearchOption[] = [];
  const span = 10 ** (5 - digits.length);
  for (let i = 0; i < span && out.length < MAX; i += 1) {
    const found = resolvePlace(String(Number(digits) * span + i).padStart(5, "0"));
    if (found.status === "found" && found.kind === "zcta") out.push(placeOption(found));
  }
  return out;
}

const ask = (q: string): SearchOption => ({
  id: "ask",
  kind: "ask",
  label: `Ask: ${q}`,
  detail: "Open the AI tab with this question",
  question: q,
});

/** Everything the listbox shows for the typed text. */
export function optionsFor(text: string): SearchOption[] {
  const q = tidy(text);
  switch (classifyQuery(q)) {
    case "empty":
      return [];
    case "place":
      return [...searchPlaces(q, MAX).map(placeOption), ask(q)];
    case "zip": {
      const digits = q.replace(/^zip\s*/i, "");
      const zips = zipOptions(digits);
      return zips.length === 0 && digits.length === 5 ? [tcad(digits)] : zips;
    }
    case "permit": {
      const permit = normalisePermit(q);
      return [
        {
          id: "permit",
          kind: "permit",
          label: `Permit ${permit}`,
          detail: "Ask the AI to look up this permit number exactly",
          question: `Show roofing permit ${permit} and its property, with sources.`,
        },
      ];
    }
    case "tcad":
      return [tcad(q)];
    case "address":
      return [
        { id: "address", kind: "address", label: q, detail: ADDRESS_UNAVAILABLE, disabled: true },
      ];
  }
}

function tcad(value: string): SearchOption {
  return {
    id: "tcad",
    kind: "tcad",
    label: `TCAD parcel ${value}`,
    detail: "Ask the AI to look up this parcel id exactly",
    question: `Show the property with TCAD parcel id ${value}: roof age, permits and sources.`,
  };
}

/** "Try" examples for the empty box: gazetteer entries only (no data value is invented here),
 *  chosen where the City of Austin permit source has long-open roofing permits (Run 3.1). */
export const SEARCH_SAMPLES: readonly string[] = ["Austin", "78704", "78702"];
