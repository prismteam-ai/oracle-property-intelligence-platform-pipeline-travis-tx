// A-16 closure checker (testplans/A-16-test-cases.md TC-038, TC-039, TC-040; AC-14, FR-013).
// Pure functions over markdown and test sources, so the same checker runs on the real docs
// (A-16-closure.spec.ts) and on a synthetic table (lib/closure.test.ts, TC-040):
//   - parseClosureTable: the first markdown table under a "## Closure…" heading.
//   - checkClosure: every planned ID appears exactly once in the evidence table, with a status of
//     Closed or Exception; a Closed row names evidence (a file path, a commit, a test ID or an
//     image, or "As <ID>" of a Closed row that does); an Exception row names a reason.
//   - parkMarkers / recordedParks: the parked tests left in the specs (`parkGap(` or a
//     `test.fixme(` whose reason starts with "Parked") and the TC IDs the Closure table records
//     as re-parked or kept parked.
// Nothing here reads the network or the file system; the spec passes the texts and the
// file/commit resolvers in.

export interface ClosureRow {
  readonly id: string;
  /** The table cells after the ID, trimmed, in column order. */
  readonly cells: readonly string[];
  /** 1-based line number in the markdown. */
  readonly line: number;
}

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((cell) => cell.trim());
}

const isSeparator = (cells: readonly string[]): boolean =>
  cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));

/**
 * The rows of the first markdown table after the first heading that matches `heading` (default:
 * a level-2 heading starting with "Closure"). Header and separator lines are skipped; the table
 * ends at the first line that does not start with "|". Throws when there is no such heading or
 * table, so a renamed section fails loudly instead of checking nothing.
 */
export function parseClosureTable(
  markdown: string,
  heading: RegExp = /^##\s+Closure\b/,
): ClosureRow[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) throw new Error(`no heading matching ${String(heading)}`);
  const rows: ClosureRow[] = [];
  let inTable = false;
  let header = true;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^#{1,6}\s/.test(line) && !inTable) break;
    if (!line.trim().startsWith("|")) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    const cells = splitRow(line);
    if (header) {
      header = false;
      continue;
    }
    if (isSeparator(cells)) continue;
    const [id = "", ...rest] = cells;
    rows.push({ id: id.replace(/\*/g, "").trim(), cells: rest, line: i + 1 });
  }
  if (rows.length === 0) throw new Error(`no table rows under ${String(heading)}`);
  return rows;
}

export interface ClosureStatus {
  readonly closed: boolean;
  readonly exception: boolean;
}

/** "Closed", "Closed in code", "Partly closed", "Exception (PO)", or both in one outcome. */
export function statusOf(outcome: string): ClosureStatus {
  return {
    closed: /\bclosed\b/i.test(outcome),
    exception: /\bexception\b/i.test(outcome),
  };
}

export type EvidenceKind = "path" | "commit" | "test" | "image" | "row";

export interface EvidenceRef {
  readonly kind: EvidenceKind;
  readonly value: string;
}

const EXTENSIONS = "ts|tsx|js|mjs|cjs|md|json|yml|yaml|sh|sql|py|png|jpg|jpeg|webp|svg|txt|csv";
const PATH_TOKEN = new RegExp(`^[\\w.@-]+(?:/[\\w.@-]+)*\\.(?:${EXTENSIONS})$`);
const IMAGE_TOKEN = /\.(?:png|jpe?g|webp|svg)$/i;
const COMMIT_TOKEN = /^[0-9a-f]{7,40}$/;
const TEST_ID = /\b(?:A-\d{2}-)?TC-(?:NF-)?\d{2,3}[a-z]?\b/g;
const AS_ROW = /\bAs ([A-Z]\d{2}-\d+)\b/g;

/**
 * The evidence a cell names. Backticked tokens count as a path (a file name with an extension,
 * with or without folders) or a commit (7–40 hex characters); bare `folder/file.ext` tokens in
 * the prose count as paths too. Test IDs are `TC-nnn`, `TC-NF-nn` or `A-nn-TC-nnn`. "As A11-2"
 * points at another row. Group labels (G2b), error-log IDs (ERR-76) and ADR names are not
 * evidence by this definition.
 */
