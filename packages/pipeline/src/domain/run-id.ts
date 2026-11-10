const SEPARATORS = /[-:]/g;
const MILLISECONDS = /\.\d{3}/;

export function runIdAt(instant: Date): string {
  return instant.toISOString().replace(SEPARATORS, "").replace(MILLISECONDS, "");
}
