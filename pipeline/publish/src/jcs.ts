// RFC 8785 JSON Canonicalization Scheme: sorted keys (UTF-16 code units), no insignificant
// whitespace, ECMAScript number serialization, UTF-8. Used for the run manifest bytes whose
// raw-leaves CIDv1 is the manifest CID (research R-06).

function serialize(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error(`jcs: non-finite number at ${path}`);
      // ECMAScript Number::toString is exactly the RFC 8785 number form; -0 serializes as 0.
      return Object.is(value, -0) ? "0" : String(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => serialize(v, `${path}[${i}]`)).join(",")}]`;
      }
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto !== Object.prototype && proto !== null) {
        throw new Error(`jcs: only plain objects are allowed at ${path}`);
      }
      // Default sort compares UTF-16 code units, which is what RFC 8785 § 3.2.3 requires.
      const keys = Object.keys(value).sort();
      const record = value as Record<string, unknown>;
      return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize(record[k], `${path}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new Error(`jcs: ${typeof value} is not JSON at ${path}`);
  }
}

/** The RFC 8785 canonical JSON text of `value`. */
export function jcs(value: unknown): string {
  return serialize(value, "$");
}

/** The UTF-8 bytes of the canonical JSON text. */
export function jcsBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(jcs(value));
}
