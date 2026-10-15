const SUFFIXES = [
  "LLC",
  "L L C",
  "INC",
  "INCORPORATED",
  "CORP",
  "CORPORATION",
  "CO",
  "COMPANY",
  "LTD",
  "LIMITED",
  "LP",
  "LLP",
  "PLLC",
  "PC",
  "THE",
  "OF TEXAS",
  "TX",
  "TEXAS",
];

const suffixRegex = `\\b(${SUFFIXES.map((s) => s.replace(/ /g, "\\s")).join("|")})\\b`;

export function nameKeySql(col: string): string {
  return `nullif(trim(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(upper(coalesce(${col}, '')), '\\bD/?B/?A\\b.*$', ''),
    '[^A-Z0-9 ]', ' ', 'g'),
    '${suffixRegex}', ' ', 'g'),
    '\\s+', ' ', 'g')), '')`;
}

export function nameKey(name: string | null | undefined): string | null {
  if (!name) return null;
  let s = name.toUpperCase().replace(/\bD\/?B\/?A\b.*$/, "");
  s = s.replace(/[^A-Z0-9 ]/g, " ");
  s = s.replace(new RegExp(suffixRegex, "g"), " ");
  s = s.replace(/\s+/g, " ").trim();
  return s.length ? s : null;
}
