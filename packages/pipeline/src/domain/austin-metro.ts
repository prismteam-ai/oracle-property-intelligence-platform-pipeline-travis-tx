const AUSTIN_METRO_ZIP_PREFIXES = new Set(["786", "787"]);
const ZIP_PREFIX_LENGTH = 3;

export function isAustinMetroZip(zip: string | undefined): boolean {
  const prefix = zip?.trim().slice(0, ZIP_PREFIX_LENGTH);
  return prefix !== undefined && AUSTIN_METRO_ZIP_PREFIXES.has(prefix);
}
