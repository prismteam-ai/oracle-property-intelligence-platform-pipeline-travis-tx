// Explore · AI state helpers (A-14 T033; FR-012). Pure functions: the session question counter
// (sessionStorage; only an `answered` outcome counts, per docs/02-design.md), the answer split
// into text and `[n]` citations, and the "How I read this" chips built from the server's echo of
// the filters it applied (`query`), never from model text.
import { EXPLORE_BOUNDS } from "@countylens/query-core";
import { AI_TEXTS } from "@countylens/shared";
import type { AgentAskResponse } from "../data/agent-ask";

export const SESSION_KEY = "countylens.ai.questions";

/** Reads the session count; storage that is blocked or unreadable counts as zero. */
export function readSessionCount(storage: Pick<Storage, "getItem"> | undefined): number {
  try {
    const n = Number(storage?.getItem(SESSION_KEY) ?? 0);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function writeSessionCount(storage: Pick<Storage, "setItem"> | undefined, n: number): void {
  try {
    storage?.setItem(SESSION_KEY, String(n));
  } catch {
    // Private mode or blocked storage: the count then lives in component state only.
  }
}

export function sessionStorageOrUndefined(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export const limitReached = (used: number): boolean => used >= AI_TEXTS.sessionLimit;

/** One block of the answer prose (a safe Markdown subset; text only, never HTML). */
export interface AnswerBlock {
  readonly kind: "heading" | "para" | "item" | "caveat";
  readonly text: string;
}

const RULE = /^\s*([-*_])\1{2,}\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/**
 * PO 2026-10-26 (15.png): the model writes Markdown. This reads the few shapes it uses into blocks
 * so the page never shows raw `**`, `###`, `>` or `|---|`: headings, list items, `>` quotes as a
 * caveat, table rows as items ("cell · cell", header and separator rows dropped), rules dropped.
 * Bold markers are handled inline (answerInline); everything stays plain text.
 */
export function answerBlocks(answer: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let tableHeader = false;
  for (const raw of answer.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || RULE.test(line)) {
      tableHeader = false;
      continue;
    }
    if (line.startsWith("|")) {
      if (TABLE_SEPARATOR.test(line)) continue;
      const cells = line
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c !== "");
      if (!tableHeader) {
        tableHeader = true; // the first row of a table is its header
        continue;
      }
      blocks.push({ kind: "item", text: cells.join(" · ") });
      continue;
    }
    tableHeader = false;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) blocks.push({ kind: "heading", text: heading[1] ?? "" });
    else if (line.startsWith(">")) blocks.push({ kind: "caveat", text: line.replace(/^>\s*/, "") });
    else if (/^([-*+]|\d+[.)])\s+/.test(line))
      blocks.push({ kind: "item", text: line.replace(/^([-*+]|\d+[.)])\s+/, "") });
    else blocks.push({ kind: "para", text: line });
  }
  return blocks;
}

export type InlinePart = AnswerPart | { readonly kind: "strong"; readonly text: string };

/** Inline pieces of one block: `**bold**`, `[n]` citations, the rest as text (markers dropped). */
export function answerInline(text: string, matchCount: number): InlinePart[] {
  const parts: InlinePart[] = [];
  const clean = text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(^|\s)[_*]([^_*\s][^_*]*)[_*](?=\s|$|[.,;:])/g, "$1$2");
  let last = 0;
  for (const m of clean.matchAll(/\*\*([^*]+)\*\*|\[(\d+)\]/g)) {
    const index = m.index ?? 0;
    if (index > last) parts.push({ kind: "text", text: clean.slice(last, index) });
    if (m[1] !== undefined) parts.push({ kind: "strong", text: m[1] });
    else {
      const n = Number(m[2]);
      if (n >= 1 && n <= matchCount) parts.push({ kind: "cite", n });
    }
    last = index + m[0].length;
  }
  if (last < clean.length) parts.push({ kind: "text", text: clean.slice(last) });
  return parts;
}

export type AnswerPart =
  { readonly kind: "text"; readonly text: string } | { readonly kind: "cite"; readonly n: number };

/** Splits an answer at `[n]`; a number with no matching row is dropped (the server strips them
 *  too, so a broken reference is never shown). */
export function splitAnswer(answer: string, matchCount: number): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const m of answer.matchAll(/\[(\d+)\]/g)) {
    const index = m.index ?? 0;
    const n = Number(m[1]);
    if (index > last) parts.push({ kind: "text", text: answer.slice(last, index) });
    if (n >= 1 && n <= matchCount) parts.push({ kind: "cite", n });
    last = index + m[0].length;
  }
  if (last < answer.length) parts.push({ kind: "text", text: answer.slice(last) });
  return parts;
}