export function evidenceRefs(text: string): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    const token = (m[1] ?? "").trim();
    if (COMMIT_TOKEN.test(token)) refs.push({ kind: "commit", value: token });
    else if (PATH_TOKEN.test(token))
      refs.push({ kind: IMAGE_TOKEN.test(token) ? "image" : "path", value: token });
  }
  const prose = text.replace(/`[^`]*`/g, " ");
  for (const word of prose.split(/[\s,;()]+/)) {
    const token = word.replace(/[.:]+$/, "");
    if (token.includes("/") && PATH_TOKEN.test(token))
      refs.push({ kind: IMAGE_TOKEN.test(token) ? "image" : "path", value: token });
  }
  for (const m of text.matchAll(TEST_ID)) refs.push({ kind: "test", value: m[0] });
  for (const m of text.matchAll(AS_ROW)) refs.push({ kind: "row", value: m[1] ?? "" });
  return refs;
}

export type ClosureDefect =
  | "missing"
  | "duplicated"
  | "not planned"
  | "no status"
  | "closed without evidence"
  | "exception without reason"
  | "evidence not found";

export interface ClosureIssue {
  readonly id: string;
  readonly defect: ClosureDefect;
  readonly message: string;
}

export interface EvidenceRowInput {
  readonly id: string;
  readonly outcome: string;
  readonly evidence: string;
}

export interface CheckOptions {
  /** True when a path names a file of the repository (exact path or a unique file name). */
  readonly fileExists?: (path: string) => boolean;
  /** True when a hash names a commit of the repository. */
  readonly commitExists?: (hash: string) => boolean;
}

const EMPTY_REASON = /^(?:|-|—|–|n\/a|tbd|todo|pending)$/i;

/** Every defect of the evidence table against the planned IDs; an empty list means it passes. */
export function checkClosure(
  plannedIds: readonly string[],
  rows: readonly EvidenceRowInput[],
  options: CheckOptions = {},
): ClosureIssue[] {
  const issues: ClosureIssue[] = [];
  const add = (id: string, defect: ClosureDefect, detail = ""): void => {
    issues.push({ id, defect, message: `${id}: ${defect}${detail === "" ? "" : ` (${detail})`}` });
  };

  const plannedCount = new Map<string, number>();
  for (const id of plannedIds) plannedCount.set(id, (plannedCount.get(id) ?? 0) + 1);
  for (const [id, n] of plannedCount) if (n > 1) add(id, "duplicated", `${n} times in the plan`);

  const byId = new Map<string, EvidenceRowInput[]>();
  for (const row of rows) byId.set(row.id, [...(byId.get(row.id) ?? []), row]);
  for (const id of plannedCount.keys()) if (!byId.has(id)) add(id, "missing");
  for (const [id, list] of byId) {
    if (!plannedCount.has(id)) add(id, "not planned");
    if (list.length > 1) add(id, "duplicated", `${list.length} times in the evidence table`);
  }

  const directEvidence = (row: EvidenceRowInput): EvidenceRef[] =>
    evidenceRefs(`${row.outcome} ${row.evidence}`).filter((r) => r.kind !== "row");
  const hasEvidence = (row: EvidenceRowInput, seen: Set<string>): boolean => {
    if (directEvidence(row).length > 0) return true;
    for (const ref of evidenceRefs(row.evidence).filter((r) => r.kind === "row")) {
      if (seen.has(ref.value)) continue;
      const target = byId.get(ref.value)?.[0];
      if (target === undefined || !statusOf(target.outcome).closed) continue;
      if (hasEvidence(target, new Set([...seen, ref.value]))) return true;
    }
    return false;
  };

  for (const row of rows) {
    const status = statusOf(row.outcome);
    if (!status.closed && !status.exception) {
      add(row.id, "no status", `outcome "${row.outcome}"`);
      continue;
    }
    if (status.closed && !hasEvidence(row, new Set([row.id]))) {
      add(row.id, "closed without evidence", `evidence cell: "${row.evidence}"`);
    }
    if (status.exception && EMPTY_REASON.test(row.evidence.trim())) {
      add(row.id, "exception without reason");
    }
    for (const ref of directEvidence(row)) {
      if (
        (ref.kind === "path" || ref.kind === "image") &&
        options.fileExists?.(ref.value) === false
      )
        add(row.id, "evidence not found", `file ${ref.value}`);
      if (ref.kind === "commit" && options.commitExists?.(ref.value) === false)
        add(row.id, "evidence not found", `commit ${ref.value}`);
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------------------
// Parked tests (TC-038)
// ---------------------------------------------------------------------------------------

export interface ParkMarker {
  /** `A-13-TC-053`, `A-03-TC-034`; `?` when no scenario title precedes the marker. */
  readonly testId: string;
  /** `TC-053`: the form the Closure table uses. */
  readonly tc: string;
  readonly file: string;
  readonly line: number;
  readonly marker: string;
}

/** The test ID of the scenario title closest above `index` in `source`. */
function scenarioAbove(source: string, index: number, story: string): string {
  const before = source.slice(0, index);
  const patterns: { re: RegExp; id: (m: RegExpExecArray) => string }[] = [
    { re: /@scenario:(A-\d{2}-TC-[\w-]+)/g, id: (m) => m[1] ?? "" },
    { re: /scenario(?:14)?\("([\w-]+)"\)/g, id: (m) => `${story}-TC-${m[1] ?? ""}` },
  ];
  let best = { at: -1, id: "?" };
  for (const { re, id } of patterns) {
    for (const m of before.matchAll(re)) {
      if ((m.index ?? -1) > best.at) best = { at: m.index ?? -1, id: id(m as RegExpExecArray) };
    }
  }
  return best.id;
}

/** The argument text of a call whose "(" ends just before `from`, up to its matching ")". */
function callArgs(source: string, from: number): string {
  let depth = 1;
  let quote: string | null = null;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")" && (depth -= 1) === 0) return source.slice(from, i);
  }
  return source.slice(from);
}

/**
 * Every park left in one spec file: a `parkGap(` call, or a `test.fixme(` / `test.skip(` whose
 * reason text says "Parked". `story` is the file's story prefix (`A-13`), used for the
 * `scenario("nnn")` titles. Comment lines are ignored.
 */
export function parkMarkers(source: string, file: string, story: string): ParkMarker[] {
  const found: ParkMarker[] = [];
  const re = /\b(parkGap\(|test\.(?:fixme|skip)\()/g;
  for (const m of source.matchAll(re)) {
    const index = m.index ?? 0;
    const lineStart = source.lastIndexOf("\n", index) + 1;
    if (source.slice(lineStart, index).trimStart().startsWith("//")) continue;
    const call = m[1] ?? "";
    if (call !== "parkGap(" && !/["'`]Parked\b/.test(callArgs(source, index + call.length))) {
      continue;
    }
    const testId = scenarioAbove(source, index, story);
    found.push({
      testId,
      tc: testId.replace(/^A-\d{2}-/, ""),
      file,
      line: source.slice(0, index).split("\n").length,
      marker: call.replace(/\($/, ""),
    });
  }
  return found;
}

/**
 * The TC IDs the evidence table records as parked: those named in a clause (split on ";") that
 * says "park"/"parked"/"re-parked" and not "unparked".
 */
export function recordedParks(rows: readonly EvidenceRowInput[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const clause of `${row.outcome}; ${row.evidence}`.split(";")) {
      if (!/(?<!un)park/i.test(clause)) continue;
      for (const m of clause.matchAll(/\bTC-(?:NF-)?\d{2,3}\b/g)) ids.add(m[0]);
    }
  }
  return ids;
}
