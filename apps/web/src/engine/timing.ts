// User Timing instrumentation of the Permits engine (A-03 TC-NF-01 / TC-NF-02). Marks and
// measures carry names and times only, never a value read from the data, and cost nothing when
// nobody reads them; the hosted Playwright specs read `performance.getEntriesByType('measure')`.
// A step that throws emits no measure, so every measure belongs to a completed step.
// Instrumentation never fails the page: a missing or throwing User Timing API is ignored.

export const PERF_MARKS = Object.freeze({
  initStart: "countylens:duckdb:init:start",
  initEnd: "countylens:duckdb:init:end",
});

export const PERF_MEASURES = Object.freeze({
  /** DuckDB-WASM load, instantiate, open and connect (`openEngine`). */
  init: "countylens:duckdb:init",
  /** The single-page listing query (`listPermits`). */
  list: "countylens:query:list",
  /** The page's own COUNT over v_roofing_permit (`countPermits`). */
  count: "countylens:query:count",
});

function userTiming(): Performance | undefined {
  return typeof performance !== "undefined" &&
    typeof performance.mark === "function" &&
    typeof performance.measure === "function"
    ? performance
    : undefined;
}

function mark(name: string): void {
  try {
    userTiming()?.mark(name);
  } catch {
    // Instrumentation only.
  }
}

function measure(name: string, startMark: string, endMark: string): void {
  try {
    userTiming()?.measure(name, startMark, endMark);
  } catch {
    // Instrumentation only.
  }
}

/** Runs `step` between `{start}` and `{end}` marks and, if it resolves, measures `name`. */
export async function timed<T>(
  name: string,
  step: () => Promise<T>,
  marks: { readonly start: string; readonly end: string } = {
    start: `${name}:start`,
    end: `${name}:end`,
  },
): Promise<T> {
  mark(marks.start);
  const result = await step();
  mark(marks.end);
  measure(name, marks.start, marks.end);
  return result;
}
