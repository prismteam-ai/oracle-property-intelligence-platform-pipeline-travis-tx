/**
 * The prompt-injection boundary for tool text (decisions.md section 20): every string a tool returns reaches the model
 * capped at 1,000 characters and stripped of control, zero-width and bidi characters, under the system rule that tool
 * text is data.
 */
export const TOOL_TEXT_MAX = 1000;

/** C0 and C1 controls, newlines and tabs included (a record field never needs layout): each becomes a space. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/**
 * Removed outright: zero-width characters (U+200B-U+200D, U+2060, U+FEFF, U+180E, U+034F) and bidi marks, embeddings,
 * overrides and isolates (U+061C, U+200E, U+200F, U+202A-U+202E, U+2066-U+2069).
 */
// Built from code points so the source holds no invisible character.
const INVISIBLE = new RegExp(
  `[${[
    0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x180e, 0x034f, 0x061c, 0x200e, 0x200f, 0x202a, 0x202b,
    0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
  ]
    .map((c) => `\\u${c.toString(16).padStart(4, '0')}`)
    .join('')}]`,
  'g',
);

/** Cleans one tool string: controls become spaces, invisible and bidi characters go, then trim and cap. */
export function sanitizeText(s: string, max = TOOL_TEXT_MAX): string {
  const out = s.replace(CONTROL, ' ').replace(INVISIBLE, '').replace(/ {2,}/g, ' ').trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** Deep copy with every string sanitized (objects and arrays walked; other values kept). */
export function sanitizeDeep<T>(v: T, max = TOOL_TEXT_MAX): T {
  if (typeof v === 'string') return sanitizeText(v, max) as T;
  if (Array.isArray(v)) return v.map((x) => sanitizeDeep(x, max)) as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = sanitizeDeep(x, max);
    return o as T;
  }
  return v;
}
