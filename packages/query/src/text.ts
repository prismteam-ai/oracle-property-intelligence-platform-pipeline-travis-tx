/**
 * Text normalization shared by deploy-build (documents) and the text-search query (query text), so both sides apply the
 * same rewrite (decisions.md section 20): lower-case, accents stripped, then the versioned alias list.
 */
export const TEXT_ALIAS_VERSION = 'travis-text-alias.v1';

/** Variants rewritten to one token. `re-roof`, `re roof` and `reroof` all become `reroof` (the suffix is kept: `re-roofing` -> `reroofing`). */
export const TEXT_ALIASES: readonly { pattern: string; to: string }[] = [
  { pattern: '\\bre[\\s\\-]+roof', to: 'reroof' },
];

export const FTS_CONFIG = {
  stemmer: 'porter',
  stopwords: 'english',
  ignore: '(\\.|[^a-z0-9])+',
  lower: true,
  strip_accents: true,
} as const;

/** The query-side normalization (JavaScript). */
export function normalizeText(s: string): string {
  let out = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  for (const a of TEXT_ALIASES) out = out.replace(new RegExp(a.pattern, 'g'), a.to);
  return out;
}

/** The document-side normalization (DuckDB SQL expression over a column). */
export function normalizeTextSql(col: string): string {
  let expr = `lower(strip_accents(${col}))`;
  for (const a of TEXT_ALIASES)
    expr = `regexp_replace(${expr}, '${a.pattern.replace(/'/g, "''")}', '${a.to}', 'g')`;
  return expr;
}

/** Name normalization for search centers and situs cities: casefolded, punctuation and spaces removed. */
export function normalizeCenterName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** SQL twin of {@link normalizeCenterName} for a column expression. */
export function normalizeCenterNameSql(col: string): string {
  return `lower(regexp_replace(strip_accents(coalesce(${col}, '')), '[^A-Za-z0-9]', '', 'g'))`;
}

/**
 * The matcher's normalizer (kit `normalizeName`): used for business and license `q` lookups. Legal-form words are removed,
 * every non-alphanumeric turned into a space. Kept here as a faithful copy of the kit function's rules so the query layer
 * has no kit dependency at run time; deploy-build asserts the two agree on every loaded name (see deploy-build verify).
 */
const LEGAL_FORM_WORDS =
  /\b(L\.?L\.?C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|L\.?P|LLP|PLLC|P\.?C|PA|TRUST)\b\.?/g;
export function normalizeMatcherName(printed: string): string | null {
  const text = printed
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(LEGAL_FORM_WORDS, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' ? null : text;
}