export interface EditableChip {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** The numeric filters a person can change; bounds are query-core's, never retyped. */
export const EDITABLE_CHIPS: readonly EditableChip[] = Object.freeze([
  {
    key: "radius_mi",
    label: "Radius",
    unit: "mi",
    step: 0.25,
    min: EXPLORE_BOUNDS.radiusMi[0],
    max: EXPLORE_BOUNDS.radiusMi[1],
  },
  {
    key: "roof_age_years_min",
    label: "Roof age at least",
    unit: "years",
    step: 1,
    min: EXPLORE_BOUNDS.roof[0],
    max: EXPLORE_BOUNDS.roof[1],
  },
  {
    key: "tenure_years_min",
    label: "Owner tenure more than",
    unit: "years",
    step: 1,
    min: 1,
    max: EXPLORE_BOUNDS.tenure[1],
  },
  {
    key: "open_years_min",
    label: "Permit open at least",
    unit: "years",
    step: 0.5,
    min: EXPLORE_BOUNDS.openYrs[0],
    max: EXPLORE_BOUNDS.openYrs[1],
  },
]);

/** Keys of `query` that are plumbing, not an assumption to show. */
const HIDDEN_KEYS = new Set(["manifest_cid", "area", "limit", "offset"]);

export interface ReadOnlyChip {
  readonly key: string;
  readonly text: string;
}

export interface HowChips {
  readonly editable: readonly { readonly chip: EditableChip; readonly value: number }[];
  readonly fixed: readonly ReadOnlyChip[];
}

function scalar(value: unknown): string {
  return Array.isArray(value)
    ? value.map(String).join(", ").replaceAll("_", " ")
    : String(value).replaceAll("_", " ");
}

export function howChips(query: AgentAskResponse["query"]): HowChips {
  const editableKeys = new Set(EDITABLE_CHIPS.map((c) => c.key));
  const editable = EDITABLE_CHIPS.flatMap((chip) => {
    const value = query[chip.key];
    return typeof value === "number" ? [{ chip, value }] : [];
  });
  const fixed = Object.entries(query)
    .filter(([key, value]) => {
      if (HIDDEN_KEYS.has(key) || editableKeys.has(key)) return false;
      if (value === undefined || value === null) return false;
      return Array.isArray(value) || typeof value !== "object";
    })
    .map(([key, value]) => ({ key, text: `${key.replaceAll("_", " ")}: ${scalar(value)}` }));
  return { editable, fixed };
}

/** The Explore URL filters an answer applied (PO 2026-10-26: the AI tab's results list shows the
 *  answer's search). Every filter the list reads is set or cleared, so no older filter lingers;
 *  a key the agent did not apply is cleared. Area: a place name, or a point as `at=lat,lon`. */
export function answerFilterParams(
  query: AgentAskResponse["query"],
): Readonly<Record<string, string | null>> {
  const num = (key: string): string | null =>
    typeof query[key] === "number" ? String(query[key]) : null;
  const area = query["area"];
  const place =
    typeof area === "object" &&
    area !== null &&
    typeof (area as { place?: unknown }).place === "string"
      ? (area as { place: string }).place
      : null;
  const point =
    typeof area === "object" &&
    area !== null &&
    typeof (area as { lat?: unknown }).lat === "number" &&
    typeof (area as { lon?: unknown }).lon === "number"
      ? `${String((area as { lat: number }).lat)},${String((area as { lon: number }).lon)}`
      : null;
  const status = query["status_class"];
  const permit =
    status === "open_or_stalled"
      ? "open_stalled"
      : status === "open" || status === "stalled"
        ? status
        : null;
  const sort = query["sort"];
  return {
    place,
    at: place === null ? point : null,
    r: num("radius_mi"),
    roof: num("roof_age_years_min"),
    permit,
    openYrs: num("open_years_min"),
    tenure: num("tenure_years_min"),
    ooa: query["owner_is_out_of_area"] === true ? "1" : null,
    sort: sort === "nearest" || sort === "roof_desc" || sort === "open_desc" ? sort : null,
    page: null,
    sel: null,
  };
}

/** `run=1`: send the `q` question once on arrival (the drawer's "Ask about this property"). */
export const RUN_PARAM = "run";
