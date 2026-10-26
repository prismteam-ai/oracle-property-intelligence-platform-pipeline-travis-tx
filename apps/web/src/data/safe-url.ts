// A URL that came out of published data may become an href only when it is http: or https:
// (A-13 review: a `javascript:` or `data:` value in a manifest or permit row must render as text).

/** The normalised http(s) URL, or undefined for anything else (other schemes, relative, junk). */
export function safeHttpUrl(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = value.trim();
  if (!/^https?:\/\//i.test(text)) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? text : undefined;
  } catch {
    return undefined;
  }
}
