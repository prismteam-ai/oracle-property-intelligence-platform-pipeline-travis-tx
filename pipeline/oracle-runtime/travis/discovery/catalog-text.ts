// The one place runtime text is made safe for pipeline/docs/travis-sources.yaml.
//
// The writer (write-catalog.ts) refuses any string with '"', '\' or a control character,
// because the kit validator's fallback YAML parser strips the double quotes without
// processing escapes. Text that comes from a live response (a quoted challenge title, an
// HTTP or network error message, a geo signal) can carry those characters, so every
// catalog string passes through `catalogText` when the catalog is assembled:
// - '"' becomes "'" (a quoted title stays readable as a quote);
// - '\' becomes '/';
// - each run of control characters (newlines, tabs, CR, NUL...) becomes one space.
// Evidence files are not touched: they keep the source's own text (redaction only).
// The writer's refusal stays as the last line of defence for anything that skips this.

// eslint-disable-next-line no-control-regex -- control characters are what we replace
const CONTROL_RUN = /[\u0000-\u001f\u007f]+/g;

/** Maps one runtime string into the writer's safe character set. */
export function catalogText(text: string): string {
  return text.replace(/"/g, "'").replace(/\\/g, "/").replace(CONTROL_RUN, " ");
}

/**
 * Returns a copy of `value` with `catalogText` applied to every string value (keys are
 * left alone; the writer checks them separately). Numbers, booleans and null are kept.
 */
export function catalogSafe<T>(value: T): T {
  return deep(value) as T;
}

function deep(value: unknown): unknown {
  if (typeof value === "string") return catalogText(value);
  if (Array.isArray(value)) return value.map(deep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deep(v)]));
  }
  return value;
}
